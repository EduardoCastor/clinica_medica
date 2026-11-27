import {
  BillingCycle,
  Clinic,
  LicenseStatus,
  OnboardingProgress,
  Organization,
  Plan,
  SaasAuditLog,
  SaasInvoice,
  SaasInvoiceStatus,
  SaasSubscription,
} from '../types';
import { getSupabase, getSupabaseCredentials } from './supabaseClient';
import {
  calculatePlanCyclePricing,
  clampDiscountPercent,
  deriveQuarterlyDiscount,
  deriveYearlyDiscount,
  normalizeOnboardingProgress,
  resolveCanonicalLicenseStatus,
  roundMoney,
  sortPlansByCommercialOrder,
} from './saasCommercialUtils';

export interface StrictPlansFetchResult {
  success: boolean;
  plans: Plan[];
  error?: string;
  fetchedAt?: string;
}

export interface TrialSignupInput {
  clinicName: string;
  responsibleName: string;
  email: string;
  phone: string;
  documentNumber?: string;
  password: string;
  confirmPassword: string;
  planCode?: string;
}

export interface TrialSignupResult {
  success: boolean;
  requiresEmailConfirmation?: boolean;
  organizationId?: string;
  clinicId?: string;
  trialEndsAt?: string;
  signedIn?: boolean;
  error?: string;
}

export interface ClinicBillingStatusResult {
  success: boolean;
  organization?: Organization;
  plan?: Plan | null;
  subscription?: SaasSubscription | null;
  invoices?: SaasInvoice[];
  error?: string;
}

export interface SaasAdminTenantRecord {
  organization: Organization;
  clinic?: Clinic;
  plan?: Plan;
  subscription?: SaasSubscription;
  branchesCount: number;
  activeUsersCount: number;
  patientsCount: number;
  lastPaidAt?: string;
  nextDueDate?: string;
}

export interface SaasAdminDashboardPayload {
  plans: Plan[];
  tenants: SaasAdminTenantRecord[];
  subscriptions: SaasSubscription[];
  invoices: SaasInvoice[];
  auditLogs: SaasAuditLog[];
  serverTime?: string;
}

