// Utilitário compartilhado de segurança para validação do webhook de pagamentos
// Compatível com Deno (Supabase Edge Functions) e Node 20+ (testes automatizados).

export interface WebhookReadinessCheck {
  ready: boolean;
  reason?: string;
}

export interface ParsedWebhookEvent {
  provider: string;
  providerEventId: string;
  eventType: string;
  referenceCode: string;
  externalOrderId: string;
  paidAmount: number | null;
  currency: string;
}

export interface InvoiceValidationInput {
  id: string;
  organization_id: string;
  plan_id: string | null;
  billing_cycle: string;
  final_amount: number;
  currency: string;
  status: string;
}

export function isPaymentWebhookIntegrationReady(params: {
  webhookSecret?: string;
  signatureFormatConfirmed?: string;
}): WebhookReadinessCheck {
  const secret = (params.webhookSecret || '').trim();
  const confirmed = (params.signatureFormatConfirmed || '').trim().toLowerCase() === 'true';

  if (!secret) {
    return {
      ready: false,
      reason:
        'Integração pendente de configuração: KIWIFY_WEBHOOK_SECRET / PAYMENT_WEBHOOK_SECRET não configurado no servidor.',
    };
  }

  if (!confirmed) {
    return {
      ready: false,
      reason:
        'Integração pendente de validação oficial do gateway: defina PAYMENT_WEBHOOK_SIGNATURE_CONFIRMED=true após confirmar o formato exato da assinatura HMAC da Kiwify/gateway na conta oficial.',
    };
  }

  return { ready: true };
}

