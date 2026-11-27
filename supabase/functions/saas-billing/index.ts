// Supabase Edge Function: saas-billing
// Operações autenticadas da própria clínica: status da licença/trial, onboarding (7 etapas) e checkout/fatura.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function roundMoney(v: number): number {
  return Math.round((Math.max(0, Number(v) || 0) + Number.EPSILON) * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Configuração do servidor incompleta.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Autenticação obrigatória.' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: authUser },
    error: authErr,
  } = await userClient.auth.getUser();

  if (authErr || !authUser) {
    return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerProfile, error: profileErr } = await adminClient
    .from('user_profiles')
    .select('id, user_id, organization_id, full_name, email, role_code, is_active')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (profileErr || !callerProfile || !callerProfile.is_active) {
    return jsonResponse({ error: 'Perfil de usuário inativo ou não encontrado.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Corpo JSON inválido.' }, 400);
  }

  const action = String(body.action || '');
  const orgId = String(callerProfile.organization_id);

  // Sincroniza eventuais trials vencidos no servidor antes de responder
  await adminClient.rpc('medsync_sync_expired_trials');

  if (action === 'get_org_billing_status') {
    await adminClient
      .from('organizations')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('id', orgId);

    const [orgRes, subRes, invRes] = await Promise.all([
      adminClient.from('organizations').select('*').eq('id', orgId).single(),
      adminClient.from('saas_subscriptions').select('*').eq('organization_id', orgId).maybeSingle(),
      adminClient
        .from('saas_invoices')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (orgRes.error) {
      return jsonResponse({ error: orgRes.error.message }, 500);
    }

    let planData: Record<string, unknown> | null = null;
    if (orgRes.data?.plan_id) {
      const { data: planRow } = await adminClient
        .from('plans')
        .select('*')
        .eq('id', orgRes.data.plan_id)
        .maybeSingle();
      planData = planRow || null;
    }

    return jsonResponse({
      success: true,
      organization: orgRes.data,
      plan: planData,
      subscription: subRes.data || null,
      invoices: invRes.data || [],
    });
  }

  if (action === 'update_onboarding_progress') {
    if (!['clinic_admin', 'super_admin', 'branch_admin'].includes(String(callerProfile.role_code))) {
      return jsonResponse({ error: 'Permissão insuficiente para atualizar o assistente inicial.' }, 403);
    }

    const completedSteps = Array.isArray(body.completedSteps)
      ? body.completedSteps.map((s) => String(s))
      : [];
    const skipped = Boolean(body.skipped);
    const currentStep = Math.max(1, Math.min(7, Number(body.currentStep || 1)));
    const onboardingCompleted =
      Boolean(body.onboardingCompleted ?? body.completed) || completedSteps.length >= 7;

    const progressPayload = {
      completedSteps,
      skipped,
      currentStep,
      updatedAt: new Date().toISOString(),
    };

    const { data: updatedOrg, error: updateErr } = await adminClient
      .from('organizations')
      .update({
        onboarding_progress: progressPayload,
        onboarding_completed: onboardingCompleted,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orgId)
      .select()
      .single();

    if (updateErr) {
      return jsonResponse({ error: updateErr.message }, 500);
    }

    return jsonResponse({
      success: true,
      organization: updatedOrg,
    });
  }

  if (action === 'create_checkout_session') {
    if (!['clinic_admin', 'super_admin'].includes(String(callerProfile.role_code))) {
      return jsonResponse(
        { error: 'Apenas o administrador da clínica pode iniciar a contratação de planos.' },
        403
      );
    }

    const planCode = String(body.planCode || '').trim();
    const billingCycle = String(body.billingCycle || 'monthly').trim().toLowerCase();
    if (!planCode || planCode === 'trial') {
      return jsonResponse({ error: 'Selecione um plano pago válido para contratação.' }, 400);
    }
    if (!['monthly', 'quarterly', 'yearly'].includes(billingCycle)) {
      return jsonResponse({ error: 'Ciclo de cobrança inválido.' }, 400);
    }

    const { data: planRow, error: planErr } = await adminClient
      .from('plans')
      .select('*')
      .eq('code', planCode)
      .eq('is_active', true)
      .maybeSingle();

    if (planErr || !planRow || Number(planRow.price_monthly || 0) <= 0) {
      return jsonResponse({ error: 'Plano selecionado não encontrado ou indisponível.' }, 404);
    }

    // Cálculo estrito no servidor via função SQL canônica (nunca confia em preço enviado pelo navegador)
    const unitMonthly = roundMoney(Number(planRow.price_monthly || 0));
    const qDiscount = Math.max(0, Math.min(95, Number(planRow.quarterly_discount_percent ?? 10)));
    const yDiscount = Math.max(0, Math.min(95, Number(planRow.yearly_discount_percent ?? 20)));

    const { data: sqlPricingRows, error: pricingErr } = await adminClient.rpc(
      'medsync_compute_plan_pricing',
      {
        p_price_monthly: unitMonthly,
        p_quarterly_discount: qDiscount,
        p_yearly_discount: yDiscount,
        p_cycle: billingCycle,
      }
    );

    if (pricingErr || !Array.isArray(sqlPricingRows) || sqlPricingRows.length === 0) {
      return jsonResponse({ error: 'Falha ao calcular valor oficial do plano no servidor.' }, 500);
    }

    const sqlPricing = sqlPricingRows[0] as Record<string, unknown>;
    const grossAmount = roundMoney(Number(sqlPricing.gross_amount ?? unitMonthly));
    const discountPercent = roundMoney(Number(sqlPricing.discount_percent ?? 0));
    const finalAmount = roundMoney(Number(sqlPricing.final_amount ?? unitMonthly));

    if (finalAmount <= 0) {
      return jsonResponse({ error: 'Valor calculado para o plano pago é inválido.' }, 400);
    }

    const referenceCode = `MED-${orgId.slice(0, 8).toUpperCase()}-${Date.now()}`;
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const kiwifyBase = (Deno.env.get('KIWIFY_CHECKOUT_BASE_URL') || '').trim();
    const checkoutUrl = kiwifyBase
      ? `${kiwifyBase}${kiwifyBase.includes('?') ? '&' : '?'}ref=${encodeURIComponent(referenceCode)}&email=${encodeURIComponent(String(callerProfile.email || ''))}&plan=${encodeURIComponent(planCode)}&cycle=${encodeURIComponent(billingCycle)}`
      : null;

    const { data: subRow } = await adminClient
      .from('saas_subscriptions')
      .select('id')
      .eq('organization_id', orgId)
      .maybeSingle();

    const { data: invoice, error: invErr } = await adminClient
      .from('saas_invoices')
      .insert({
        organization_id: orgId,
        subscription_id: subRow?.id || null,
        plan_id: planRow.id,
        billing_cycle: billingCycle,
        reference_code: referenceCode,
        gross_amount: grossAmount,
        discount_percent: discountPercent,
        final_amount: finalAmount,
        currency: 'BRL',
        status: 'pending',
        payment_provider: kiwifyBase ? 'kiwify' : 'pending_gateway',
        external_checkout_url: checkoutUrl,
        due_date: dueDate,
        metadata: {
          plan_code: planCode,
          plan_name: planRow.name,
          requested_by_profile_id: callerProfile.id,
          requested_by_email: callerProfile.email,
        },
      })
      .select()
      .single();

    if (invErr) {
      return jsonResponse({ error: invErr.message }, 500);
    }

    // Se a organização já estava expirada/inadimplente, sinaliza PAGAMENTO_PENDENTE sem liberar escrita prematura
    const { data: currentOrg } = await adminClient
      .from('organizations')
      .select('license_status')
      .eq('id', orgId)
      .single();

    if (currentOrg?.license_status === 'TESTE_EXPIRADO' || currentOrg?.license_status === 'INADIMPLENTE') {
      await adminClient
        .from('organizations')
        .update({
          license_status: 'PAGAMENTO_PENDENTE',
          plan_id: planRow.id,
          billing_cycle: billingCycle,
          status_reason: `Checkout iniciado (${referenceCode}). Aguardando confirmação de pagamento.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orgId);

      await adminClient
        .from('saas_subscriptions')
        .update({
          plan_id: planRow.id,
          billing_cycle: billingCycle,
          license_status: 'PAGAMENTO_PENDENTE',
          unit_monthly_price: unitMonthly,
          discount_percent: discountPercent,
          final_cycle_amount: finalAmount,
          payment_provider: kiwifyBase ? 'kiwify' : 'pending_gateway',
          updated_by: callerProfile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', orgId);
    }

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      target_organization_id: orgId,
      action: 'checkout_initiated',
      entity: 'saas_invoices',
      entity_id: invoice.id,
      reason: `Solicitação de assinatura ${planRow.name} (${billingCycle}).`,
      new_state: {
        reference_code: referenceCode,
        plan_code: planCode,
        billing_cycle: billingCycle,
        final_amount: finalAmount,
        status: 'pending',
      },
    });

    return jsonResponse({
      success: true,
      invoice,
      gatewayConfigured: Boolean(kiwifyBase),
      checkoutUrl,
      message: kiwifyBase
        ? 'Cobrança gerada. Conclua o pagamento no link seguro; sua licença será ativada após confirmação automática.'
        : 'Pedido de assinatura registrado com status Pendente. Conclua o pagamento junto ao financeiro/gateway para ativar a licença.',
    });
  }

  return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
});