export function mapDbPlanRowToPlan(row: Record<string, unknown>): Plan {
  const code = String(row.code || row.id || '');
  const priceMonthly = roundMoney(Number(row.price_monthly ?? row.priceMonthly ?? 0));
  const rawQuarterly = row.price_quarterly ?? row.priceQuarterly;
  const rawYearly = row.price_yearly ?? row.priceYearly;

  const basePlan: Plan = {
    id: String(row.id || code),
    code,
    name: String(row.name || ''),
    description: String(row.description ?? ''),
    priceMonthly,
    priceQuarterly: rawQuarterly !== undefined && rawQuarterly !== null ? roundMoney(Number(rawQuarterly)) : undefined,
    priceYearly: rawYearly !== undefined && rawYearly !== null ? roundMoney(Number(rawYearly)) : 0,
    quarterlyDiscountPercent:
      row.quarterly_discount_percent !== undefined && row.quarterly_discount_percent !== null
        ? clampDiscountPercent(Number(row.quarterly_discount_percent))
        : row.quarterlyDiscountPercent !== undefined && row.quarterlyDiscountPercent !== null
        ? clampDiscountPercent(Number(row.quarterlyDiscountPercent))
        : undefined,
    yearlyDiscountPercent:
      row.yearly_discount_percent !== undefined && row.yearly_discount_percent !== null
        ? clampDiscountPercent(Number(row.yearly_discount_percent))
        : row.yearlyDiscountPercent !== undefined && row.yearlyDiscountPercent !== null
        ? clampDiscountPercent(Number(row.yearlyDiscountPercent))
        : undefined,
    displayOrder:
      row.display_order !== undefined && row.display_order !== null
        ? Number(row.display_order)
        : row.displayOrder !== undefined && row.displayOrder !== null
        ? Number(row.displayOrder)
        : code === 'trial'
        ? 1
        : code === 'basic'
        ? 2
        : 3,
    trialDays: Number(row.trial_days ?? row.trialDays ?? 0),
    maxBranches: Number(row.max_branches ?? row.maxBranches ?? 1),
    maxUsers: Number(row.max_users ?? row.maxUsers ?? 1),
    maxPatients: Number(row.max_patients ?? row.maxPatients ?? 100),
    hasPatientSharing: Boolean(row.has_patient_sharing ?? row.hasPatientSharing),
    hasWhatsAppAutomation: Boolean(row.has_whatsapp_automation ?? row.hasWhatsAppAutomation),
    hasWhatsappAutomation: Boolean(row.has_whatsapp_automation ?? row.hasWhatsAppAutomation),
    hasCustomWebsite: Boolean(row.has_custom_website ?? row.hasCustomWebsite),
    hasFinancialModule: Boolean(row.has_financial_module ?? row.hasFinancialModule),
    hasAdvancedReports: Boolean(row.has_advanced_reports ?? row.hasAdvancedReports),
    isPopular:
      row.is_popular !== undefined
        ? Boolean(row.is_popular)
        : row.isPopular !== undefined
        ? Boolean(row.isPopular)
        : code === 'advanced',
    features: Array.isArray(row.features) ? (row.features as string[]) : undefined,
    isActive:
      row.is_active !== undefined
        ? Boolean(row.is_active)
        : row.isActive !== undefined
        ? Boolean(row.isActive)
        : true,
    archivedAt: row.archived_at ? String(row.archived_at) : row.archivedAt ? String(row.archivedAt) : undefined,
    archivedReason: row.archived_reason
      ? String(row.archived_reason)
      : row.archivedReason
      ? String(row.archivedReason)
      : undefined,
  };

  const qDisc = deriveQuarterlyDiscount(basePlan);
  const yDisc = deriveYearlyDiscount(basePlan);
  const qCalc = calculatePlanCyclePricing({ ...basePlan, quarterlyDiscountPercent: qDisc }, 'quarterly');
  const yCalc = calculatePlanCyclePricing({ ...basePlan, yearlyDiscountPercent: yDisc }, 'yearly');

  return {
    ...basePlan,
    quarterlyDiscountPercent: qDisc,
    yearlyDiscountPercent: yDisc,
    priceQuarterly: qCalc.finalPeriodAmount,
    priceYearly: yCalc.finalPeriodAmount,
  };
}

export function mapDbOrgRowToOrganization(
  row: Record<string, unknown>,
  fallbackOrg?: Partial<Organization>
): Organization {
  const status = (String(row.status || fallbackOrg?.status || 'active') as Organization['status']);
  const trialEndsAt = row.trial_ends_at ? String(row.trial_ends_at) : fallbackOrg?.trialEndsAt || '';
  const subscriptionRenewsAt = row.subscription_renews_at
    ? String(row.subscription_renews_at)
    : fallbackOrg?.subscriptionRenewsAt || '';

  const rawLicense = row.license_status ? (String(row.license_status) as LicenseStatus) : undefined;
  const licenseStatus = resolveCanonicalLicenseStatus({
    status,
    licenseStatus: rawLicense,
    trialEndsAt,
    subscriptionRenewsAt,
  });

  return {
    id: String(row.id || fallbackOrg?.id || ''),
    name: String(row.name || fallbackOrg?.name || ''),
    slug: String(row.slug || fallbackOrg?.slug || ''),
    planId: String(row.plan_id || fallbackOrg?.planId || ''),
    status,
    licenseStatus,
    billingCycle: row.billing_cycle
      ? (String(row.billing_cycle) as BillingCycle)
      : fallbackOrg?.billingCycle || (licenseStatus.startsWith('TESTE') ? 'trial' : 'monthly'),
    responsibleName: row.responsible_name ? String(row.responsible_name) : fallbackOrg?.responsibleName,
    contactEmail: row.contact_email ? String(row.contact_email) : fallbackOrg?.contactEmail,
    contactPhone: row.contact_phone ? String(row.contact_phone) : fallbackOrg?.contactPhone,
    onboardingCompleted:
      row.onboarding_completed !== undefined
        ? Boolean(row.onboarding_completed)
        : fallbackOrg?.onboardingCompleted ?? true,
    onboardingProgress: row.onboarding_progress
      ? normalizeOnboardingProgress(row.onboarding_progress)
      : fallbackOrg?.onboardingProgress,
    lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : fallbackOrg?.lastAccessedAt,
    statusReason: row.status_reason ? String(row.status_reason) : fallbackOrg?.statusReason,
    trialStartedAt: row.trial_started_at ? String(row.trial_started_at) : fallbackOrg?.trialStartedAt,
    trialEndsAt,
    subscriptionRenewsAt,
    createdAt: row.created_at ? String(row.created_at) : fallbackOrg?.createdAt || new Date().toISOString(),
  };
}

