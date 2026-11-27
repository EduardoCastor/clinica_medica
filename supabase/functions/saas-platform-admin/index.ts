// Supabase Edge Function: saas-platform-admin
// Painel Geral do Super Administrador SaaS (sem acesso a prontuários ou dados clínicos de pacientes).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_LICENSE_STATUSES = [
  'TESTE_ATIVO',
  'TESTE_EXPIRADO',
  'ATIVA',
  'PAGAMENTO_PENDENTE',
  'INADIMPLENTE',
  'SUSPENSA',
  'CANCELADA',
] as const;

type LicenseStatus = (typeof VALID_LICENSE_STATUSES)[number];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function roundMoney(v: number): number {
  return Math.round((Math.max(0, Number(v) || 0) + Number.EPSILON) * 100) / 100;
}

function mapLegacyOrgStatus(licenseStatus: LicenseStatus): 'trial' | 'active' | 'overdue' | 'suspended' {
  if (licenseStatus === 'TESTE_ATIVO') return 'trial';
  if (licenseStatus === 'ATIVA') return 'active';
  if (
    licenseStatus === 'TESTE_EXPIRADO' ||
    licenseStatus === 'PAGAMENTO_PENDENTE' ||
    licenseStatus === 'INADIMPLENTE'
  ) {
    return 'overdue';
  }
  return 'suspended';
}