export function timingSafeEqualAscii(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function computeHmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifica estritamente assinatura criptográfica HMAC-SHA256 em hex (64 caracteres).
 * Nunca aceita a chave secreta diretamente como assinatura nem token em querystring.
 */
export async function verifyWebhookHmacSignature(params: {
  rawBody: string;
  providedSignature: string | null | undefined;
  secret: string;
}): Promise<{ valid: boolean; reason?: string }> {
  const secret = (params.secret || '').trim();
  if (!secret) {
    return { valid: false, reason: 'Segredo de webhook ausente.' };
  }

  let sig = (params.providedSignature || '').trim().toLowerCase();
  if (!sig) {
    return { valid: false, reason: 'Assinatura ausente no cabeçalho da requisição.' };
  }

  if (sig.startsWith('sha256=')) {
    sig = sig.slice('sha256='.length).trim();
  }

  // Bloqueia explicitamente o envio da própria chave secreta como assinatura
  if (sig === secret.toLowerCase()) {
    return { valid: false, reason: 'Assinatura inválida: chave secreta enviada diretamente não é aceita.' };
  }

  if (!/^[a-f0-9]{64}$/.test(sig)) {
    return { valid: false, reason: 'Formato de assinatura HMAC-SHA256 inválido.' };
  }

  const expectedHmac = (await computeHmacSha256Hex(secret, params.rawBody)).toLowerCase();
  if (!timingSafeEqualAscii(sig, expectedHmac)) {
    return { valid: false, reason: 'Assinatura HMAC divergente do payload recebido.' };
  }

  return { valid: true };
}

export function extractWebhookEventFields(payload: Record<string, unknown>): {
  valid: boolean;
  event?: ParsedWebhookEvent;
  error?: string;
} {
  const provider = String(payload.provider || 'kiwify').trim().toLowerCase();
  const eventType = String(
    payload.webhook_event_type || payload.event_type || payload.order_status || ''
  )
    .trim()
    .toLowerCase();

  // Identificador determinístico obrigatório (jamais usar Date.now())
  const rawEventId = payload.event_id ?? payload.id;
  const providerEventId = rawEventId !== undefined && rawEventId !== null ? String(rawEventId).trim() : '';

  const tracking =
    payload.TrackingParameters && typeof payload.TrackingParameters === 'object'
      ? (payload.TrackingParameters as Record<string, unknown>)
      : null;

  const referenceCode = String(payload.reference_code || tracking?.s1 || '').trim();
  const externalOrderId = String(payload.order_id || '').trim();

  if (!providerEventId) {
    return { valid: false, error: 'Identificador do evento (event_id/id) é obrigatório.' };
  }
  if (!eventType) {
    return { valid: false, error: 'Tipo do evento de pagamento é obrigatório.' };
  }
  if (!referenceCode && !externalOrderId) {
    return { valid: false, error: 'Código de referência ou order_id da cobrança é obrigatório.' };
  }

  // Extrai valor pago em BRL (aceita paid_amount decimal ou integer_cents se explicitado)
  let paidAmount: number | null = null;
  const commissions =
    payload.Commissions && typeof payload.Commissions === 'object'
      ? (payload.Commissions as Record<string, unknown>)
      : null;

  const rawDecimalAmount = payload.paid_amount ?? payload.amount;
  const rawCentsAmount = payload.amount_cents ?? commissions?.charge_amount;

  if (rawDecimalAmount !== undefined && rawDecimalAmount !== null && rawDecimalAmount !== '') {
    const num = Number(rawDecimalAmount);
    if (Number.isFinite(num)) {
      paidAmount = Math.round((num + Number.EPSILON) * 100) / 100;
    }
  } else if (rawCentsAmount !== undefined && rawCentsAmount !== null && rawCentsAmount !== '') {
    const cents = Number(rawCentsAmount);
    if (Number.isFinite(cents)) {
      paidAmount = Math.round((cents / 100 + Number.EPSILON) * 100) / 100;
    }
  }

  const currency = String(payload.currency || 'BRL').trim().toUpperCase();

  return {
    valid: true,
    event: {
      provider,
      providerEventId,
      eventType,
      referenceCode,
      externalOrderId,
      paidAmount,
      currency,
    },
  };
}

export function validateInvoiceSettlementCandidate(
  event: ParsedWebhookEvent,
  invoice: InvoiceValidationInput
): { valid: boolean; code?: string; error?: string } {
  if (!invoice.organization_id) {
    return { valid: false, code: 'ORG_MISSING', error: 'Cobrança sem organização vinculada.' };
  }
  if (!invoice.plan_id || !['monthly', 'quarterly', 'yearly'].includes(invoice.billing_cycle)) {
    return { valid: false, code: 'INVALID_PLAN_OR_CYCLE', error: 'Plano ou ciclo inválido na cobrança.' };
  }

  const isApproval = ['order_approved', 'subscription_renewed', 'paid', 'approved'].includes(event.eventType);
  if (!isApproval) {
    return { valid: true };
  }

  if (!event.externalOrderId) {
    return { valid: false, code: 'MISSING_ORDER_ID', error: 'Identificador do pedido (order_id) obrigatório para aprovação.' };
  }

  if (!['pending', 'overdue'].includes(invoice.status)) {
    return {
      valid: false,
      code: 'INVOICE_NOT_PAYABLE_STATUS',
      error: `Cobrança em status ${invoice.status} não pode ser liquidada novamente.`,
    };
  }

  const expectedCurrency = (invoice.currency || 'BRL').toUpperCase();
  if (event.currency !== expectedCurrency) {
    return {
      valid: false,
      code: 'CURRENCY_MISMATCH',
      error: `Moeda divergente: esperado ${expectedCurrency}, recebido ${event.currency}.`,
    };
  }

  if (event.paidAmount === null || event.paidAmount <= 0) {
    return {
      valid: false,
      code: 'MISSING_OR_INVALID_AMOUNT',
      error: 'Valor pago ausente ou inválido no evento do webhook.',
    };
  }

  const expectedAmount = Math.round((Number(invoice.final_amount) + Number.EPSILON) * 100) / 100;
  if (Math.abs(event.paidAmount - expectedAmount) > 0.01) {
    return {
      valid: false,
      code: 'AMOUNT_MISMATCH',
      error: `Valor pago (${event.paidAmount}) diverge do valor esperado (${expectedAmount}).`,
    };
  }

  return { valid: true };
}