export function mapDbSubscriptionRow(row: Record<string, unknown>): SaasSubscription {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    planId: row.plan_id ? String(row.plan_id) : undefined,
    planCode: row.plan_code ? String(row.plan_code) : undefined,
    planName: row.plan_name ? String(row.plan_name) : undefined,
    billingCycle: (String(row.billing_cycle || 'monthly') as BillingCycle),
    licenseStatus: (String(row.license_status || 'TESTE_ATIVO') as LicenseStatus),
    startedAt: String(row.started_at || row.created_at || new Date().toISOString()),
    trialEndsAt: row.trial_ends_at ? String(row.trial_ends_at) : undefined,
    currentPeriodStart: row.current_period_start ? String(row.current_period_start) : undefined,
    currentPeriodEnd: row.current_period_end ? String(row.current_period_end) : undefined,
    nextDueDate: row.next_due_date ? String(row.next_due_date) : undefined,
    unitMonthlyPrice: roundMoney(Number(row.unit_monthly_price ?? 0)),
    discountPercent: roundMoney(Number(row.discount_percent ?? 0)),
    finalCycleAmount: roundMoney(Number(row.final_cycle_amount ?? 0)),
    paymentProvider: row.payment_provider ? String(row.payment_provider) : undefined,
    externalSubscriptionId: row.external_subscription_id ? String(row.external_subscription_id) : undefined,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : undefined,
    cancellationReason: row.cancellation_reason ? String(row.cancellation_reason) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function mapDbInvoiceRow(row: Record<string, unknown>): SaasInvoice {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    organizationName: row.organization_name ? String(row.organization_name) : undefined,
    subscriptionId: row.subscription_id ? String(row.subscription_id) : undefined,
    planId: row.plan_id ? String(row.plan_id) : undefined,
    planName: row.plan_name ? String(row.plan_name) : undefined,
    billingCycle: (String(row.billing_cycle || 'monthly') as BillingCycle),
    referenceCode: String(row.reference_code || ''),
    grossAmount: roundMoney(Number(row.gross_amount ?? 0)),
    discountPercent: roundMoney(Number(row.discount_percent ?? 0)),
    finalAmount: roundMoney(Number(row.final_amount ?? 0)),
    currency: String(row.currency || 'BRL'),
    status: (String(row.status || 'pending') as SaasInvoiceStatus),
    paymentMethod: row.payment_method ? String(row.payment_method) : undefined,
    paymentProvider: row.payment_provider ? String(row.payment_provider) : undefined,
    externalOrderId: row.external_order_id ? String(row.external_order_id) : undefined,
    externalCheckoutUrl: row.external_checkout_url ? String(row.external_checkout_url) : undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
    paidAt: row.paid_at ? String(row.paid_at) : undefined,
    manualConfirmationReason: row.manual_confirmation_reason
      ? String(row.manual_confirmation_reason)
      : undefined,
    confirmedByEmail: row.confirmed_by_email ? String(row.confirmed_by_email) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

export function mapDbAuditRow(row: Record<string, unknown>): SaasAuditLog {
  return {
    id: String(row.id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
    actorProfileId: row.actor_profile_id ? String(row.actor_profile_id) : undefined,
    actorEmail: row.actor_email ? String(row.actor_email) : undefined,
    actorRole: row.actor_role ? String(row.actor_role) : undefined,
    targetOrganizationId: row.target_organization_id ? String(row.target_organization_id) : undefined,
    targetOrganizationName: row.target_organization_name ? String(row.target_organization_name) : undefined,
    action: String(row.action || ''),
    entity: String(row.entity || ''),
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    reason: row.reason ? String(row.reason) : undefined,
    previousState:
      row.previous_state && typeof row.previous_state === 'object'
        ? (row.previous_state as Record<string, unknown>)
        : undefined,
    newState:
      row.new_state && typeof row.new_state === 'object'
        ? (row.new_state as Record<string, unknown>)
        : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

/**
 * Busca estrita dos planos comerciais no Supabase (Fonte Única de Verdade).
 * Nunca retorna dados mockados ou localStorage em caso de erro.
 */
export async function fetchPublicPlansStrict(options?: {
  includeInactive?: boolean;
}): Promise<StrictPlansFetchResult> {
  const creds = getSupabaseCredentials();
  if (creds.configError) {
    return { success: false, plans: [], error: creds.configError };
  }

  const supabase = getSupabase();
  if (!supabase || !creds.isConfigured) {
    return {
      success: false,
      plans: [],
      error:
        'Conexão com o banco de dados Supabase não configurada. Não é possível exibir preços comerciais sem sincronização oficial.',
    };
  }

  try {
    let query = supabase.from('plans').select('*');
    if (!options?.includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
      return {
        success: false,
        plans: [],
        error: `Falha ao consultar tabela de planos no Supabase: ${error.message}`,
      };
    }

    const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    const mapped = sortPlansByCommercialOrder(rows.map(mapDbPlanRowToPlan));

    if (mapped.length === 0) {
      return {
        success: false,
        plans: [],
        error: 'Nenhum plano comercial ativo cadastrado no Supabase.',
      };
    }

    return {
      success: true,
      plans: mapped,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      plans: [],
      error: err instanceof Error ? err.message : 'Erro inesperado ao consultar planos no Supabase.',
    };
  }
}

export async function registerTrialClinic(input: TrialSignupInput): Promise<TrialSignupResult> {
  const creds = getSupabaseCredentials();
  if (creds.configError) {
    return { success: false, error: creds.configError };
  }
  const supabase = getSupabase();
  if (!supabase || !creds.isConfigured) {
    return {
      success: false,
      error: 'Servidor Supabase não configurado para provisionamento de contas de teste.',
    };
  }

  const cleanClinic = input.clinicName.trim();
  const cleanResponsible = input.responsibleName.trim();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanPhone = input.phone.trim();

  if (cleanClinic.length < 3) {
    return { success: false, error: 'Informe o nome da clínica (mínimo 3 caracteres).' };
  }
  if (cleanResponsible.length < 3) {
    return { success: false, error: 'Informe o nome completo do responsável.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { success: false, error: 'Informe um e-mail comercial válido.' };
  }
  if (cleanPhone.replace(/\D/g, '').length < 10) {
    return { success: false, error: 'Informe um telefone/WhatsApp válido com DDD.' };
  }
  if (input.password.length < 8) {
    return { success: false, error: 'A senha deve conter no mínimo 8 caracteres.' };
  }
  if (input.password !== input.confirmPassword) {
    return { success: false, error: 'A senha e a confirmação de senha não coincidem.' };
  }

  try {
    const response = await fetch(`${creds.url}/functions/v1/saas-trial-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: creds.anonKey,
        Authorization: `Bearer ${creds.anonKey}`,
      },
      body: JSON.stringify({
        clinicName: cleanClinic,
        responsibleName: cleanResponsible,
        email: cleanEmail,
        phone: cleanPhone,
        documentNumber: input.documentNumber?.trim() || undefined,
        password: input.password,
        planCode: input.planCode || 'trial',
      }),
    });

    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || !parsed.success) {
      return {
        success: false,
        error: parsed.error
          ? String(parsed.error)
          : `Falha ao provisionar teste gratuito (HTTP ${response.status}).`,
      };
    }

    const requiresEmailConfirmation = Boolean(parsed.requiresEmailConfirmation);
    if (!requiresEmailConfirmation) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: input.password,
      });
      if (signInErr) {
        return {
          success: true,
          requiresEmailConfirmation: true,
          organizationId: parsed.organizationId ? String(parsed.organizationId) : undefined,
          clinicId: parsed.clinicId ? String(parsed.clinicId) : undefined,
          trialEndsAt: parsed.trialEndsAt ? String(parsed.trialEndsAt) : undefined,
          signedIn: false,
        };
      }
    }

    return {
      success: true,
      requiresEmailConfirmation,
      organizationId: parsed.organizationId ? String(parsed.organizationId) : undefined,
      clinicId: parsed.clinicId ? String(parsed.clinicId) : undefined,
      trialEndsAt: parsed.trialEndsAt ? String(parsed.trialEndsAt) : undefined,
      signedIn: !requiresEmailConfirmation,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Erro de conexão ao provisionar o ambiente de teste gratuito.',
    };
  }
}

async function callAuthenticatedEdgeFunction<T = Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data?: T; error?: string; status?: number }> {
  const creds = getSupabaseCredentials();
  if (creds.configError) {
    return { error: creds.configError };
  }
  const supabase = getSupabase();
  if (!supabase || !creds.isConfigured) {
    return { error: 'Conexão com o Supabase não configurada neste ambiente.' };
  }

  const { data: sessionRes } = await supabase.auth.getSession();
  const token = sessionRes?.session?.access_token;
  if (!token) {
    return { error: 'Sessão não autenticada. Faça login novamente.', status: 401 };
  }

  try {
    const response = await fetch(`${creds.url}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: creds.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || parsed.success === false) {
      return {
        data: parsed as T,
        error: parsed.error
          ? String(parsed.error)
          : `Erro ao chamar ${functionName} (HTTP ${response.status}).`,
        status: response.status,
      };
    }

    return { data: parsed as T, status: response.status };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : `Falha de rede ao acessar ${functionName}.`,
    };
  }
}

export const ClinicBillingCloudService = {
  async getOrgBillingStatus(organizationId?: string): Promise<ClinicBillingStatusResult> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      organization?: Record<string, unknown>;
      plan?: Record<string, unknown> | null;
      subscription?: Record<string, unknown> | null;
      invoices?: Array<Record<string, unknown>>;
    }>('saas-billing', {
      action: 'get_org_billing_status',
      organizationId,
    });

    if (res.error || !res.data?.organization) {
      return { success: false, error: res.error || 'Não foi possível consultar o status da assinatura.' };
    }

    return {
      success: true,
      organization: mapDbOrgRowToOrganization(res.data.organization),
      plan: res.data.plan ? mapDbPlanRowToPlan(res.data.plan) : null,
      subscription: res.data.subscription ? mapDbSubscriptionRow(res.data.subscription) : null,
      invoices: (res.data.invoices || []).map(mapDbInvoiceRow),
    };
  },

  async updateOnboardingProgress(payload: {
    organizationId?: string;
    completedSteps: string[];
    skipped?: boolean;
    completed?: boolean;
    currentStep?: number;
  }): Promise<{ success: boolean; organization?: Organization; error?: string }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      organization?: Record<string, unknown>;
      onboardingProgress?: OnboardingProgress;
    }>('saas-billing', {
      action: 'update_onboarding_progress',
      ...payload,
    });

    if (res.error) {
      return { success: false, error: res.error };
    }

    return {
      success: true,
      organization: res.data?.organization
        ? mapDbOrgRowToOrganization(res.data.organization)
        : undefined,
    };
  },

  async createCheckoutSession(payload: {
    organizationId?: string;
    planCode: string;
    billingCycle: 'monthly' | 'quarterly' | 'yearly';
    paymentMethod?: string;
  }): Promise<{
    success: boolean;
    invoice?: SaasInvoice;
    checkoutUrl?: string | null;
    gatewayConfigured?: boolean;
    message?: string;
    error?: string;
  }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      invoice?: Record<string, unknown>;
      checkoutUrl?: string | null;
      gatewayConfigured?: boolean;
      message?: string;
    }>('saas-billing', {
      action: 'create_checkout_session',
      ...payload,
    });

    if (res.error || !res.data) {
      return { success: false, error: res.error || 'Falha ao iniciar contratação do plano.' };
    }

    return {
      success: true,
      invoice: res.data.invoice ? mapDbInvoiceRow(res.data.invoice) : undefined,
      checkoutUrl: res.data.checkoutUrl ?? null,
      gatewayConfigured: Boolean(res.data.gatewayConfigured),
      message: res.data.message ? String(res.data.message) : undefined,
    };
  },
};