function addBillingCycleMonths(fromDate: Date, cycle: string): string {
  const next = new Date(fromDate.getTime());
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

  // Validação autoritativa no banco de dados (jamais confia em user_metadata/localStorage)
  const { data: callerProfile, error: profileErr } = await adminClient
    .from('user_profiles')
    .select('id, user_id, organization_id, full_name, email, role_code, is_active')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (
    profileErr ||
    !callerProfile ||
    !callerProfile.is_active ||
    callerProfile.role_code !== 'super_admin'
  ) {
    return jsonResponse(
      { error: 'Acesso negado: privilégio exclusivo de Super Administrador SaaS.' },
      403
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Corpo JSON inválido.' }, 400);
  }

  const action = String(body.action || '');

  // Sincroniza testes expirados antes de consultar ou alterar dados SaaS
  await adminClient.rpc('medsync_sync_expired_trials');

  // =========================================================================
  // 1. DASHBOARD GERAL SAAS (ZERO DADOS CLÍNICOS / ZERO PRONTUÁRIOS)
  // =========================================================================
  if (action === 'get_saas_dashboard_data') {
    const [orgsRes, plansRes, clinicsRes, branchesRes, usersRes, patientsCountRes, subsRes, invoicesRes, auditRes] =
      await Promise.all([
        adminClient.from('organizations').select('*').order('created_at', { ascending: false }),
        adminClient
          .from('plans')
          .select('*')
          .order('display_order', { ascending: true })
          .order('price_monthly', { ascending: true }),
        adminClient
          .from('clinics')
          .select('id, organization_id, legal_name, trade_name, document_number, email, phone, whatsapp, created_at'),
        adminClient.from('branches').select('id, organization_id, is_active'),
        adminClient.from('user_profiles').select('id, organization_id, is_active'),
        // Apenas contagem agregada por organização (nunca acessa dados clínicos, prontuários ou PII de pacientes)
        adminClient.from('patients').select('organization_id, is_active'),
        adminClient.from('saas_subscriptions').select('*'),
        adminClient
          .from('saas_invoices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(300),
        adminClient
          .from('saas_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

    if (orgsRes.error) return jsonResponse({ error: orgsRes.error.message }, 500);
    if (plansRes.error) return jsonResponse({ error: plansRes.error.message }, 500);

    const branchesByOrg: Record<string, number> = {};
    for (const row of branchesRes.data || []) {
      const oid = String(row.organization_id || '');
      if (oid && row.is_active !== false) {
        branchesByOrg[oid] = (branchesByOrg[oid] || 0) + 1;
      }
    }

    const usersByOrg: Record<string, number> = {};
    for (const row of usersRes.data || []) {
      const oid = String(row.organization_id || '');
      if (oid && row.is_active !== false) {
        usersByOrg[oid] = (usersByOrg[oid] || 0) + 1;
      }
    }

    const patientsByOrg: Record<string, number> = {};
    for (const row of patientsCountRes.data || []) {
      const oid = String(row.organization_id || '');
      if (oid && row.is_active !== false) {
        patientsByOrg[oid] = (patientsByOrg[oid] || 0) + 1;
      }
    }

    return jsonResponse({
      success: true,
      serverTime: new Date().toISOString(),
      organizations: orgsRes.data || [],
      plans: plansRes.data || [],
      clinics: clinicsRes.data || [],
      counts: {
        branchesByOrg,
        usersByOrg,
        patientsByOrg,
      },
      subscriptions: subsRes.data || [],
      invoices: invoicesRes.data || [],
      auditLogs: auditRes.data || [],
    });
  }

  // =========================================================================
  // 2. GESTÃO DE PLANOS E PREÇOS (SSOT SUPABASE)
  // =========================================================================
  if (action === 'upsert_plan') {
    const planInput = (body.plan || {}) as Record<string, unknown>;
    const code = String(planInput.code || '').trim().toLowerCase();
    const name = String(planInput.name || '').trim();
    if (!code || !name) {
      return jsonResponse({ error: 'Código e nome do plano são obrigatórios.' }, 400);
    }

    const priceMonthly = roundMoney(Number(planInput.priceMonthly || 0));
    const qDisc = Math.max(0, Math.min(95, roundMoney(Number(planInput.quarterlyDiscountPercent ?? (code === 'trial' ? 0 : 10)))));
    const yDisc = Math.max(0, Math.min(95, roundMoney(Number(planInput.yearlyDiscountPercent ?? (code === 'trial' ? 0 : 20)))));
    const priceQuarterly =
      code === 'trial' || priceMonthly <= 0
        ? 0
        : roundMoney(priceMonthly * 3 * (1 - qDisc / 100));
    const priceYearly =
      code === 'trial' || priceMonthly <= 0
        ? 0
        : roundMoney(priceMonthly * 12 * (1 - yDisc / 100));

    const { data: existingPlan } = await adminClient
      .from('plans')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    const dbPayload = {
      code,
      name,
      description: String(planInput.description || '').trim(),
      price_monthly: priceMonthly,
      price_quarterly: priceQuarterly,
      price_yearly: priceYearly,
      quarterly_discount_percent: qDisc,
      yearly_discount_percent: yDisc,
      display_order: Math.max(1, Number(planInput.displayOrder || 10)),
      trial_days: Math.max(0, Number(planInput.trialDays || 0)),
      max_branches: Math.max(1, Number(planInput.maxBranches || 1)),
      max_users: Math.max(1, Number(planInput.maxUsers || 1)),
      max_patients: Math.max(0, Number(planInput.maxPatients || 0)),
      has_patient_sharing: Boolean(planInput.hasPatientSharing),
      has_whatsapp_automation: Boolean(planInput.hasWhatsAppAutomation ?? planInput.hasWhatsappAutomation),
      has_custom_website: Boolean(planInput.hasCustomWebsite),
      has_financial_module: Boolean(planInput.hasFinancialModule),
      has_advanced_reports: Boolean(planInput.hasAdvancedReports),
      is_popular: Boolean(planInput.isPopular),
      is_active: planInput.isActive !== false,
      features: Array.isArray(planInput.features) ? planInput.features : [],
      updated_at: new Date().toISOString(),
    };

    const { data: savedPlan, error: saveErr } = await adminClient
      .from('plans')
      .upsert(dbPayload, { onConflict: 'code' })
      .select()
      .single();

    if (saveErr) {
      return jsonResponse({ error: saveErr.message }, 500);
    }

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      action: existingPlan ? 'update_plan' : 'create_plan',
      entity: 'plans',
      entity_id: String(savedPlan.id),
      reason: String(body.reason || 'Atualização de tabela comercial de planos.'),
      previous_state: existingPlan || null,
      new_state: savedPlan,
    });

    return jsonResponse({ success: true, plan: savedPlan });
  }

  // =========================================================================
  // 3. GESTÃO DE ORGANIZAÇÕES E LICENÇAS (MUDANÇA DE PLANO, VALIDADE, STATUS)
  // =========================================================================
  if (action === 'update_organization_license') {
    const targetOrgId = String(body.organizationId || '').trim();
    const reason = String(body.reason || '').trim();
    if (!targetOrgId) {
      return jsonResponse({ error: 'ID da organização é obrigatório.' }, 400);
    }
    if (reason.length < 5) {
      return jsonResponse(
        { error: 'Informe uma justificativa obrigatória (mínimo 5 caracteres) para alteração administrativa.' },
        400
      );
    }

    const { data: prevOrg, error: orgErr } = await adminClient
      .from('organizations')
      .select('*')
      .eq('id', targetOrgId)
      .single();

    if (orgErr || !prevOrg) {
      return jsonResponse({ error: 'Organização não encontrada.' }, 404);
    }

    const nextLicenseStatus = (
      body.licenseStatus && VALID_LICENSE_STATUSES.includes(String(body.licenseStatus) as LicenseStatus)
        ? String(body.licenseStatus)
        : prevOrg.license_status || 'TESTE_ATIVO'
    ) as LicenseStatus;

    const nextPlanId = body.planId ? String(body.planId) : prevOrg.plan_id;
    const nextBillingCycle = body.billingCycle ? String(body.billingCycle) : prevOrg.billing_cycle || 'monthly';
    const nextTrialEndsAt =
      body.trialEndsAt !== undefined ? (body.trialEndsAt ? String(body.trialEndsAt) : null) : prevOrg.trial_ends_at;
    const nextRenewsAt =
      body.subscriptionRenewsAt !== undefined
        ? body.subscriptionRenewsAt
          ? String(body.subscriptionRenewsAt)
          : null
        : prevOrg.subscription_renews_at;

    const nextLegacyStatus = mapLegacyOrgStatus(nextLicenseStatus);

    const { data: updatedOrg, error: updateErr } = await adminClient
      .from('organizations')
      .update({
        plan_id: nextPlanId,
        billing_cycle: nextBillingCycle,
        license_status: nextLicenseStatus,
        status: nextLegacyStatus,
        trial_ends_at: nextTrialEndsAt,
        subscription_renews_at: nextRenewsAt,
        status_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetOrgId)
      .select()
      .single();

    if (updateErr) {
      return jsonResponse({ error: updateErr.message }, 500);
    }

    // Atualizar saas_subscriptions sincronizado
    let unitMonthly = 0;
    let discountPercent = 0;
    let finalAmount = 0;
    if (nextPlanId) {
      const { data: pRow } = await adminClient.from('plans').select('*').eq('id', nextPlanId).maybeSingle();
      if (pRow) {
        unitMonthly = roundMoney(Number(pRow.price_monthly || 0));
        if (nextBillingCycle === 'quarterly') {
          discountPercent = Number(pRow.quarterly_discount_percent ?? 10);
          finalAmount = roundMoney(unitMonthly * 3 * (1 - discountPercent / 100));
        } else if (nextBillingCycle === 'yearly') {
          discountPercent = Number(pRow.yearly_discount_percent ?? 20);
          finalAmount = roundMoney(unitMonthly * 12 * (1 - discountPercent / 100));
        } else if (nextBillingCycle === 'monthly') {
          finalAmount = unitMonthly;
        }
      }
    }

    await adminClient.from('saas_subscriptions').upsert(
      {
        organization_id: targetOrgId,
        plan_id: nextPlanId,
        billing_cycle: nextBillingCycle,
        license_status: nextLicenseStatus,
        trial_ends_at: nextTrialEndsAt,
        current_period_end: nextRenewsAt || nextTrialEndsAt,
        next_due_date: nextRenewsAt || nextTrialEndsAt,
        unit_monthly_price: unitMonthly,
        discount_percent: discountPercent,
        final_cycle_amount: finalAmount,
        cancelled_at: nextLicenseStatus === 'CANCELADA' ? new Date().toISOString() : null,
        cancellation_reason: nextLicenseStatus === 'CANCELADA' ? reason : null,
        updated_by: callerProfile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' }
    );

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      target_organization_id: targetOrgId,
      action: 'update_organization_license',
      entity: 'organizations',
      entity_id: targetOrgId,
      reason,
      previous_state: {
        plan_id: prevOrg.plan_id,
        license_status: prevOrg.license_status,
        status: prevOrg.status,
        trial_ends_at: prevOrg.trial_ends_at,
        subscription_renews_at: prevOrg.subscription_renews_at,
      },
      new_state: {
        plan_id: updatedOrg.plan_id,
        license_status: updatedOrg.license_status,
        status: updatedOrg.status,
        trial_ends_at: updatedOrg.trial_ends_at,
        subscription_renews_at: updatedOrg.subscription_renews_at,
      },
    });

    return jsonResponse({ success: true, organization: updatedOrg });
  }

  // =========================================================================
  // 4. BAIXA MANUAL / CONFIRMAÇÃO DE PAGAMENTO COM AUDITORIA
  // =========================================================================
  if (action === 'confirm_manual_payment') {
    const invoiceId = body.invoiceId ? String(body.invoiceId) : null;
    const targetOrgId = String(body.organizationId || '').trim();
    const reason = String(body.reason || '').trim();
    const paymentMethod = String(body.paymentMethod || 'manual').trim();

    if (reason.length < 5) {
      return jsonResponse(
        { error: 'Informe uma justificativa obrigatória para confirmação manual de pagamento.' },
        400
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    let resolvedOrgId = targetOrgId;
    let resolvedPlanId = body.planId ? String(body.planId) : '';
    let resolvedCycle = String(body.billingCycle || 'monthly');
    let settledInvoice: Record<string, unknown> | null = null;

    if (invoiceId) {
      const { data: inv, error: invErr } = await adminClient
        .from('saas_invoices')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (invErr || !inv) {
        return jsonResponse({ error: 'Cobrança não encontrada.' }, 404);
      }
      if (inv.status === 'paid') {
        return jsonResponse({ error: 'Esta cobrança já está confirmada como paga.' }, 409);
      }

      resolvedOrgId = String(inv.organization_id);
      resolvedPlanId = String(inv.plan_id || resolvedPlanId);
      resolvedCycle = String(inv.billing_cycle || resolvedCycle);

      const { data: updatedInv, error: updInvErr } = await adminClient
        .from('saas_invoices')
        .update({
          status: 'paid',
          payment_method: paymentMethod,
          payment_provider: 'manual',
          paid_at: nowIso,
          manual_confirmation_reason: reason,
          confirmed_by_profile_id: callerProfile.id,
          confirmed_by_email: callerProfile.email,
          updated_at: nowIso,
        })
        .eq('id', invoiceId)
        .select()
        .single();

      if (updInvErr) return jsonResponse({ error: updInvErr.message }, 500);
      settledInvoice = updatedInv;
    } else {
      if (!resolvedOrgId || !resolvedPlanId) {
        return jsonResponse({ error: 'Organização e plano são obrigatórios para lançar pagamento manual.' }, 400);
      }
      const { data: planRow, error: planErr } = await adminClient
        .from('plans')
        .select('*')
        .eq('id', resolvedPlanId)
        .single();

      if (planErr || !planRow) {
        return jsonResponse({ error: 'Plano não encontrado.' }, 404);
      }

      const unitMonthly = roundMoney(Number(planRow.price_monthly || 0));
      const qDisc = Number(planRow.quarterly_discount_percent ?? 10);
      const yDisc = Number(planRow.yearly_discount_percent ?? 20);
      let gross = unitMonthly;
      let disc = 0;
      let finalVal = unitMonthly;
      if (resolvedCycle === 'quarterly') {
        gross = roundMoney(unitMonthly * 3);
        disc = qDisc;
        finalVal = roundMoney(gross * (1 - disc / 100));
      } else if (resolvedCycle === 'yearly') {
        gross = roundMoney(unitMonthly * 12);
        disc = yDisc;
        finalVal = roundMoney(gross * (1 - disc / 100));
      }

      const { data: createdInv, error: insErr } = await adminClient
        .from('saas_invoices')
        .insert({
          organization_id: resolvedOrgId,
          plan_id: resolvedPlanId,
          billing_cycle: resolvedCycle,
          reference_code: `MAN-${resolvedOrgId.slice(0, 8).toUpperCase()}-${Date.now()}`,
          gross_amount: gross,
          discount_percent: disc,
          final_amount: finalVal,
          currency: 'BRL',
          status: 'paid',
          payment_method: paymentMethod,
          payment_provider: 'manual',
          due_date: nowIso,
          paid_at: nowIso,
          manual_confirmation_reason: reason,
          confirmed_by_profile_id: callerProfile.id,
          confirmed_by_email: callerProfile.email,
        })
        .select()
        .single();

      if (insErr) return jsonResponse({ error: insErr.message }, 500);
      settledInvoice = createdInv;
    }

    const nextRenewalIso = addBillingCycleMonths(now, resolvedCycle);

    const { data: updatedOrg, error: orgUpdErr } = await adminClient
      .from('organizations')
      .update({
        plan_id: resolvedPlanId || undefined,
        billing_cycle: resolvedCycle,
        license_status: 'ATIVA',
        status: 'active',
        subscription_renews_at: nextRenewalIso,
        status_reason: `Pagamento confirmado manualmente: ${reason}`,
        updated_at: nowIso,
      })
      .eq('id', resolvedOrgId)
      .select()
      .single();

    if (orgUpdErr) return jsonResponse({ error: orgUpdErr.message }, 500);

    await adminClient.from('saas_subscriptions').upsert(
      {
        organization_id: resolvedOrgId,
        plan_id: resolvedPlanId || updatedOrg.plan_id,
        billing_cycle: resolvedCycle,
        license_status: 'ATIVA',
        current_period_start: nowIso,
        current_period_end: nextRenewalIso,
        next_due_date: nextRenewalIso,
        final_cycle_amount: Number(settledInvoice?.final_amount || 0),
        payment_provider: 'manual',
        updated_by: callerProfile.id,
        updated_at: nowIso,
      },
      { onConflict: 'organization_id' }
    );

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      target_organization_id: resolvedOrgId,
      action: 'confirm_manual_payment',
      entity: 'saas_invoices',
      entity_id: String(settledInvoice?.id || ''),
      reason,
      new_state: {
        invoice_id: settledInvoice?.id,
        final_amount: settledInvoice?.final_amount,
        license_status: 'ATIVA',
        subscription_renews_at: nextRenewalIso,
      },
    });

    return jsonResponse({
      success: true,
      invoice: settledInvoice,
      organization: updatedOrg,
    });
  }

  return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
});
