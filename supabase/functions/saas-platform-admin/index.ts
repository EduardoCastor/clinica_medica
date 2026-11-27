// Supabase Edge Function: saas-platform-admin
// Painel Geral do Super Administrador SaaS (sem acesso a prontuários ou dados clínicos de pacientes).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const PLATFORM_SUPER_ADMIN_EMAIL = 'beaverstraining@gmail.com.br';
const LEGACY_CLINIC_ADMIN_EMAIL = 'admin@drnewtonmureb.com.br';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AuthLookupUser {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
  user_metadata?: Record<string, unknown>;
}

async function findAuthUserByEmail(
  adminClient: SupabaseClient,
  targetEmail: string
): Promise<{ user: AuthLookupUser | null; error?: string }> {
  const clean = targetEmail.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      return { user: null, error: error.message };
    }
    const users = (data?.users || []) as AuthLookupUser[];
    const match = users.find((u) => (u.email || '').trim().toLowerCase() === clean);
    if (match) {
      return { user: match };
    }
    if (users.length < 1000) break;
  }
  return { user: null };
}

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Corpo JSON inválido.' }, 400);
  }

  const action = String(body.action || '');

  // =========================================================================
  // 0. ATIVAÇÃO VERIFICADA DO NOVO SUPER ADMIN DA PLATAFORMA (CENÁRIO B)
  //    Exige conta autenticada + e-mail confirmado == beaverstraining@gmail.com.br
  // =========================================================================
  if (action === 'claim_verified_platform_super_admin') {
    const callerEmail = (authUser.email || '').trim().toLowerCase();
    if (callerEmail !== PLATFORM_SUPER_ADMIN_EMAIL) {
      return jsonResponse(
        {
          error: `Acesso negado: apenas a conta autorizada ${PLATFORM_SUPER_ADMIN_EMAIL} pode ativar o Super Admin da plataforma.`,
        },
        403
      );
    }

    const { data: liveAuthRes, error: liveAuthErr } = await adminClient.auth.admin.getUserById(authUser.id);
    const liveAuthUser = liveAuthRes?.user as AuthLookupUser | undefined;
    if (
      liveAuthErr ||
      !liveAuthUser ||
      (liveAuthUser.email || '').trim().toLowerCase() !== PLATFORM_SUPER_ADMIN_EMAIL
    ) {
      return jsonResponse({ error: 'Conta autenticada não confirmada para esta operação.' }, 403);
    }

    if (!liveAuthUser.email_confirmed_at) {
      return jsonResponse(
        {
          error: `Confirme o e-mail ${PLATFORM_SUPER_ADMIN_EMAIL} pelo link enviado antes de ativar o painel geral.`,
        },
        403
      );
    }

    const { data: pendingAdmin } = await adminClient
      .from('saas_platform_admins')
      .select('id, email, status, is_active')
      .ilike('email', PLATFORM_SUPER_ADMIN_EMAIL)
      .maybeSingle();

    if (!pendingAdmin || pendingAdmin.status === 'revoked') {
      return jsonResponse(
        { error: 'Autorização de transferência não encontrada ou revogada no servidor.' },
        403
      );
    }

    const fullName =
      typeof body.fullName === 'string' && body.fullName.trim().length >= 3
        ? body.fullName.trim()
        : 'Beaver Soluções em Tecnologia';

    const { data: transferRes, error: transferErr } = await adminClient.rpc(
      'medsync_finalize_platform_super_admin_transfer',
      {
        p_auth_user_id: liveAuthUser.id,
        p_auth_email: PLATFORM_SUPER_ADMIN_EMAIL,
        p_full_name: fullName,
        p_email_confirmed_at: liveAuthUser.email_confirmed_at,
        p_actor_user_id: liveAuthUser.id,
      }
    );

    if (transferErr) {
      return jsonResponse({ error: transferErr.message }, 400);
    }

    return jsonResponse({
      success: true,
      transfer: transferRes,
    });
  }

  // Validação autoritativa no banco de dados (user_profiles + saas_platform_admins)
  const [profileRes, platformAdminRes] = await Promise.all([
    adminClient
      .from('user_profiles')
      .select('id, user_id, organization_id, full_name, email, role_code, is_active')
      .eq('user_id', authUser.id)
      .maybeSingle(),
    adminClient
      .from('saas_platform_admins')
      .select('id, user_id, email, is_active, status')
      .eq('user_id', authUser.id)
      .eq('is_active', true)
      .eq('status', 'active')
      .maybeSingle(),
  ]);

  const callerProfile = profileRes.data;
  const callerPlatformAdmin = platformAdminRes.data;

  if (
    profileRes.error ||
    platformAdminRes.error ||
    !callerProfile ||
    !callerProfile.is_active ||
    callerProfile.role_code !== 'super_admin' ||
    !callerPlatformAdmin
  ) {
    return jsonResponse(
      { error: 'Acesso negado: privilégio exclusivo de Super Administrador SaaS ativo na plataforma.' },
      403
    );
  }

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
  // 2. GESTÃO DE PLANOS E PREÇOS (SSOT SUPABASE + VERIFICAÇÃO DE PERSISTÊNCIA)
  // =========================================================================
  if (action === 'upsert_plan') {
    const planInput = (body.plan || {}) as Record<string, unknown>;
    const rawId = planInput.id ? String(planInput.id).trim() : '';
    const isExistingById = Boolean(rawId);
    const code = String(planInput.code || '').trim().toLowerCase();
    const name = String(planInput.name || '').trim();

    if (!code || !/^[a-z0-9][a-z0-9_-]{1,48}$/.test(code)) {
      return jsonResponse(
        { error: 'Código do plano inválido. Use apenas letras minúsculas, números, hífen ou underscore (mín. 2 caracteres).' },
        400
      );
    }
    if (name.length < 2) {
      return jsonResponse({ error: 'Nome do plano é obrigatório (mín. 2 caracteres).' }, 400);
    }

    const isTrialCode = code === 'trial';
    const rawPriceMonthly = roundMoney(Number(planInput.priceMonthly ?? 0));
    const priceMonthly = isTrialCode ? 0 : rawPriceMonthly;
    const isFree = isTrialCode || priceMonthly <= 0;
    const qDisc = isFree
      ? 0
      : Math.max(0, Math.min(95, roundMoney(Number(planInput.quarterlyDiscountPercent ?? 10))));
    const yDisc = isFree
      ? 0
      : Math.max(0, Math.min(95, roundMoney(Number(planInput.yearlyDiscountPercent ?? 20))));

    // Cálculo autoritativo no PostgreSQL via medsync_compute_plan_pricing
    let priceQuarterly = 0;
    let priceYearly = 0;
    if (!isFree) {
      const [qRpc, yRpc] = await Promise.all([
        adminClient.rpc('medsync_compute_plan_pricing', {
          p_price_monthly: priceMonthly,
          p_quarterly_discount: qDisc,
          p_yearly_discount: yDisc,
          p_cycle: 'quarterly',
        }),
        adminClient.rpc('medsync_compute_plan_pricing', {
          p_price_monthly: priceMonthly,
          p_quarterly_discount: qDisc,
          p_yearly_discount: yDisc,
          p_cycle: 'yearly',
        }),
      ]);

      if (qRpc.error || !Array.isArray(qRpc.data) || qRpc.data.length === 0) {
        return jsonResponse({ error: 'Falha ao calcular valor trimestral no servidor.' }, 500);
      }
      if (yRpc.error || !Array.isArray(yRpc.data) || yRpc.data.length === 0) {
        return jsonResponse({ error: 'Falha ao calcular valor anual no servidor.' }, 500);
      }

      priceQuarterly = roundMoney(Number((qRpc.data[0] as Record<string, unknown>).final_amount ?? 0));
      priceYearly = roundMoney(Number((yRpc.data[0] as Record<string, unknown>).final_amount ?? 0));
    }

    let previousPlan: Record<string, unknown> | null = null;
    if (isExistingById) {
      const { data: existingById, error: existingErr } = await adminClient
        .from('plans')
        .select('*')
        .eq('id', rawId)
        .maybeSingle();

      if (existingErr) {
        return jsonResponse({ error: existingErr.message }, 500);
      }
      if (!existingById) {
        return jsonResponse(
          {
            success: false,
            notFound: true,
            error: 'Este plano não existe mais no banco de dados. Atualize a listagem.',
          },
          404
        );
      }
      previousPlan = existingById as Record<string, unknown>;
    } else {
      const { data: dupByCode } = await adminClient
        .from('plans')
        .select('id, code')
        .eq('code', code)
        .maybeSingle();

      if (dupByCode) {
        return jsonResponse(
          { error: `Já existe um plano cadastrado com o código "${code}".` },
          409
        );
      }
    }

    if (previousPlan && String(previousPlan.code) !== code) {
      const { data: codeConflict } = await adminClient
        .from('plans')
        .select('id')
        .eq('code', code)
        .neq('id', rawId)
        .maybeSingle();

      if (codeConflict) {
        return jsonResponse(
          { error: `Já existe outro plano utilizando o código "${code}".` },
          409
        );
      }
    }

    const nextActive = isTrialCode ? true : planInput.isActive !== false;
    const nowIso = new Date().toISOString();

    const dbPayload = {
      code: previousPlan ? String(previousPlan.code) : code,
      name,
      description: String(planInput.description || '').trim(),
      price_monthly: priceMonthly,
      price_quarterly: priceQuarterly,
      price_yearly: priceYearly,
      quarterly_discount_percent: qDisc,
      yearly_discount_percent: yDisc,
      display_order: Math.max(1, Math.round(Number(planInput.displayOrder || (isTrialCode ? 1 : 10)))),
      trial_days: isTrialCode
        ? Math.max(1, Math.round(Number(planInput.trialDays || 10)))
        : Math.max(0, Math.round(Number(planInput.trialDays || 0))),
      max_branches: Math.max(1, Math.round(Number(planInput.maxBranches || 1))),
      max_users: Math.max(1, Math.round(Number(planInput.maxUsers || 1))),
      max_patients: Math.max(0, Math.round(Number(planInput.maxPatients || 0))),
      has_patient_sharing: Boolean(planInput.hasPatientSharing),
      has_whatsapp_automation: Boolean(planInput.hasWhatsAppAutomation ?? planInput.hasWhatsappAutomation),
      has_custom_website: Boolean(planInput.hasCustomWebsite),
      has_financial_module: Boolean(planInput.hasFinancialModule),
      has_advanced_reports: Boolean(planInput.hasAdvancedReports),
      is_popular: isTrialCode ? false : Boolean(planInput.isPopular),
      is_active: nextActive,
      archived_at: nextActive ? null : previousPlan?.archived_at || nowIso,
      archived_reason: nextActive ? null : previousPlan?.archived_reason || 'Desativado no editor de planos',
      features: Array.isArray(planInput.features) ? planInput.features : [],
      updated_at: nowIso,
    };

    let savedId = rawId;
    if (previousPlan) {
      const { error: updErr } = await adminClient
        .from('plans')
        .update(dbPayload)
        .eq('id', rawId);

      if (updErr) {
        return jsonResponse({ error: updErr.message }, 500);
      }
    } else {
      const { data: insertedRow, error: insErr } = await adminClient
        .from('plans')
        .insert(dbPayload)
        .select('id')
        .single();

      if (insErr || !insertedRow) {
        return jsonResponse({ error: insErr?.message || 'Erro ao criar plano.' }, 500);
      }
      savedId = String(insertedRow.id);
    }

    // Releitura real no banco para confirmar persistência antes de responder sucesso
    const { data: verifiedPlan, error: verifyErr } = await adminClient
      .from('plans')
      .select('*')
      .eq('id', savedId)
      .single();

    if (verifyErr || !verifiedPlan) {
      return jsonResponse(
        { error: 'Não foi possível confirmar a persistência do plano no Supabase.' },
        500
      );
    }

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      action: previousPlan ? 'update_plan' : 'create_plan',
      entity: 'plans',
      entity_id: String(verifiedPlan.id),
      reason: String(body.reason || 'Atualização de tabela comercial de planos.'),
      previous_state: previousPlan,
      new_state: verifiedPlan,
    });

    return jsonResponse({ success: true, plan: verifiedPlan });
  }

  // =========================================================================
  // 2B. EXCLUSÃO IDEMPOTENTE E PROTEGIDA DE PLANOS
  // =========================================================================
  if (action === 'delete_plan') {
    const planId = String(body.planId || '').trim();
    const reason = String(body.reason || 'Exclusão de plano via Administração Geral SaaS').trim();

    if (!planId) {
      return jsonResponse({ error: 'ID do plano é obrigatório para exclusão.' }, 400);
    }

    const { data: existingPlan, error: fetchErr } = await adminClient
      .from('plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle();

    if (fetchErr) {
      return jsonResponse({ error: fetchErr.message }, 500);
    }

    if (!existingPlan) {
      return jsonResponse({
        success: true,
        status: 'not_found',
        deleted: false,
        message: 'Este plano já havia sido removido do banco de dados. A listagem foi atualizada.',
      });
    }

    if (String(existingPlan.code) === 'trial') {
      return jsonResponse({
        success: true,
        status: 'blocked_system_plan',
        deleted: false,
        message:
          'O plano Grátis (trial) é obrigatório para o fluxo de avaliação gratuita de 10 dias e não pode ser excluído.',
      });
    }

    const [orgsRef, subsRef, invsRef] = await Promise.all([
      adminClient.from('organizations').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
      adminClient.from('saas_subscriptions').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
      adminClient.from('saas_invoices').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
    ]);

    if (orgsRef.error || subsRef.error || invsRef.error) {
      return jsonResponse(
        {
          error:
            orgsRef.error?.message ||
            subsRef.error?.message ||
            invsRef.error?.message ||
            'Falha ao verificar vínculos do plano.',
        },
        500
      );
    }

    const orgCount = orgsRef.count || 0;
    const subCount = subsRef.count || 0;
    const invCount = invsRef.count || 0;
    const totalRefs = orgCount + subCount + invCount;

    if (totalRefs > 0) {
      return jsonResponse({
        success: true,
        status: 'blocked_in_use',
        deleted: false,
        references: {
          organizations: orgCount,
          subscriptions: subCount,
          invoices: invCount,
          total: totalRefs,
        },
        message: `Não é possível excluir "${existingPlan.name}" porque há ${orgCount} organização(ões), ${subCount} assinatura(s) e ${invCount} fatura(s) vinculadas. Utilize "Arquivar / Desativar" para preservar o histórico.`,
      });
    }

    const { data: deletedRow, error: delErr } = await adminClient
      .from('plans')
      .delete()
      .eq('id', planId)
      .select('id')
      .maybeSingle();

    if (delErr) {
      const msg = delErr.message || '';
      if (msg.includes('PLAN_IN_USE') || msg.includes('PLAN_SYSTEM_PROTECTED')) {
        return jsonResponse({
          success: true,
          status: msg.includes('PLAN_SYSTEM_PROTECTED') ? 'blocked_system_plan' : 'blocked_in_use',
          deleted: false,
          message: msg,
        });
      }
      return jsonResponse({ error: msg }, 500);
    }

    if (!deletedRow) {
      return jsonResponse({
        success: true,
        status: 'not_found',
        deleted: false,
        message: 'Este plano já havia sido removido do banco de dados. A listagem foi atualizada.',
      });
    }

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      action: 'delete_plan',
      entity: 'plans',
      entity_id: planId,
      reason,
      previous_state: existingPlan,
      new_state: null,
    });

    return jsonResponse({
      success: true,
      status: 'deleted',
      deleted: true,
      deletedId: planId,
      message: `Plano "${existingPlan.name}" excluído definitivamente do Supabase.`,
    });
  }

  // =========================================================================
  // 2C. ARQUIVAMENTO / DESATIVAÇÃO / REATIVAÇÃO SEGURA DE PLANOS
  // =========================================================================
  if (action === 'archive_plan') {
    const planId = String(body.planId || '').trim();
    const nextIsActive = Boolean(body.isActive);
    const reason = String(
      body.reason ||
        (nextIsActive
          ? 'Reativação comercial de plano na Administração Geral SaaS'
          : 'Arquivamento / desativação comercial preservando vínculos históricos')
    ).trim();

    if (!planId) {
      return jsonResponse({ error: 'ID do plano é obrigatório.' }, 400);
    }

    const { data: existingPlan, error: fetchErr } = await adminClient
      .from('plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle();

    if (fetchErr) {
      return jsonResponse({ error: fetchErr.message }, 500);
    }

    if (!existingPlan) {
      return jsonResponse(
        {
          success: false,
          status: 'not_found',
          notFound: true,
          error: 'Este plano não foi encontrado no banco de dados. A listagem será atualizada.',
        },
        404
      );
    }

    if (String(existingPlan.code) === 'trial' && !nextIsActive) {
      return jsonResponse(
        {
          error:
            'O plano Grátis (trial) é obrigatório para novos cadastros de avaliação de 10 dias e não pode ser desativado.',
        },
        400
      );
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await adminClient
      .from('plans')
      .update({
        is_active: nextIsActive,
        archived_at: nextIsActive ? null : nowIso,
        archived_reason: nextIsActive ? null : reason,
        updated_at: nowIso,
      })
      .eq('id', planId);

    if (updErr) {
      return jsonResponse({ error: updErr.message }, 500);
    }

    const { data: verifiedPlan, error: verifyErr } = await adminClient
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (verifyErr || !verifiedPlan) {
      return jsonResponse(
        { error: 'Falha ao confirmar atualização de status do plano no Supabase.' },
        500
      );
    }

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      action: nextIsActive ? 'reactivate_plan' : 'archive_plan',
      entity: 'plans',
      entity_id: planId,
      reason,
      previous_state: existingPlan,
      new_state: verifiedPlan,
    });

    return jsonResponse({
      success: true,
      status: nextIsActive ? 'reactivated' : 'archived',
      plan: verifiedPlan,
      message: nextIsActive
        ? `Plano "${verifiedPlan.name}" reativado para comercialização.`
        : `Plano "${verifiedPlan.name}" arquivado com histórico preservado.`,
    });
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
      const qDisc = Math.max(0, Math.min(95, Number(planRow.quarterly_discount_percent ?? 10)));
      const yDisc = Math.max(0, Math.min(95, Number(planRow.yearly_discount_percent ?? 20)));
      const { data: sqlPricingRows, error: pricingErr } = await adminClient.rpc(
        'medsync_compute_plan_pricing',
        {
          p_price_monthly: unitMonthly,
          p_quarterly_discount: qDisc,
          p_yearly_discount: yDisc,
          p_cycle: resolvedCycle,
        }
      );
      if (pricingErr || !Array.isArray(sqlPricingRows) || sqlPricingRows.length === 0) {
        return jsonResponse({ error: 'Falha ao calcular valor do plano no servidor.' }, 500);
      }
      const sqlPricing = sqlPricingRows[0] as Record<string, unknown>;
      const gross = roundMoney(Number(sqlPricing.gross_amount ?? unitMonthly));
      const disc = roundMoney(Number(sqlPricing.discount_percent ?? 0));
      const finalVal = roundMoney(Number(sqlPricing.final_amount ?? unitMonthly));

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

  // =========================================================================
  // 5. GESTÃO DE SEPARAÇÃO DE IDENTIDADES E TRANSFERÊNCIA DE SUPER ADMIN
  // =========================================================================
  if (action === 'get_super_admin_transfer_status') {
    const [adminsRes, clinicProfileRes, targetLookup] = await Promise.all([
      adminClient
        .from('saas_platform_admins')
        .select('id, user_id, user_profile_id, email, full_name, is_active, status, promoted_from_email, activated_at, revoked_at, created_at')
        .order('created_at', { ascending: true }),
      adminClient
        .from('user_profiles')
        .select('id, user_id, organization_id, full_name, email, role_code, is_active, created_at')
        .ilike('email', LEGACY_CLINIC_ADMIN_EMAIL)
        .limit(5),
      findAuthUserByEmail(adminClient, PLATFORM_SUPER_ADMIN_EMAIL),
    ]);

    if (adminsRes.error) {
      return jsonResponse({ error: adminsRes.error.message }, 500);
    }

    const clinicProfiles = clinicProfileRes.data || [];
    const primaryClinicProfile =
      clinicProfiles.find((p) => Boolean(p.organization_id)) || clinicProfiles[0] || null;

    let clinicOrgName: string | null = null;
    if (primaryClinicProfile?.organization_id) {
      const { data: orgRow } = await adminClient
        .from('organizations')
        .select('name')
        .eq('id', primaryClinicProfile.organization_id)
        .maybeSingle();
      clinicOrgName = orgRow?.name ? String(orgRow.name) : null;
    }

    const targetAuth = targetLookup.user;
    return jsonResponse({
      success: true,
      targetEmail: PLATFORM_SUPER_ADMIN_EMAIL,
      clinicAdminEmail: LEGACY_CLINIC_ADMIN_EMAIL,
      platformAdmins: adminsRes.data || [],
      targetAuthStatus: {
        exists: Boolean(targetAuth),
        authUserId: targetAuth?.id || null,
        emailConfirmedAt: targetAuth?.email_confirmed_at || null,
        lastSignInAt: targetAuth?.last_sign_in_at || null,
      },
      clinicAdminProfile: primaryClinicProfile
        ? {
            id: primaryClinicProfile.id,
            userId: primaryClinicProfile.user_id,
            organizationId: primaryClinicProfile.organization_id,
            organizationName: clinicOrgName,
            fullName: primaryClinicProfile.full_name,
            email: primaryClinicProfile.email,
            roleCode: primaryClinicProfile.role_code,
            isActive: primaryClinicProfile.is_active,
          }
        : null,
    });
  }

  if (action === 'invite_new_super_admin') {
    const requestedEmail = String(body.targetEmail || PLATFORM_SUPER_ADMIN_EMAIL)
      .trim()
      .toLowerCase();
    if (requestedEmail !== PLATFORM_SUPER_ADMIN_EMAIL) {
      return jsonResponse(
        {
          error: `Transferência autorizada exclusivamente para ${PLATFORM_SUPER_ADMIN_EMAIL}.`,
        },
        403
      );
    }

    const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined;
    const { user: existingAuth, error: lookupErr } = await findAuthUserByEmail(
      adminClient,
      PLATFORM_SUPER_ADMIN_EMAIL
    );
    if (lookupErr) {
      return jsonResponse({ error: lookupErr }, 500);
    }

    if (existingAuth && existingAuth.email_confirmed_at) {
      const { data: transferRes, error: transferErr } = await adminClient.rpc(
        'medsync_finalize_platform_super_admin_transfer',
        {
          p_auth_user_id: existingAuth.id,
          p_auth_email: PLATFORM_SUPER_ADMIN_EMAIL,
          p_full_name: 'Beaver Soluções em Tecnologia',
          p_email_confirmed_at: existingAuth.email_confirmed_at,
          p_actor_user_id: authUser.id,
        }
      );
      if (transferErr) {
        return jsonResponse({ error: transferErr.message }, 400);
      }
      return jsonResponse({
        success: true,
        status: 'transferred',
        transfer: transferRes,
        message: `Conta ${PLATFORM_SUPER_ADMIN_EMAIL} já confirmada no Auth; transferência de Super Admin concluída imediatamente e ${LEGACY_CLINIC_ADMIN_EMAIL} preservado como clinic_admin.`,
      });
    }

    let invitedUserId: string | null = existingAuth?.id || null;
    if (!existingAuth) {
      const { data: inviteRes, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        PLATFORM_SUPER_ADMIN_EMAIL,
        {
          redirectTo,
          data: {
            full_name: 'Beaver Soluções em Tecnologia',
          },
        }
      );
      if (inviteErr || !inviteRes?.user) {
        return jsonResponse(
          { error: inviteErr?.message || 'Não foi possível enviar convite oficial via Supabase Auth.' },
          400
        );
      }
      invitedUserId = inviteRes.user.id;
    } else {
      await adminClient.auth.resetPasswordForEmail(PLATFORM_SUPER_ADMIN_EMAIL, {
        redirectTo,
      });
    }

    await adminClient.from('saas_platform_admins').upsert(
      {
        user_id: invitedUserId,
        email: PLATFORM_SUPER_ADMIN_EMAIL,
        full_name: 'Beaver Soluções em Tecnologia',
        is_active: false,
        status: 'pending_activation',
        promoted_from_email: callerProfile.email,
      },
      { onConflict: 'email' }
    );

    await adminClient.from('saas_audit_logs').insert({
      actor_user_id: authUser.id,
      actor_profile_id: callerProfile.id,
      actor_email: callerProfile.email,
      actor_role: callerProfile.role_code,
      action: 'invite_platform_super_admin',
      entity: 'saas_platform_admins',
      reason: `Convite oficial enviado para ${PLATFORM_SUPER_ADMIN_EMAIL} assumir o Super Admin SaaS após confirmação de e-mail.`,
      new_state: {
        pending_super_admin_email: PLATFORM_SUPER_ADMIN_EMAIL,
        auth_user_id: invitedUserId,
        reused_unconfirmed_auth: Boolean(existingAuth),
      },
    });

    return jsonResponse({
      success: true,
      status: existingAuth ? 'awaiting_confirmation' : 'invited',
      authUserId: invitedUserId,
      message: existingAuth
        ? `A conta ${PLATFORM_SUPER_ADMIN_EMAIL} já existe e recebeu instruções para confirmação de e-mail e definição de senha.`
        : `Convite oficial enviado para ${PLATFORM_SUPER_ADMIN_EMAIL}. Após aceitar o convite e definir a senha própria, conclua a transferência.`,
    });
  }

  if (action === 'finalize_super_admin_transfer') {
    const { user: targetAuth, error: lookupErr } = await findAuthUserByEmail(
      adminClient,
      PLATFORM_SUPER_ADMIN_EMAIL
    );
    if (lookupErr) {
      return jsonResponse({ error: lookupErr }, 500);
    }

    if (!targetAuth) {
      return jsonResponse(
        {
          error: `A conta ${PLATFORM_SUPER_ADMIN_EMAIL} ainda não foi criada no Supabase Auth. Envie o convite oficial antes de transferir.`,
        },
        409
      );
    }

    if (!targetAuth.email_confirmed_at) {
      return jsonResponse(
        {
          error: `A conta ${PLATFORM_SUPER_ADMIN_EMAIL} ainda não confirmou o e-mail. Para evitar bloqueio da plataforma, a transferência só é liberada após confirmação.`,
        },
        409
      );
    }

    const { data: transferRes, error: transferErr } = await adminClient.rpc(
      'medsync_finalize_platform_super_admin_transfer',
      {
        p_auth_user_id: targetAuth.id,
        p_auth_email: PLATFORM_SUPER_ADMIN_EMAIL,
        p_full_name: 'Beaver Soluções em Tecnologia',
        p_email_confirmed_at: targetAuth.email_confirmed_at,
        p_actor_user_id: authUser.id,
      }
    );

    if (transferErr) {
      return jsonResponse({ error: transferErr.message }, 400);
    }

    return jsonResponse({
      success: true,
      status: 'transferred',
      transfer: transferRes,
      message: `Transferência concluída: ${PLATFORM_SUPER_ADMIN_EMAIL} agora é o único Super Admin da plataforma SaaS e ${LEGACY_CLINIC_ADMIN_EMAIL} foi preservado como clinic_admin da Clínica Dr. Newton Mureb.`,
    });
  }

  return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
});
