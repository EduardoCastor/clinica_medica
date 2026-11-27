// Supabase Edge Function: saas-payment-webhook
// Integração de webhook de pagamentos (ex.: Kiwify) com hardening de produção:
// - Falha fechada (HTTP 503) enquanto o formato oficial da assinatura do gateway não estiver confirmado
// - Rejeita chave secreta enviada diretamente como assinatura (somente HMAC-SHA256 criptográfico)
// - Exige event_id determinístico, order_id, reference_code, moeda e valor pago exatos
// - Delega atualização de invoice + organization + subscription + audit_logs para RPC transacional única no PostgreSQL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {
  extractWebhookEventFields,
  isPaymentWebhookIntegrationReady,
  verifyWebhookHmacSignature,
} from '../_shared/paymentWebhookSecurity.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kiwify-signature, x-webhook-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = (
    Deno.env.get('KIWIFY_WEBHOOK_SECRET') ||
    Deno.env.get('PAYMENT_WEBHOOK_SECRET') ||
    ''
  ).trim();
  const signatureFormatConfirmed = (
    Deno.env.get('PAYMENT_WEBHOOK_SIGNATURE_CONFIRMED') ||
    Deno.env.get('KIWIFY_SIGNATURE_FORMAT_CONFIRMED') ||
    ''
  ).trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Configuração do servidor Supabase incompleta.' }, 500);
  }

  // Enquanto o formato oficial de assinatura do gateway não estiver confirmado e configurado,
  // mantém a rota sinalizada como pendente de configuração (fail-closed, sem inventar formato).
  const readiness = isPaymentWebhookIntegrationReady({
    webhookSecret,
    signatureFormatConfirmed,
  });
  if (!readiness.ready) {
    return jsonResponse(
      {
        error: readiness.reason,
        code: 'PAYMENT_WEBHOOK_PENDING_CONFIGURATION',
      },
      503
    );
  }

  const rawBody = await req.text();
  if (!rawBody || rawBody.length > 512_000) {
    return jsonResponse({ error: 'Corpo da requisição ausente ou excede o limite permitido.' }, 400);
  }

  // Lê assinatura exclusivamente de cabeçalhos HTTP (jamais aceitar querystring ou chave secreta direta)
  const providedSignature =
    req.headers.get('x-webhook-signature') ||
    req.headers.get('x-kiwify-signature') ||
    '';

  const sigCheck = await verifyWebhookHmacSignature({
    rawBody,
    providedSignature,
    secret: webhookSecret,
  });

  if (!sigCheck.valid) {
    return jsonResponse(
      { error: sigCheck.reason || 'Assinatura HMAC de webhook inválida ou ausente.' },
      401
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Payload JSON inválido.' }, 400);
  }

  const parsed = extractWebhookEventFields(payload);
  if (!parsed.valid || !parsed.event) {
    return jsonResponse({ error: parsed.error || 'Campos obrigatórios do evento ausentes.' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Executa validação de fatura, valor, moeda, organização, plano, ciclo e atualização de licença
  // dentro de uma única transação atômica no PostgreSQL.
  const { data: rpcResult, error: rpcErr } = await adminClient.rpc(
    'medsync_process_payment_webhook_event',
    {
      p_provider: parsed.event.provider,
      p_provider_event_id: parsed.event.providerEventId,
      p_event_type: parsed.event.eventType,
      p_reference_code: parsed.event.referenceCode,
      p_external_order_id: parsed.event.externalOrderId,
      p_paid_amount: parsed.event.paidAmount,
      p_currency: parsed.event.currency,
      p_payload: payload,
    }
  );

  if (rpcErr) {
    return jsonResponse(
      { error: rpcErr.message || 'Falha transacional ao processar evento de pagamento.' },
      500
    );
  }

  const outcome = (rpcResult || {}) as Record<string, unknown>;
  if (outcome.success === false) {
    return jsonResponse(outcome, 422);
  }

  return jsonResponse(outcome, 200);
});