export const SaasAdminCloudService = {
  async fetchDashboardData(): Promise<{
    success: boolean;
    data?: SaasAdminDashboardPayload;
    error?: string;
  }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      plans?: Array<Record<string, unknown>>;
      organizations?: Array<Record<string, unknown>>;
      clinics?: Array<Record<string, unknown>>;
      subscriptions?: Array<Record<string, unknown>>;
      invoices?: Array<Record<string, unknown>>;
      auditLogs?: Array<Record<string, unknown>>;
      counts?: {
        branchesByOrg?: Record<string, number>;
        usersByOrg?: Record<string, number>;
        patientsByOrg?: Record<string, number>;
      };
      serverTime?: string;
    }>('saas-platform-admin', {
      action: 'get_saas_dashboard_data',
    });

    if (res.error || !res.data) {
      return { success: false, error: res.error || 'Falha ao carregar painel SaaS.' };
    }

    const plans = sortPlansByCommercialOrder((res.data.plans || []).map(mapDbPlanRowToPlan));
    const planById = new Map<string, Plan>(plans.map((p) => [p.id, p]));

    const orgList = (res.data.organizations || []).map((row) => mapDbOrgRowToOrganization(row));
    const orgNameById = new Map<string, string>(orgList.map((o) => [o.id, o.name]));

    const clinicsByOrg = new Map<string, Clinic>();
    for (const row of res.data.clinics || []) {
      const orgId = String(row.organization_id || '');
      if (!orgId) continue;
      clinicsByOrg.set(orgId, {
        id: String(row.id),
        organizationId: orgId,
        legalName: String(row.legal_name || ''),
        tradeName: String(row.trade_name || ''),
        documentNumber: String(row.document_number || ''),
        email: String(row.email || ''),
        phone: String(row.phone || ''),
        whatsapp: String(row.whatsapp || ''),
        primaryColor: String(row.primary_color || '#0284c7'),
        institutionalBio: '',
        createdAt: String(row.created_at || new Date().toISOString()),
      });
    }

    const subscriptions = (res.data.subscriptions || []).map((row) => {
      const sub = mapDbSubscriptionRow(row);
      const matchedPlan = sub.planId ? planById.get(sub.planId) : undefined;
      return {
        ...sub,
        planCode: sub.planCode || matchedPlan?.code,
        planName: sub.planName || matchedPlan?.name,
      };
    });

    const subByOrg = new Map<string, SaasSubscription>();
    for (const sub of subscriptions) {
      if (!subByOrg.has(sub.organizationId)) {
        subByOrg.set(sub.organizationId, sub);
      }
    }

    const invoices = (res.data.invoices || []).map((row) => {
      const inv = mapDbInvoiceRow(row);
      const matchedPlan = inv.planId ? planById.get(inv.planId) : undefined;
      return {
        ...inv,
        organizationName: inv.organizationName || orgNameById.get(inv.organizationId),
        planName: inv.planName || matchedPlan?.name,
      };
    });

    const lastPaidByOrg = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.status === 'paid' && inv.paidAt && !lastPaidByOrg.has(inv.organizationId)) {
        lastPaidByOrg.set(inv.organizationId, inv.paidAt);
      }
    }

    const branchesByOrg = res.data.counts?.branchesByOrg || {};
    const usersByOrg = res.data.counts?.usersByOrg || {};
    const patientsByOrg = res.data.counts?.patientsByOrg || {};

    const tenants: SaasAdminTenantRecord[] = orgList.map((org) => {
      const sub = subByOrg.get(org.id);
      return {
        organization: org,
        clinic: clinicsByOrg.get(org.id),
        plan: planById.get(org.planId),
        subscription: sub,
        branchesCount: branchesByOrg[org.id] || 0,
        activeUsersCount: usersByOrg[org.id] || 0,
        patientsCount: patientsByOrg[org.id] || 0,
        lastPaidAt: lastPaidByOrg.get(org.id),
        nextDueDate: sub?.nextDueDate || org.subscriptionRenewsAt || org.trialEndsAt,
      };
    });

    const auditLogs = (res.data.auditLogs || []).map((row) => {
      const log = mapDbAuditRow(row);
      return {
        ...log,
        targetOrganizationName:
          log.targetOrganizationName ||
          (log.targetOrganizationId ? orgNameById.get(log.targetOrganizationId) : undefined),
      };
    });

    return {
      success: true,
      data: {
        plans,
        tenants,
        subscriptions,
        invoices,
        auditLogs,
        serverTime: res.data.serverTime,
      },
    };
  },

  async upsertPlan(
    plan: Plan,
    reason?: string
  ): Promise<{ success: boolean; plan?: Plan; notFound?: boolean; error?: string }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      notFound?: boolean;
      plan?: Record<string, unknown>;
    }>('saas-platform-admin', {
      action: 'upsert_plan',
      reason: reason || 'Atualização comercial via Administração Geral SaaS',
      plan: {
        id: plan.id ? plan.id : undefined,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        quarterlyDiscountPercent: plan.quarterlyDiscountPercent,
        yearlyDiscountPercent: plan.yearlyDiscountPercent,
        displayOrder: plan.displayOrder,
        trialDays: plan.trialDays,
        maxBranches: plan.maxBranches,
        maxUsers: plan.maxUsers,
        maxPatients: plan.maxPatients,
        hasPatientSharing: plan.hasPatientSharing,
        hasWhatsAppAutomation: plan.hasWhatsAppAutomation,
        hasCustomWebsite: plan.hasCustomWebsite,
        hasFinancialModule: plan.hasFinancialModule,
        hasAdvancedReports: plan.hasAdvancedReports,
        isPopular: Boolean(plan.isPopular),
        isActive: plan.isActive !== false,
        features: plan.features,
      },
    });

    if (res.error || !res.data?.plan) {
      return {
        success: false,
        notFound: Boolean(res.data?.notFound || res.status === 404),
        error: res.error || 'Erro ao salvar plano comercial.',
      };
    }

    const mapped = mapDbPlanRowToPlan(res.data.plan);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('medsync-plans-updated'));
    }
    return { success: true, plan: mapped };
  },

  async deletePlan(
    planId: string,
    reason?: string
  ): Promise<{
    success: boolean;
    status?: 'deleted' | 'not_found' | 'blocked_in_use' | 'blocked_system_plan';
    deleted?: boolean;
    message?: string;
    references?: {
      organizations: number;
      subscriptions: number;
      invoices: number;
      total: number;
    };
    error?: string;
  }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      status?: 'deleted' | 'not_found' | 'blocked_in_use' | 'blocked_system_plan';
      deleted?: boolean;
      message?: string;
      references?: {
        organizations: number;
        subscriptions: number;
        invoices: number;
        total: number;
      };
    }>('saas-platform-admin', {
      action: 'delete_plan',
      planId,
      reason: reason || 'Exclusão de plano via Administração Geral SaaS',
    });

    if (res.error || !res.data) {
      return {
        success: false,
        error: res.error || 'Erro ao excluir plano no servidor.',
      };
    }

    if (res.data.status === 'deleted' || res.data.status === 'not_found') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('medsync-plans-updated'));
      }
    }

    return {
      success: true,
      status: res.data.status,
      deleted: Boolean(res.data.deleted),
      message: res.data.message,
      references: res.data.references,
    };
  },

  async archivePlan(
    planId: string,
    isActive: boolean,
    reason?: string
  ): Promise<{
    success: boolean;
    status?: 'archived' | 'reactivated' | 'not_found';
    notFound?: boolean;
    plan?: Plan;
    message?: string;
    error?: string;
  }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      status?: 'archived' | 'reactivated' | 'not_found';
      notFound?: boolean;
      plan?: Record<string, unknown>;
      message?: string;
    }>('saas-platform-admin', {
      action: 'archive_plan',
      planId,
      isActive,
      reason:
        reason ||
        (isActive
          ? 'Reativação comercial de plano na Administração Geral SaaS'
          : 'Arquivamento de plano na Administração Geral SaaS'),
    });

    if (res.error || !res.data?.plan) {
      return {
        success: false,
        notFound: Boolean(res.data?.notFound || res.status === 404),
        error: res.error || 'Erro ao atualizar status do plano no servidor.',
      };
    }

    const mapped = mapDbPlanRowToPlan(res.data.plan);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('medsync-plans-updated'));
    }
    return {
      success: true,
      status: res.data.status,
      plan: mapped,
      message: res.data.message,
    };
  },

  async updateOrganizationLicense(payload: {
    organizationId: string;
    planId?: string;
    billingCycle?: BillingCycle;
    licenseStatus?: LicenseStatus;
    trialEndsAt?: string | null;
    subscriptionRenewsAt?: string | null;
    reason: string;
  }): Promise<{ success: boolean; organization?: Organization; error?: string }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      organization?: Record<string, unknown>;
    }>('saas-platform-admin', {
      action: 'update_organization_license',
      ...payload,
    });

    if (res.error || !res.data?.organization) {
      return { success: false, error: res.error || 'Erro ao atualizar licença da organização.' };
    }

    return {
      success: true,
      organization: mapDbOrgRowToOrganization(res.data.organization),
    };
  },

  async confirmManualPayment(payload: {
    invoiceId?: string;
    organizationId?: string;
    planId?: string;
    billingCycle?: 'monthly' | 'quarterly' | 'yearly';
    paymentMethod: string;
    reason: string;
  }): Promise<{ success: boolean; invoice?: SaasInvoice; error?: string }> {
    const res = await callAuthenticatedEdgeFunction<{
      success: boolean;
      invoice?: Record<string, unknown>;
    }>('saas-platform-admin', {
      action: 'confirm_manual_payment',
      ...payload,
    });

    if (res.error) {
      return { success: false, error: res.error };
    }

    return {
      success: true,
      invoice: res.data?.invoice ? mapDbInvoiceRow(res.data.invoice) : undefined,
    };
  },
};
