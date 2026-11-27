// Supabase Edge Function: saas-payment-webhook
// Endpoint preparado para integração real com Kiwify / gateways de pagamento:
// - Valida assinatura/token secreto configurado no servidor (KIWIFY_WEBHOOK_SECRET / PAYMENT_WEBHOOK_SECRET)
// - Garante idempotência via saas_payment_webhook_events(provider, provider_event_id)
// - Só ativa/renova licença ATIVA após evento verificado de pagamento aprovado.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

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

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function addCycleMonths(base: Date, cycle: string): string {
  const next = new Date(base.getTime());
  const months = cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1;
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
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
  const webhookSecret =
    (Deno.env.get('KIWIFY_WEBHOOK_SECRET') || Deno.env.get('PAYMENT_WEBHOOK_SECRET') || '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Servidor não configurado.' }, 500);
  }

  if (!webhookSecret) {
    return jsonResponse(
      {
        error:
          'Gateway webhook secret não configurado no servidor (KIWIFY_WEBHOOK_SECRET / PAYMENT_WEBHOOK_SECRET).',
      },
      503
    );
  }

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'JSON inválido.' }, 400);
  }

  const url = new URL(req.url);
  const providedSig = (
    req.headers.get('x-kiwify-signature') ||
    req.headers.get('x-webhook-signature') ||
    url.searchParams.get('signature') ||
    String(payload.signature || '')
  )
    .trim()
    .toLowerCase();

  const expectedHmac = (await hmacSha256Hex(webhookSecret, rawBody)).toLowerCase();
  const isTokenMatch = timingSafeEqual(providedSig, webhookSecret.toLowerCase());
  const isHmacMatch = providedSig.length === expectedHmac.length && timingSafeEqual(providedSig, expectedHmac);

  if (!providedSig || (!isHmacMatch && !isTokenMatch)) {
    return jsonResponse({ error: 'Assinatura de webhook inválida ou ausente.' }, 401);
  }

  const provider = String(payload.provider || 'kiwify').toLowerCase();
  const eventType = String(payload.webhook_event_type || payload.event_type || payload.order_status || 'unknown').toLowerCase();
  const providerEventId = String(
    payload.event_id ||
      payload.id ||
      `${eventType}:${String(payload.order_id || payload.reference_code || Date.now())}`
  );
  const referenceCode = String(
    payload.reference_code ||
      (payload.TrackingParameters && typeof payload.TrackingParameters === 'object'
        ? (payload.TrackingParameters as Record<string, unknown>).s1 || ''
        : '') ||
      ''
  ).trim();
  const externalOrderId = String(payload.order_id || '').trim();

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotência estrita: se o mesmo evento já foi registrado/processado, retorna sucesso sem duplicar
  const { data: existingEvent } = await adminClient
    .from('saas_payment_webhook_events')
    .select('id, processing_status')
    .eq('provider', provider)
    .eq('provider_event_id', providerEventId)
    .maybeSingle();

  if (existingEvent) {
    return jsonResponse({
      success: true,
      idempotent: true,
      eventId: existingEvent.id,
      status: existingEvent.processing_status,
    });
  }

  // Localiza cobrança por reference_code ou external_order_id
  let invoice: Record<string, unknown> | null = null;
  if (referenceCode) {
    const { data } = await adminClient
      .from('saas_invoices')
      .select('*')
      .eq('reference_code', referenceCode)
      .maybeSingle();
    invoice = data;
  }
  if (!invoice && externalOrderId) {
    const { data } = await adminClient
      .from('saas_invoices')
      .select('*')
      .eq('external_order_id', externalOrderId)
      .maybeSingle();
    invoice = data;
  }

  const { data: eventRow, error: insertEvtErr } = await adminClient
    .from('saas_payment_webhook_events')
    .insert({
      provider,
      provider_event_id: providerEventId,
      event_type: eventType,
      signature_valid: true,
      processing_status: 'received',
      organization_id: invoice ? String(invoice.organization_id) : null,
      invoice_id: invoice ? String(invoice.id) : null,
      payload,
    })
    .select()
    .single();

  if (insertEvtErr) {
    return jsonResponse({ error: insertEvtErr.message }, 500);
  }

  if (!invoice) {
    await adminClient
      .from('saas_payment_webhook_events')
      .update({
        processing_status: 'ignored',
        error_message: 'Cobrança não localizada para reference_code/order_id informado.',
        processed_at: new Date().toISOString(),
      })
      .eq('id', eventRow.id);

    return jsonResponse({ success: true, ignored: true, reason: 'invoice_not_found' });
  }

  const orgId = String(invoice.organization_id);
  const now = new Date();
  const nowIso = now.toISOString();
  const cycle = String(invoice.billing_cycle || 'monthly');

  if (['order_approved', 'subscription_renewed', 'paid', 'approved'].includes(eventType)) {
    const nextRenewalIso = addCycleMonths(now, cycle);

    await adminClient
      .from('saas_invoices')
      .update({
        status: 'paid',
        payment_provider: provider,
        external_order_id: externalOrderId || invoice.external_order_id,
        paid_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', String(invoice.id));

    await adminClient
      .from('organizations')
      .update({
        plan_id: invoice.plan_id || undefined,
        billing_cycle: cycle,
        license_status: 'ATIVA',
        status: 'active',
        subscription_renews_at: nextRenewalIso,
        status_reason: `Pagamento aprovado via webhook (${provider}: ${providerEventId}).`,
        updated_at: nowIso,
      })
      .eq('id', orgId);

    await adminClient.from('saas_subscriptions').upsert(
      {
        organization_id: orgId,
        plan_id: invoice.plan_id,
        billing_cycle: cycle,
        license_status: 'ATIVA',
        current_period_start: nowIso,
        current_period_end: nextRenewalIso,
        next_due_date: nextRenewalIso,
        final_cycle_amount: Number(invoice.final_amount || 0),
        payment_provider: provider,
        updated_at: nowIso,
      },
      { onConflict: 'organization_id' }
    );

    await adminClient.from('saas_audit_logs').insert({
      actor_role: `webhook:${provider}`,
      target_organization_id: orgId,
      action: 'payment_confirmed_webhook',
      entity: 'saas_invoices',
      entity_id: String(invoice.id),
      reason: `Webhook ${eventType} (${providerEventId})`,
      new_state: { license_status: 'ATIVA', subscription_renews_at: nextRenewalIso },
    });
  } else if (['subscription_overdue', 'payment_late', 'overdue'].includes(eventType)) {
    await adminClient
      .from('saas_invoices')
      .update({ status: 'overdue', updated_at: nowIso })
      .eq('id', String(invoice.id));

    await adminClient
      .from('organizations')
      .update({
        license_status: 'INADIMPLENTE',
        status: 'overdue',
        status_reason: `Inadimplência sinalizada via webhook (${provider}).`,
        updated_at: nowIso,
      })
      .eq('id', orgId);

    await adminClient
      .from('saas_subscriptions')
      .update({ license_status: 'INADIMPLENTE', updated_at: nowIso })
      .eq('organization_id', orgId);
  } else if (['subscription_canceled', 'order_refunded', 'chargedback', 'refunded'].includes(eventType)) {
    const nextStatus = eventType === 'subscription_canceled' ? 'CANCELADA' : 'SUSPENSA';
    await adminClient
      .from('saas_invoices')
      .update({
        status: eventType.includes('refund') || eventType.includes('chargeback') ? 'refunded' : 'cancelled',
        updated_at: nowIso,
      })
      .eq('id', String(invoice.id));

    await adminClient
      .from('organizations')
      .update({
        license_status: nextStatus,
        status: 'suspended',
        status_reason: `Evento ${eventType} via webhook (${provider}).`,
        updated_at: nowIso,
      })
      .eq('id', orgId);

    await adminClient
      .from('saas_subscriptions')
      .update({ license_status: nextStatus, cancelled_at: nowIso, updated_at: nowIso })
      .eq('organization_id', orgId);
  }

  await adminClient
    .from('saas_payment_webhook_events')
    .update({ processing_status: 'processed', processed_at: nowIso })
    .eq('id', eventRow.id);

  return jsonResponse({ success: true, eventId: eventRow.id, processed: true });
});
