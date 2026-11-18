import {
  Plan,
  Organization,
  Clinic,
  Branch,
  Room,
  UserProfile,
  Specialty,
  Professional,
  Service,
  Patient,
  Appointment,
  WaitlistEntry,
  MedicalRecordEntry,
  MessageTemplate,
  MessageLog,
  FinancialTransaction,
  WebsiteConfig,
  AuditLog,
  AppointmentStatus,
  ColorPalette,
  ClinicDomain,
  Prescription,
  MedicalCertificate,
  LabOrder,
  ExamResult,
  MedicalRecordAddendum,
  SaasPlan,
  WhatsAppAutomationTrigger,
  AutomationExecutionRecord,
  AutomationTriggerStatus,
  AutomationTriggerSettings,
} from '../types';

import {
  INITIAL_PLANS,
  INITIAL_ORGANIZATION,
  INITIAL_CLINIC,
  INITIAL_BRANCHES,
  INITIAL_ROOMS,
  INITIAL_SPECIALTIES,
  INITIAL_PROFESSIONALS,
  INITIAL_SERVICES,
  INITIAL_USERS,
  INITIAL_PATIENTS,
  INITIAL_APPOINTMENTS,
  INITIAL_WAITLIST,
  INITIAL_MEDICAL_RECORDS,
  INITIAL_TEMPLATES,
  INITIAL_MESSAGES,
  INITIAL_FINANCIAL,
  INITIAL_WEBSITE,
  INITIAL_AUDIT_LOGS,
  INITIAL_CLINIC_DOMAINS,
  INITIAL_PRESCRIPTIONS,
  INITIAL_CERTIFICATES,
  INITIAL_LAB_ORDERS,
  INITIAL_EXAM_RESULTS,
  INITIAL_AUTOMATION_TRIGGERS,
  INITIAL_AUTOMATION_EXECUTIONS
} from './mockData';
import { getSupabase } from './supabaseClient';

const STORAGE_KEYS = {
  PLANS: 'medsync_saas_plans',
  LEGACY_PLANS: 'medsync_plans',
  ORGANIZATION: 'medsync_org',
  CLINIC: 'medsync_clinic',
  BRANCHES: 'medsync_branches',
  ROOMS: 'medsync_rooms',
  SPECIALTIES: 'medsync_specialties',
  PROFESSIONALS: 'medsync_professionals',
  SERVICES: 'medsync_services',
  USERS: 'medsync_users',
  PATIENTS: 'medsync_patients',
  APPOINTMENTS: 'medsync_appointments',
  WAITLIST: 'medsync_waitlist',
  MEDICAL_RECORDS: 'medsync_records',
  PRESCRIPTIONS: 'medsync_prescriptions',
  CERTIFICATES: 'medsync_certificates',
  LAB_ORDERS: 'medsync_lab_orders',
  EXAM_RESULTS: 'medsync_exam_results',
  TEMPLATES: 'medsync_templates',
  MESSAGES: 'medsync_messages',
  AUTOMATION_TRIGGERS: 'medsync_whatsapp_triggers',
  AUTOMATION_EXECUTIONS: 'medsync_whatsapp_executions',
  FINANCIAL: 'medsync_financial',
  WEBSITE: 'medsync_website',
  AUDIT_LOGS: 'medsync_audit',
  CLINIC_DOMAINS: 'medsync_clinic_domains',
  ACTIVE_BRANCH_ID: 'medsync_active_branch',
  ACTIVE_USER_ID: 'medsync_active_user',
  DATA_VERSION: 'medsync_data_version',
};

export const MEDSYNC_DATA_VERSION = '2026.11.13-newton-mureb-n8n-agenda';

let migrationChecked = false;

export function runDataMigrationIfNeeded(): void {
  if (typeof window === 'undefined' || migrationChecked) return;
  migrationChecked = true;

  try {
    const currentVersion = localStorage.getItem(STORAGE_KEYS.DATA_VERSION);
    const rawClinic = localStorage.getItem(STORAGE_KEYS.CLINIC);
    const rawProfessionals = localStorage.getItem(STORAGE_KEYS.PROFESSIONALS);
    const rawBranches = localStorage.getItem(STORAGE_KEYS.BRANCHES);

    const hasLegacyClinic =
      Boolean(rawClinic) &&
      (rawClinic!.includes('42.891.304') ||
        rawClinic!.includes('00.000.000') ||
        rawClinic!.includes('Mureb & Associados'));

    const hasLegacyProfessional =
      Boolean(rawProfessionals) &&
      (rawProfessionals!.includes('Rodrigo Viana') ||
        rawProfessionals!.includes('prof_rodrigo') ||
        rawProfessionals!.includes('84.320/SP'));

    const hasLegacyBranches =
      Boolean(rawBranches) &&
      (rawBranches!.includes('branch_sp_jardins') ||
        rawBranches!.includes('branch_rj_ipanema') ||
        rawBranches!.includes('Bela Cintra'));

    const needsLegacyReset =
      hasLegacyClinic ||
      hasLegacyProfessional ||
      hasLegacyBranches ||
      !currentVersion;

    // Incremental non-destructive migration when upgrading from 2026.11.13-newton-mureb
    if (!needsLegacyReset && currentVersion !== MEDSYNC_DATA_VERSION) {
      if (rawClinic) {
        try {
          const parsedClinic = JSON.parse(rawClinic) as Clinic;
          const updatedClinic: Clinic = {
            ...parsedClinic,
            n8nWebhookDisponibilidade:
              parsedClinic.n8nWebhookDisponibilidade || INITIAL_CLINIC.n8nWebhookDisponibilidade,
            n8nWebhookAgendamento:
              parsedClinic.n8nWebhookAgendamento || INITIAL_CLINIC.n8nWebhookAgendamento,
          };
          localStorage.setItem(STORAGE_KEYS.CLINIC, JSON.stringify(updatedClinic));
        } catch {
          localStorage.setItem(STORAGE_KEYS.CLINIC, JSON.stringify(INITIAL_CLINIC));
        }
      }

      const rawDomains = localStorage.getItem(STORAGE_KEYS.CLINIC_DOMAINS);
      if (rawDomains) {
        try {
          const parsedDomains = JSON.parse(rawDomains) as ClinicDomain[];
          const hasBooking = parsedDomains.some(
            d => d.domain === 'agenda.drnewtonmureb.com.br' || d.domainType === 'clinic_booking' || d.domainType === 'booking'
          );
          if (!hasBooking) {
            const bookingSeed = INITIAL_CLINIC_DOMAINS.find(d => d.id === 'dom_mureb_booking');
            if (bookingSeed) {
              parsedDomains.push(bookingSeed);
              localStorage.setItem(STORAGE_KEYS.CLINIC_DOMAINS, JSON.stringify(parsedDomains));
            }
          }
        } catch {
          localStorage.setItem(STORAGE_KEYS.CLINIC_DOMAINS, JSON.stringify(INITIAL_CLINIC_DOMAINS));
        }
      }

      localStorage.setItem(STORAGE_KEYS.DATA_VERSION, MEDSYNC_DATA_VERSION);
      return;
    }

    if (!needsLegacyReset) return;

    // Upgrade core clinic, org, branches, rooms, specialties, professionals, services, users, website, domains
    localStorage.setItem(STORAGE_KEYS.ORGANIZATION, JSON.stringify(INITIAL_ORGANIZATION));
    localStorage.setItem(STORAGE_KEYS.CLINIC, JSON.stringify(INITIAL_CLINIC));
    localStorage.setItem(STORAGE_KEYS.BRANCHES, JSON.stringify(INITIAL_BRANCHES));
    localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(INITIAL_ROOMS));
    localStorage.setItem(STORAGE_KEYS.SPECIALTIES, JSON.stringify(INITIAL_SPECIALTIES));
    localStorage.setItem(STORAGE_KEYS.PROFESSIONALS, JSON.stringify(INITIAL_PROFESSIONALS));
    localStorage.setItem(STORAGE_KEYS.SERVICES, JSON.stringify(INITIAL_SERVICES));
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(INITIAL_USERS));
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(INITIAL_TEMPLATES));
    localStorage.setItem(STORAGE_KEYS.WEBSITE, JSON.stringify(INITIAL_WEBSITE));
    localStorage.setItem(STORAGE_KEYS.CLINIC_DOMAINS, JSON.stringify(INITIAL_CLINIC_DOMAINS));

    // Migrate patients (preserve custom added patients while remapping old SP/RJ branchIds to Cabo Frio)
    const rawPatients = localStorage.getItem(STORAGE_KEYS.PATIENTS);
    if (rawPatients) {
      try {
        const parsedPatients = JSON.parse(rawPatients) as Patient[];
        const migratedPatients = parsedPatients.map((p) => {
          const isOldBranch =
            p.originBranchId === 'branch_sp_jardins' || p.originBranchId === 'branch_rj_ipanema';
          return {
            ...p,
            originBranchId: isOldBranch ? 'branch_cf_centro' : p.originBranchId,
            authorizedBranchIds: ['branch_cf_centro'],
          };
        });
        localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(migratedPatients));
      } catch {
        localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(INITIAL_PATIENTS));
      }
    } else {
      localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(INITIAL_PATIENTS));
    }

    // Reset/update sample appointments, records, prescriptions, certificates, lab orders, exams, financial & messages containing legacy doctors/CRM
    localStorage.setItem(STORAGE_KEYS.APPOINTMENTS, JSON.stringify(INITIAL_APPOINTMENTS));
    localStorage.setItem(STORAGE_KEYS.WAITLIST, JSON.stringify(INITIAL_WAITLIST));
    localStorage.setItem(STORAGE_KEYS.MEDICAL_RECORDS, JSON.stringify(INITIAL_MEDICAL_RECORDS));
    localStorage.setItem(STORAGE_KEYS.PRESCRIPTIONS, JSON.stringify(INITIAL_PRESCRIPTIONS));
    localStorage.setItem(STORAGE_KEYS.CERTIFICATES, JSON.stringify(INITIAL_CERTIFICATES));
    localStorage.setItem(STORAGE_KEYS.LAB_ORDERS, JSON.stringify(INITIAL_LAB_ORDERS));
    localStorage.setItem(STORAGE_KEYS.EXAM_RESULTS, JSON.stringify(INITIAL_EXAM_RESULTS));
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(INITIAL_MESSAGES));
    localStorage.setItem(
      STORAGE_KEYS.AUTOMATION_TRIGGERS,
      JSON.stringify(INITIAL_AUTOMATION_TRIGGERS)
    );
    localStorage.setItem(
      STORAGE_KEYS.AUTOMATION_EXECUTIONS,
      JSON.stringify(INITIAL_AUTOMATION_EXECUTIONS)
    );
    localStorage.setItem(STORAGE_KEYS.FINANCIAL, JSON.stringify(INITIAL_FINANCIAL));
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(INITIAL_AUDIT_LOGS));

    // Fix active branch/user if pointing to removed IDs
    const activeBranch = localStorage.getItem(STORAGE_KEYS.ACTIVE_BRANCH_ID);
    if (activeBranch === 'branch_sp_jardins' || activeBranch === 'branch_rj_ipanema') {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_BRANCH_ID, 'branch_cf_centro');
    }
    const activeUser = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID);
    if (activeUser === 'usr_physio_rodrigo') {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, 'usr_doctor_newton');
    }

    localStorage.setItem(STORAGE_KEYS.DATA_VERSION, MEDSYNC_DATA_VERSION);
  } catch (err) {
    console.warn('Erro ao migrar cache local MedSync:', err);
  }
}

function getStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  runDataMigrationIfNeeded();
  try {
    const data = localStorage.getItem(key);
    if (!data) {
      localStorage.setItem(key, JSON.stringify(fallback));
      return fallback;
    }
    return JSON.parse(data) as T;
  } catch (e) {
    console.error(`Error reading key ${key} from localStorage:`, e);
    return fallback;
  }
}

function setStored<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event('medsync_storage_update'));
  } catch (e) {
    console.error(`Error writing key ${key} to localStorage:`, e);
  }
}

let lastPlanSyncError: string | null = null;

export function getLastPlanSyncError(): string | null {
  return lastPlanSyncError;
}

export interface CloudAppointmentsSyncResult {
  appointments: Appointment[];
  source: 'supabase' | 'local_fallback';
  error?: string;
  count: number;
}

function mapDbPlanToPlan(row: Record<string, unknown>, localFallback?: Plan): Plan {
  const code = String(row.code || row.id || '');
  const hasWhatsapp = Boolean(row.has_whatsapp_automation ?? row.hasWhatsAppAutomation);
  return {
    id: String(row.id || localFallback?.id || code),
    code,
    name: String(row.name || localFallback?.name || ''),
    description: String(row.description ?? localFallback?.description ?? ''),
    priceMonthly: Number(row.price_monthly ?? row.priceMonthly ?? 0),
    priceYearly: Number(row.price_yearly ?? row.priceYearly ?? 0),
    trialDays: Number(row.trial_days ?? row.trialDays ?? 0),
    maxBranches: Number(row.max_branches ?? row.maxBranches ?? 1),
    maxUsers: Number(row.max_users ?? row.maxUsers ?? 1),
    maxPatients: Number(row.max_patients ?? row.maxPatients ?? 100),
    hasPatientSharing: Boolean(row.has_patient_sharing ?? row.hasPatientSharing),
    hasWhatsAppAutomation: hasWhatsapp,
    hasWhatsappAutomation: hasWhatsapp,
    hasCustomWebsite: Boolean(row.has_custom_website ?? row.hasCustomWebsite),
    hasFinancialModule: Boolean(row.has_financial_module ?? row.hasFinancialModule),
    hasAdvancedReports: Boolean(row.has_advanced_reports ?? row.hasAdvancedReports),
    isPopular:
      row.is_popular !== undefined
        ? Boolean(row.is_popular)
        : row.isPopular !== undefined
        ? Boolean(row.isPopular)
        : localFallback?.isPopular ?? code === 'advanced',
    features: Array.isArray(row.features) ? (row.features as string[]) : localFallback?.features,
    isActive:
      row.is_active !== undefined
        ? Boolean(row.is_active)
        : row.isActive !== undefined
        ? Boolean(row.isActive)
        : true,
  };
}

function buildPlanDbPayload(plan: Plan | SaasPlan) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description || '',
    price_monthly: Number(plan.priceMonthly) || 0,
    price_yearly: Number(plan.priceYearly) || 0,
    trial_days: Number(plan.trialDays) || 0,
    max_branches: Number(plan.maxBranches) || 1,
    max_users: Number(plan.maxUsers) || 1,
    max_patients: Number(plan.maxPatients) || 0,
    has_patient_sharing: Boolean(plan.hasPatientSharing),
    has_whatsapp_automation: Boolean(plan.hasWhatsAppAutomation ?? plan.hasWhatsappAutomation),
    has_custom_website: Boolean(plan.hasCustomWebsite),
    has_financial_module: Boolean(plan.hasFinancialModule),
    has_advanced_reports: Boolean(plan.hasAdvancedReports),
    is_active: plan.isActive !== false,
    updated_at: new Date().toISOString(),
  };
}

function getLocalPlansOnly(): Plan[] {
  if (typeof window === 'undefined') return INITIAL_PLANS;
  let plans: Plan[] | null = null;
  try {
    const rawSaas = localStorage.getItem(STORAGE_KEYS.PLANS);
    if (rawSaas) {
      plans = JSON.parse(rawSaas) as Plan[];
    }
    if (!plans || !Array.isArray(plans) || plans.length === 0) {
      const rawLegacy = localStorage.getItem(STORAGE_KEYS.LEGACY_PLANS);
      if (rawLegacy) {
        plans = JSON.parse(rawLegacy) as Plan[];
      }
    }
  } catch (e) {
    console.warn('Erro ao ler planos do localStorage:', e);
  }

  if (!plans || !Array.isArray(plans) || plans.length === 0) {
    plans = INITIAL_PLANS;
    localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(plans));
    localStorage.setItem(STORAGE_KEYS.LEGACY_PLANS, JSON.stringify(plans));
  }

  return plans;
}

export async function syncPlansFromSupabase(): Promise<Plan[]> {
  const localPlans = getLocalPlansOnly();
  const supabase = getSupabase();
  if (!supabase) {
    lastPlanSyncError = 'Supabase não configurado (variáveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes).';
    return localPlans;
  }

  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .order('price_monthly', { ascending: true });

    if (error) {
      lastPlanSyncError = `${error.message}${error.details ? ` (${error.details})` : ''}`;
      console.error('Erro ao buscar planos no Supabase:', error);
      return localPlans;
    }

    lastPlanSyncError = null;

    if (data && data.length > 0) {
      const mapped = data.map((row: Record<string, unknown>) => {
        const localMatch = localPlans.find(p => p.code === String(row.code || '') || p.id === String(row.id || ''));
        return mapDbPlanToPlan(row, localMatch);
      });

      if (typeof window !== 'undefined') {
        const serialized = JSON.stringify(mapped);
        localStorage.setItem(STORAGE_KEYS.PLANS, serialized);
        localStorage.setItem(STORAGE_KEYS.LEGACY_PLANS, serialized);
      }

      return mapped;
    }

    return localPlans;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastPlanSyncError = message;
    console.error('Exceção ao sincronizar planos do Supabase:', err);
    return localPlans;
  }
}

export async function updatePlanInSupabase(plan: Plan): Promise<boolean> {
  const normalizedPlan: Plan = {
    ...plan,
    priceMonthly: Number(plan.priceMonthly) || 0,
    priceYearly: Number(plan.priceYearly) || 0,
    trialDays: Number(plan.trialDays) || 0,
    maxBranches: Number(plan.maxBranches) || 1,
    maxUsers: Number(plan.maxUsers) || 1,
    maxPatients: Number(plan.maxPatients) || 0,
    hasWhatsAppAutomation: Boolean(plan.hasWhatsAppAutomation ?? plan.hasWhatsappAutomation),
    hasWhatsappAutomation: Boolean(plan.hasWhatsAppAutomation ?? plan.hasWhatsappAutomation),
    hasCustomWebsite: Boolean(plan.hasCustomWebsite),
    hasFinancialModule: Boolean(plan.hasFinancialModule),
    hasAdvancedReports: Boolean(plan.hasAdvancedReports),
    hasPatientSharing: Boolean(plan.hasPatientSharing),
    isPopular: Boolean(plan.isPopular),
    isActive: plan.isActive !== false,
  };

  // Persist locally immediately
  const list = getLocalPlansOnly();
  const index = list.findIndex(p => p.code === normalizedPlan.code || p.id === normalizedPlan.id);
  if (index >= 0) {
    list[index] = normalizedPlan;
  } else {
    list.push(normalizedPlan);
  }
  if (typeof window !== 'undefined') {
    const serialized = JSON.stringify(list);
    localStorage.setItem(STORAGE_KEYS.PLANS, serialized);
    localStorage.setItem(STORAGE_KEYS.LEGACY_PLANS, serialized);
  }

  const supabase = getSupabase();
  if (!supabase) {
    lastPlanSyncError = 'Supabase não configurado neste ambiente (verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).';
    return false;
  }

  try {
    const dbPayload = buildPlanDbPayload(normalizedPlan);
    const { data, error } = await supabase
      .from('plans')
      .upsert(dbPayload, { onConflict: 'code' })
      .select();

    if (error) {
      lastPlanSyncError = `${error.message}${error.details ? ` (${error.details})` : ''}${error.hint ? ` — ${error.hint}` : ''}`;
      console.error('Erro ao fazer upsert do plano no Supabase:', error);
      return false;
    }

    if (!data || data.length === 0) {
      lastPlanSyncError = 'O Supabase não retornou registros atualizados (possível bloqueio de RLS para INSERT/UPDATE na tabela public.plans).';
      console.error(lastPlanSyncError);
      return false;
    }

    lastPlanSyncError = null;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('medsync-plans-updated'));
      window.dispatchEvent(new CustomEvent('medsync-plans-updated', { detail: { plans: list, updatedPlan: normalizedPlan } }));
      window.dispatchEvent(new Event('medsync_storage_update'));
    }

    StorageService.addAuditLog({
      action: 'Atualizou Plano Comercial',
      entity: 'Planos SaaS',
      entityId: String(data[0].id || normalizedPlan.id),
      details: `Plano ${normalizedPlan.name}: R$ ${normalizedPlan.priceMonthly.toFixed(2)}/mês (R$ ${normalizedPlan.priceYearly.toFixed(2)}/ano)`,
    });

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastPlanSyncError = message;
    console.error('Exceção ao atualizar plano no Supabase:', err);
    return false;
  }
}

// Storage Service API
export const StorageService = {
  // Reset all data to factory demo state
  resetAll: () => {
    setStored(STORAGE_KEYS.PLANS, INITIAL_PLANS);
    setStored(STORAGE_KEYS.ORGANIZATION, INITIAL_ORGANIZATION);
    setStored(STORAGE_KEYS.CLINIC, INITIAL_CLINIC);
    setStored(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
    setStored(STORAGE_KEYS.ROOMS, INITIAL_ROOMS);
    setStored(STORAGE_KEYS.SPECIALTIES, INITIAL_SPECIALTIES);
    setStored(STORAGE_KEYS.PROFESSIONALS, INITIAL_PROFESSIONALS);
    setStored(STORAGE_KEYS.SERVICES, INITIAL_SERVICES);
    setStored(STORAGE_KEYS.USERS, INITIAL_USERS);
    setStored(STORAGE_KEYS.PATIENTS, INITIAL_PATIENTS);
    setStored(STORAGE_KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS);
    setStored(STORAGE_KEYS.WAITLIST, INITIAL_WAITLIST);
    setStored(STORAGE_KEYS.MEDICAL_RECORDS, INITIAL_MEDICAL_RECORDS);
    setStored(STORAGE_KEYS.PRESCRIPTIONS, INITIAL_PRESCRIPTIONS);
    setStored(STORAGE_KEYS.CERTIFICATES, INITIAL_CERTIFICATES);
    setStored(STORAGE_KEYS.LAB_ORDERS, INITIAL_LAB_ORDERS);
    setStored(STORAGE_KEYS.EXAM_RESULTS, INITIAL_EXAM_RESULTS);
    setStored(STORAGE_KEYS.TEMPLATES, INITIAL_TEMPLATES);
    setStored(STORAGE_KEYS.MESSAGES, INITIAL_MESSAGES);
    setStored(STORAGE_KEYS.FINANCIAL, INITIAL_FINANCIAL);
    setStored(STORAGE_KEYS.WEBSITE, INITIAL_WEBSITE);
    setStored(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
    window.dispatchEvent(new Event('medsync_storage_update'));
  },

  // SaaS Plans (Persisted in localStorage & Supabase with real-time events)
  syncPlansFromSupabase,
  updatePlanInSupabase,
  getLastPlanSyncError,

  getPlans: (): Plan[] => {
    return getLocalPlansOnly();
  },

  savePlan: (plan: Plan | SaasPlan): void => {
    void updatePlanInSupabase(plan as Plan);
  },

  updatePlans: (plans: Plan[] | SaasPlan[]): void => {
    if (typeof window !== 'undefined') {
      const serialized = JSON.stringify(plans);
      localStorage.setItem(STORAGE_KEYS.PLANS, serialized);
      localStorage.setItem(STORAGE_KEYS.LEGACY_PLANS, serialized);
    }

    const supabase = getSupabase();
    if (supabase) {
      const payloads = plans.map(p => buildPlanDbPayload(p));
      Promise.resolve(supabase.from('plans').upsert(payloads, { onConflict: 'code' }))
        .then(({ error }) => {
          if (error) {
            console.warn('Erro ao sincronizar lista de planos no Supabase:', error.message);
          }
        })
        .catch(err => console.warn('Erro ao sincronizar lista de planos no Supabase:', err));
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('medsync-plans-updated'));
      window.dispatchEvent(new CustomEvent('medsync-plans-updated', { detail: { plans } }));
      window.dispatchEvent(new Event('medsync_storage_update'));
    }
  },

  // Organization
  getOrganization: (): Organization => getStored<Organization>(STORAGE_KEYS.ORGANIZATION, INITIAL_ORGANIZATION),
  updateOrganization: (updates: Partial<Organization>): Organization => {
    const org = { ...StorageService.getOrganization(), ...updates };
    setStored(STORAGE_KEYS.ORGANIZATION, org);
    return org;
  },

  // Clinic (localStorage + Supabase public.clinics)
  getClinic: (): Clinic => getStored<Clinic>(STORAGE_KEYS.CLINIC, INITIAL_CLINIC),
  updateClinic: (updates: Partial<Clinic>): Clinic => {
    const clinic = { ...StorageService.getClinic(), ...updates };
    setStored(STORAGE_KEYS.CLINIC, clinic);
    return clinic;
  },
  fetchClinicFromCloud: async (params?: {
    clinicId?: string;
    organizationId?: string;
    customDomain?: string;
    slug?: string;
  }): Promise<{ clinic: Clinic; source: 'cloud' | 'local' }> => {
    const localClinic = StorageService.getClinic();
    const supabase = getSupabase();
    if (!supabase) {
      return { clinic: localClinic, source: 'local' };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      let resolvedClinicId = isUuid(params?.clinicId) ? params?.clinicId : undefined;
      let resolvedOrgId = isUuid(params?.organizationId) ? params?.organizationId : undefined;

      const targetDomain = (params?.customDomain || '').trim().toLowerCase();
      if (!resolvedClinicId && targetDomain) {
        const bareDomain = targetDomain.replace(/^www\./, '');
        const domainCandidates = Array.from(
          new Set([targetDomain, bareDomain, `www.${bareDomain}`])
        );
        const { data: domRow } = await supabase
          .from('clinic_domains')
          .select('clinic_id, organization_id')
          .in('domain', domainCandidates)
          .limit(1)
          .maybeSingle();
        if (domRow?.clinic_id) resolvedClinicId = String(domRow.clinic_id);
        if (domRow?.organization_id) resolvedOrgId = String(domRow.organization_id);
      }

      if (!resolvedOrgId && params?.slug) {
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', params.slug.trim().toLowerCase())
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) resolvedOrgId = String(orgRow.id);
      }

      let clinicRow: Record<string, unknown> | null = null;
      if (resolvedClinicId) {
        const { data } = await supabase
          .from('clinics')
          .select('*')
          .eq('id', resolvedClinicId)
          .limit(1)
          .maybeSingle();
        if (data) clinicRow = data as Record<string, unknown>;
      }

      if (!clinicRow && resolvedOrgId) {
        const { data } = await supabase
          .from('clinics')
          .select('*')
          .eq('organization_id', resolvedOrgId)
          .limit(1)
          .maybeSingle();
        if (data) clinicRow = data as Record<string, unknown>;
      }

      if (!clinicRow) {
        const { data } = await supabase
          .from('clinics')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) clinicRow = data as Record<string, unknown>;
      }

      if (!clinicRow) {
        return { clinic: localClinic, source: 'local' };
      }

      const mapped: Clinic = {
        ...localClinic,
        id: String(clinicRow.id || localClinic.id),
        organizationId: String(clinicRow.organization_id || localClinic.organizationId),
        legalName: clinicRow.legal_name ? String(clinicRow.legal_name) : localClinic.legalName,
        tradeName: clinicRow.trade_name ? String(clinicRow.trade_name) : localClinic.tradeName,
        documentNumber: clinicRow.document_number
          ? String(clinicRow.document_number)
          : localClinic.documentNumber,
        municipalRegistration:
          clinicRow.municipal_registration != null
            ? String(clinicRow.municipal_registration)
            : localClinic.municipalRegistration,
        email: clinicRow.email ? String(clinicRow.email) : localClinic.email,
        phone: clinicRow.phone ? String(clinicRow.phone) : localClinic.phone,
        whatsapp: clinicRow.whatsapp != null ? String(clinicRow.whatsapp) : localClinic.whatsapp,
        logoUrl: clinicRow.logo_url ? String(clinicRow.logo_url) : localClinic.logoUrl,
        primaryColor: clinicRow.primary_color
          ? String(clinicRow.primary_color)
          : localClinic.primaryColor,
        institutionalBio:
          clinicRow.institutional_bio != null
            ? String(clinicRow.institutional_bio)
            : localClinic.institutionalBio,
        n8nWebhookDisponibilidade: clinicRow.n8n_webhook_disponibilidade
          ? String(clinicRow.n8n_webhook_disponibilidade)
          : localClinic.n8nWebhookDisponibilidade,
        n8nWebhookAgendamento: clinicRow.n8n_webhook_agendamento
          ? String(clinicRow.n8n_webhook_agendamento)
          : localClinic.n8nWebhookAgendamento,
        n8nWebhookMegaapiInbound: clinicRow.n8n_webhook_megaapi_inbound
          ? String(clinicRow.n8n_webhook_megaapi_inbound)
          : localClinic.n8nWebhookMegaapiInbound || INITIAL_CLINIC.n8nWebhookMegaapiInbound,
        automationTriggers:
          clinicRow.automation_triggers && typeof clinicRow.automation_triggers === 'object'
            ? {
                ...(INITIAL_CLINIC.automationTriggers || {
                  immediateConfirmation: true,
                  confirmation48h: true,
                  reminder24h: true,
                  autoReplyConfirm: true,
                  postCare: true,
                }),
                ...(clinicRow.automation_triggers as Partial<Clinic['automationTriggers']>),
              }
            : localClinic.automationTriggers || INITIAL_CLINIC.automationTriggers,
        megaapiInstanceUrl: clinicRow.megaapi_instance_url
          ? String(clinicRow.megaapi_instance_url)
          : localClinic.megaapiInstanceUrl,
        megaapiInstanceKey: clinicRow.megaapi_instance_key
          ? String(clinicRow.megaapi_instance_key)
          : localClinic.megaapiInstanceKey,
        megaapiToken: clinicRow.megaapi_token
          ? String(clinicRow.megaapi_token)
          : localClinic.megaapiToken,
        createdAt: clinicRow.created_at ? String(clinicRow.created_at) : localClinic.createdAt,
      };

      setStored(STORAGE_KEYS.CLINIC, mapped);
      return { clinic: mapped, source: 'cloud' };
    } catch (err) {
      console.warn('Aviso ao carregar dados da clínica na nuvem:', err);
      return { clinic: localClinic, source: 'local' };
    }
  },
  saveClinicToCloud: async (
    updates: Partial<Clinic>
  ): Promise<{ success: boolean; clinic: Clinic; syncedCloud: boolean; error?: string }> => {
    const merged = StorageService.updateClinic(updates);

    StorageService.addAuditLog({
      action: 'Atualizou Configurações da Clínica',
      entity: 'Clínica',
      entityId: merged.id,
      details: `Configurações atualizadas para ${merged.tradeName}`,
    });

    const supabase = getSupabase();
    if (!supabase) {
      return { success: true, clinic: merged, syncedCloud: false };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      let targetClinicId = isUuid(merged.id) ? merged.id : undefined;
      let targetOrgId = isUuid(merged.organizationId) ? merged.organizationId : undefined;

      if (!targetOrgId) {
        const orgSlug = (StorageService.getOrganization().slug || 'dr-newton-mureb')
          .trim()
          .toLowerCase();
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          targetOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) targetOrgId = String(firstOrg.id);
        }
      }

      if (!targetClinicId && targetOrgId) {
        const { data: clinicRow } = await supabase
          .from('clinics')
          .select('id')
          .eq('organization_id', targetOrgId)
          .limit(1)
          .maybeSingle();
        if (clinicRow?.id) targetClinicId = String(clinicRow.id);
      }

      if (!targetClinicId) {
        const { data: firstClinic } = await supabase
          .from('clinics')
          .select('id, organization_id')
          .limit(1)
          .maybeSingle();
        if (firstClinic?.id) {
          targetClinicId = String(firstClinic.id);
          if (!targetOrgId && firstClinic.organization_id) {
            targetOrgId = String(firstClinic.organization_id);
          }
        }
      }

      if (!targetClinicId) {
        return { success: true, clinic: merged, syncedCloud: false };
      }

      const basePayload: Record<string, unknown> = {
        legal_name: merged.legalName,
        trade_name: merged.tradeName,
        document_number: merged.documentNumber,
        municipal_registration: merged.municipalRegistration || null,
        email: merged.email,
        phone: merged.phone,
        whatsapp: merged.whatsapp || null,
        primary_color: merged.primaryColor || '#1E2024',
        institutional_bio: merged.institutionalBio || null,
        updated_at: new Date().toISOString(),
      };

      const integrationWithoutKeyPayload: Record<string, unknown> = {
        ...basePayload,
        megaapi_instance_url: merged.megaapiInstanceUrl?.trim() || null,
        megaapi_token: merged.megaapiToken?.trim() || null,
        n8n_webhook_disponibilidade: merged.n8nWebhookDisponibilidade?.trim() || null,
        n8n_webhook_agendamento: merged.n8nWebhookAgendamento?.trim() || null,
      };

      const integrationWithKeyPayload: Record<string, unknown> = {
        ...integrationWithoutKeyPayload,
        megaapi_instance_key: merged.megaapiInstanceKey?.trim() || null,
      };

      const extendedPayload: Record<string, unknown> = {
        ...integrationWithKeyPayload,
        n8n_webhook_megaapi_inbound: merged.n8nWebhookMegaapiInbound?.trim() || null,
        automation_triggers: merged.automationTriggers || INITIAL_CLINIC.automationTriggers,
      };

      const { data: updatedExtended, error: extErr } = await supabase
        .from('clinics')
        .update(extendedPayload)
        .eq('id', targetClinicId)
        .select('id, organization_id')
        .maybeSingle();

      if (extErr) {
        // Retry without inbound/triggers columns if 20261116020000 isn't migrated yet
        const { error: withKeyErr } = await supabase
          .from('clinics')
          .update(integrationWithKeyPayload)
          .eq('id', targetClinicId);

        if (!withKeyErr) {
          return {
            success: true,
            clinic: merged,
            syncedCloud: true,
            error: extErr.message,
          };
        }

        // Retry without megaapi_instance_key if that column wasn't migrated yet
        const { error: partialExtErr } = await supabase
          .from('clinics')
          .update(integrationWithoutKeyPayload)
          .eq('id', targetClinicId);

        if (!partialExtErr) {
          return {
            success: true,
            clinic: merged,
            syncedCloud: true,
            error: extErr.message,
          };
        }

        // Retry base fields if optional integration columns are not migrated yet
        const { error: baseErr } = await supabase
          .from('clinics')
          .update(basePayload)
          .eq('id', targetClinicId);

        if (baseErr) {
          return { success: true, clinic: merged, syncedCloud: false, error: baseErr.message };
        }
        return {
          success: true,
          clinic: merged,
          syncedCloud: true,
          error: extErr.message,
        };
      }

      if (updatedExtended?.id) {
        const syncedClinic: Clinic = {
          ...merged,
          id: String(updatedExtended.id),
          organizationId: String(updatedExtended.organization_id || targetOrgId || merged.organizationId),
        };
        setStored(STORAGE_KEYS.CLINIC, syncedClinic);
        return { success: true, clinic: syncedClinic, syncedCloud: true };
      }

      return { success: true, clinic: merged, syncedCloud: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Aviso ao sincronizar clínica na nuvem:', msg);
      return { success: true, clinic: merged, syncedCloud: false, error: msg };
    }
  },

  // Branches
  getBranches: (): Branch[] => getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES),
  saveBranch: (branch: Branch): void => {
    const list = StorageService.getBranches();
    const index = list.findIndex(b => b.id === branch.id);
    if (index >= 0) {
      list[index] = branch;
    } else {
      list.push(branch);
    }
    setStored(STORAGE_KEYS.BRANCHES, list);
  },

  // Rooms
  getRooms: (): Room[] => getStored<Room[]>(STORAGE_KEYS.ROOMS, INITIAL_ROOMS),
  saveRoom: (room: Room): void => {
    const list = StorageService.getRooms();
    const index = list.findIndex(r => r.id === room.id);
    if (index >= 0) {
      list[index] = room;
    } else {
      list.push(room);
    }
    setStored(STORAGE_KEYS.ROOMS, list);
  },

  // Users
  getUsers: (): UserProfile[] => getStored<UserProfile[]>(STORAGE_KEYS.USERS, INITIAL_USERS),
  saveUser: (user: UserProfile): void => {
    const list = StorageService.getUsers();
    const index = list.findIndex(u => u.id === user.id);
    if (index >= 0) {
      list[index] = user;
    } else {
      list.push(user);
    }
    setStored(STORAGE_KEYS.USERS, list);
  },

  // Specialties
  getSpecialties: (): Specialty[] => getStored<Specialty[]>(STORAGE_KEYS.SPECIALTIES, INITIAL_SPECIALTIES),
  saveSpecialty: (specialty: Specialty): void => {
    const list = StorageService.getSpecialties();
    const index = list.findIndex(s => s.id === specialty.id);
    if (index >= 0) {
      list[index] = specialty;
    } else {
      list.push(specialty);
    }
    setStored(STORAGE_KEYS.SPECIALTIES, list);
  },

  // Professionals
  getProfessionals: (): Professional[] => getStored<Professional[]>(STORAGE_KEYS.PROFESSIONALS, INITIAL_PROFESSIONALS),
  saveProfessional: (professional: Professional): void => {
    const list = StorageService.getProfessionals();
    const index = list.findIndex(p => p.id === professional.id);
    if (index >= 0) {
      list[index] = professional;
    } else {
      list.push(professional);
    }
    setStored(STORAGE_KEYS.PROFESSIONALS, list);
  },

  // Services
  getServices: (): Service[] => getStored<Service[]>(STORAGE_KEYS.SERVICES, INITIAL_SERVICES),
  saveService: (service: Service): void => {
    const list = StorageService.getServices();
    const index = list.findIndex(s => s.id === service.id);
    if (index >= 0) {
      list[index] = service;
    } else {
      list.push(service);
    }
    setStored(STORAGE_KEYS.SERVICES, list);
  },

  // Patients (with duplicate CPF prevention and Model A/B sharing logic)
  getPatients: (branchFilterId?: string): Patient[] => {
    const list = getStored<Patient[]>(STORAGE_KEYS.PATIENTS, INITIAL_PATIENTS);
    if (!branchFilterId || branchFilterId === 'all') return list;

    // Filter based on originBranch or authorized sharing
    return list.filter(p => {
      if (p.originBranchId === branchFilterId) return true;
      if (p.sharingMode === 'model_b_shared' && p.authorizedBranchIds?.includes(branchFilterId)) {
        return true;
      }
      return false;
    });
  },
  savePatient: (patient: Patient): { success: boolean; message?: string } => {
    const list = getStored<Patient[]>(STORAGE_KEYS.PATIENTS, INITIAL_PATIENTS);
    
    // Check CPF duplicate for other patients
    const normalizedCpf = patient.documentCpf.replace(/\D/g, '');
    const duplicate = list.find(p => p.id !== patient.id && p.documentCpf.replace(/\D/g, '') === normalizedCpf);
    if (duplicate) {
      return { 
        success: false, 
        message: `Já existe um paciente cadastrado com este CPF (${duplicate.fullName} na filial ${duplicate.originBranchId}). Evite duplicidades.` 
      };
    }

    const index = list.findIndex(p => p.id === patient.id);
    if (index >= 0) {
      list[index] = patient;
    } else {
      list.unshift(patient);
    }
    setStored(STORAGE_KEYS.PATIENTS, list);
    
    StorageService.addAuditLog({
      action: index >= 0 ? 'Atualizou Paciente' : 'Cadastrou Novo Paciente',
      entity: 'Paciente',
      entityId: patient.id,
      details: `${patient.fullName} (${patient.documentCpf}) - Filial Origem: ${patient.originBranchId}`,
    });

    return { success: true };
  },
  upsertPatientByCpf: (patient: Patient): Patient => {
    const list = getStored<Patient[]>(STORAGE_KEYS.PATIENTS, INITIAL_PATIENTS);
    const normalizedCpf = patient.documentCpf.replace(/\D/g, '');
    const existingIndex = list.findIndex(
      p => p.documentCpf.replace(/\D/g, '') === normalizedCpf
    );

    if (existingIndex >= 0) {
      const existing = list[existingIndex];
      const merged: Patient = {
        ...existing,
        fullName: patient.fullName || existing.fullName,
        phone: patient.phone || existing.phone,
        whatsapp: patient.whatsapp || existing.whatsapp,
        email: patient.email || existing.email,
        administrativeNotes: patient.administrativeNotes || existing.administrativeNotes,
      };
      list[existingIndex] = merged;
      setStored(STORAGE_KEYS.PATIENTS, list);
      return merged;
    }

    list.unshift(patient);
    setStored(STORAGE_KEYS.PATIENTS, list);
    StorageService.addAuditLog({
      action: 'Paciente Cadastrado via Agenda Online',
      entity: 'Paciente',
      entityId: patient.id,
      details: `${patient.fullName} (${patient.documentCpf}) - Origem: Agendamento Online`,
    });
    return patient;
  },

  // Appointments
  getAppointments: (branchFilterId?: string): Appointment[] => {
    const list = getStored<Appointment[]>(STORAGE_KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS);
    if (!branchFilterId || branchFilterId === 'all') return list;
    return list.filter(a => a.branchId === branchFilterId);
  },
  saveAppointment: (appointment: Appointment): { success: boolean; message?: string } => {
    const list = getStored<Appointment[]>(STORAGE_KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS);

    // Concurrency / duplicate slot check (unless marked as overbook / encaixe)
    if (!appointment.isOverbook && appointment.status !== 'cancelled') {
      const conflict = list.find(a => 
        a.id !== appointment.id &&
        a.professionalId === appointment.professionalId &&
        a.branchId === appointment.branchId &&
        a.status !== 'cancelled' &&
        new Date(a.startTime).getTime() < new Date(appointment.endTime).getTime() &&
        new Date(a.endTime).getTime() > new Date(appointment.startTime).getTime()
      );
      if (conflict) {
        return {
          success: false,
          message: `Conflito de horário! O profissional já possui uma consulta com ${conflict.patientName} no mesmo intervalo. Marque como "Encaixe" se desejar forçar.`
        };
      }
    }

    const index = list.findIndex(a => a.id === appointment.id);
    if (index >= 0) {
      list[index] = appointment;
    } else {
      list.unshift(appointment);
    }
    setStored(STORAGE_KEYS.APPOINTMENTS, list);

    StorageService.addAuditLog({
      action: index >= 0 ? `Atualizou Consulta (${appointment.status})` : 'Novo Agendamento Criado',
      entity: 'Agendamento',
      entityId: appointment.id,
      details: `Paciente: ${appointment.patientName} com ${appointment.professionalName} em ${new Date(appointment.startTime).toLocaleString('pt-BR')}`,
    });

    return { success: true };
  },
  updateAppointmentStatus: (id: string, status: AppointmentStatus, cancellationReason?: string): void => {
    const list = StorageService.getAppointments();
    const apt = list.find(a => a.id === id);
    if (apt) {
      apt.status = status;
      if (status === 'cancelled' && cancellationReason) {
        apt.cancellationReason = cancellationReason;
      } else if (status === 'scheduled' || status === 'confirmed') {
        apt.cancellationReason = undefined;
      }
      setStored(STORAGE_KEYS.APPOINTMENTS, list);

      StorageService.addAuditLog({
        action: `Status alterado para: ${status}`,
        entity: 'Agendamento',
        entityId: id,
        details: `Paciente ${apt.patientName}. ${cancellationReason ? `Motivo: ${cancellationReason}` : ''}`,
      });
    }
  },

  // Waitlist
  getWaitlist: (branchFilterId?: string): WaitlistEntry[] => {
    const list = getStored<WaitlistEntry[]>(STORAGE_KEYS.WAITLIST, INITIAL_WAITLIST);
    if (!branchFilterId || branchFilterId === 'all') return list;
    return list.filter(w => w.branchId === branchFilterId);
  },
  saveWaitlistEntry: (entry: WaitlistEntry): void => {
    const list = StorageService.getWaitlist();
    const index = list.findIndex(w => w.id === entry.id);
    if (index >= 0) {
      list[index] = entry;
    } else {
      list.unshift(entry);
    }
    setStored(STORAGE_KEYS.WAITLIST, list);
  },
  removeWaitlistEntry: (id: string): void => {
    const list = StorageService.getWaitlist().filter(w => w.id !== id);
    setStored(STORAGE_KEYS.WAITLIST, list);
  },

  // Medical Records (Electronic Health Record - CFM 1.638/2002 e 1.821/2007)
  getMedicalRecords: (patientId?: string): MedicalRecordEntry[] => {
    const list = getStored<MedicalRecordEntry[]>(STORAGE_KEYS.MEDICAL_RECORDS, INITIAL_MEDICAL_RECORDS);
    if (!patientId) return list;
    return list.filter(r => r.patientId === patientId);
  },

  saveMedicalRecord: (record: MedicalRecordEntry): { success: boolean; message?: string } => {
    const list = getStored<MedicalRecordEntry[]>(STORAGE_KEYS.MEDICAL_RECORDS, INITIAL_MEDICAL_RECORDS);
    const index = list.findIndex(r => r.id === record.id);
    
    if (index >= 0) {
      const existing = list[index];
      // Regra de Ouro do CFM: Registro assinado não pode ser reeditado
      if (existing.status === 'signed' && existing.isSigned) {
        return {
          success: false,
          message: 'Conformidade CFM (Resolução nº 1.821/2007): Uma evolução médica assinada é imutável e não pode ser editada. Adicione um "Adendo / Errata" para correções.'
        };
      }
      list[index] = { ...record, updatedAt: new Date().toISOString() };
    } else {
      list.unshift(record);
    }
    
    setStored(STORAGE_KEYS.MEDICAL_RECORDS, list);

    StorageService.addAuditLog({
      action: index >= 0 
        ? `Atualizou Evolução (${record.status === 'signed' ? 'Finalizada/Assinada' : 'Rascunho'})` 
        : `Novo Registro de Prontuário (${record.status === 'signed' ? 'Assinado' : 'Rascunho'})`,
      entity: 'Prontuário',
      entityId: record.id,
      details: `Profissional: ${record.professionalName} (${record.professionalCouncilNumber || 'CRM'}) - Queixa: ${record.chiefComplaint.substring(0, 50)}...`,
    });

    return { success: true };
  },

  addMedicalRecordAddendum: (recordId: string, addendum: MedicalRecordAddendum): { success: boolean; message?: string } => {
    const list = getStored<MedicalRecordEntry[]>(STORAGE_KEYS.MEDICAL_RECORDS, INITIAL_MEDICAL_RECORDS);
    const index = list.findIndex(r => r.id === recordId);
    if (index === -1) {
      return { success: false, message: 'Registro clínico original não encontrado.' };
    }

    const record = list[index];
    if (!record.addendums) {
      record.addendums = [];
    }

    record.addendums.push(addendum);
    record.updatedAt = new Date().toISOString();
    list[index] = record;
    setStored(STORAGE_KEYS.MEDICAL_RECORDS, list);

    StorageService.addAuditLog({
      action: 'Adicionou Adendo / Errata ao Prontuário (CFM 1.821/2007)',
      entity: 'Prontuário',
      entityId: record.id,
      details: `Adendo por ${addendum.authorName} (${addendum.authorCouncilNumber}): ${addendum.note.substring(0, 60)}...`,
    });

    return { success: true };
  },

  // Prescrições e Receituários (Portaria ANVISA 344/98 e Receitas Simples)
  getPrescriptions: (patientId?: string): Prescription[] => {
    const list = getStored<Prescription[]>(STORAGE_KEYS.PRESCRIPTIONS, INITIAL_PRESCRIPTIONS);
    if (!patientId) return list;
    return list.filter(p => p.patientId === patientId);
  },
  savePrescription: (prescription: Prescription): void => {
    const list = getStored<Prescription[]>(STORAGE_KEYS.PRESCRIPTIONS, INITIAL_PRESCRIPTIONS);
    const index = list.findIndex(p => p.id === prescription.id);
    if (index >= 0) {
      list[index] = prescription;
    } else {
      list.unshift(prescription);
    }
    setStored(STORAGE_KEYS.PRESCRIPTIONS, list);

    StorageService.addAuditLog({
      action: `Emissão de Receita (${prescription.type === 'controle_especial' ? 'Controle Especial ANVISA 344/98' : 'Simples'})`,
      entity: 'Prescrição',
      entityId: prescription.id,
      details: `Paciente: ${prescription.patientName} - ${prescription.items.length} medicamento(s) prescritos por ${prescription.professionalName}`,
    });
  },

  // Atestados Médicos e Declarações (Resolução CFM nº 1.658/2002)
  getCertificates: (patientId?: string): MedicalCertificate[] => {
    const list = getStored<MedicalCertificate[]>(STORAGE_KEYS.CERTIFICATES, INITIAL_CERTIFICATES);
    if (!patientId) return list;
    return list.filter(c => c.patientId === patientId);
  },
  saveCertificate: (certificate: MedicalCertificate): void => {
    const list = getStored<MedicalCertificate[]>(STORAGE_KEYS.CERTIFICATES, INITIAL_CERTIFICATES);
    const index = list.findIndex(c => c.id === certificate.id);
    if (index >= 0) {
      list[index] = certificate;
    } else {
      list.unshift(certificate);
    }
    setStored(STORAGE_KEYS.CERTIFICATES, list);

    StorageService.addAuditLog({
      action: `Emissão de Atestado Médico (${certificate.type.toUpperCase()})`,
      entity: 'Atestado',
      entityId: certificate.id,
      details: `Paciente: ${certificate.patientName} - CID-10: ${certificate.showCidOnPrint ? certificate.cid10Code : 'Oculto a pedido do sigilo CFM'} - Médico: ${certificate.professionalName}`,
    });
  },

  // Pedidos de Exames (Lab Orders)
  getLabOrders: (patientId?: string): LabOrder[] => {
    const list = getStored<LabOrder[]>(STORAGE_KEYS.LAB_ORDERS, INITIAL_LAB_ORDERS);
    if (!patientId) return list;
    return list.filter(o => o.patientId === patientId);
  },
  saveLabOrder: (order: LabOrder): void => {
    const list = getStored<LabOrder[]>(STORAGE_KEYS.LAB_ORDERS, INITIAL_LAB_ORDERS);
    const index = list.findIndex(o => o.id === order.id);
    if (index >= 0) {
      list[index] = order;
    } else {
      list.unshift(order);
    }
    setStored(STORAGE_KEYS.LAB_ORDERS, list);

    StorageService.addAuditLog({
      action: 'Emissão de Solicitação de Exames',
      entity: 'Exames',
      entityId: order.id,
      details: `Paciente: ${order.patientName} - ${order.items.length} exames solicitados por ${order.professionalName}`,
    });
  },

  // Resultados de Exames (Exam Results)
  getExamResults: (patientId?: string): ExamResult[] => {
    const list = getStored<ExamResult[]>(STORAGE_KEYS.EXAM_RESULTS, INITIAL_EXAM_RESULTS);
    if (!patientId) return list;
    return list.filter(r => r.patientId === patientId);
  },
  saveExamResult: (result: ExamResult): void => {
    const list = getStored<ExamResult[]>(STORAGE_KEYS.EXAM_RESULTS, INITIAL_EXAM_RESULTS);
    const index = list.findIndex(r => r.id === result.id);
    if (index >= 0) {
      list[index] = result;
    } else {
      list.unshift(result);
    }
    setStored(STORAGE_KEYS.EXAM_RESULTS, list);

    StorageService.addAuditLog({
      action: 'Registro de Resultado de Exame',
      entity: 'Exames',
      entityId: result.id,
      details: `${result.examName} - Laboratório: ${result.laboratoryName} - Status: ${result.status}`,
    });
  },

  // Message Templates & Logs
  getTemplates: (): MessageTemplate[] => {
    const stored = getStored<MessageTemplate[]>(STORAGE_KEYS.TEMPLATES, INITIAL_TEMPLATES);
    if (!Array.isArray(stored) || stored.length === 0) {
      return INITIAL_TEMPLATES;
    }
    const existingIds = new Set(stored.map((t) => t.id));
    const existingCategories = new Set(stored.map((t) => t.category));
    const missingDefaults = INITIAL_TEMPLATES.filter(
      (def) => !existingIds.has(def.id) && !existingCategories.has(def.category)
    );
    if (missingDefaults.length > 0) {
      const merged = [...stored, ...missingDefaults];
      setStored(STORAGE_KEYS.TEMPLATES, merged);
      return merged;
    }
    return stored;
  },
  saveTemplate: (template: MessageTemplate): void => {
    const extractedVars = Array.from(
      new Set(
        Array.from(template.content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map(
          (m) => m[1]
        )
      )
    );
    const normalized: MessageTemplate = {
      ...template,
      variables: extractedVars.length > 0 ? extractedVars : template.variables || [],
    };
    const list = StorageService.getTemplates();
    const index = list.findIndex((t) => t.id === normalized.id);
    if (index >= 0) {
      list[index] = normalized;
    } else {
      list.unshift(normalized);
    }
    setStored(STORAGE_KEYS.TEMPLATES, list);
  },
  fetchTemplatesFromCloud: async (tenantHints?: {
    organizationId?: string;
    slug?: string;
  }): Promise<{
    templates: MessageTemplate[];
    source: 'cloud' | 'local';
    organizationId?: string;
    error?: string;
  }> => {
    const localTemplates = StorageService.getTemplates();
    const supabase = getSupabase();
    if (!supabase) {
      return { templates: localTemplates, source: 'local' };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      let supaOrgId: string | undefined = isUuid(tenantHints?.organizationId)
        ? tenantHints?.organizationId
        : undefined;

      if (!supaOrgId) {
        const orgSlug = (
          tenantHints?.slug ||
          StorageService.getOrganization().slug ||
          'dr-newton-mureb'
        )
          .trim()
          .toLowerCase();

        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();

        if (orgRow?.id) {
          supaOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) supaOrgId = String(firstOrg.id);
        }
      }

      if (!supaOrgId) {
        return { templates: localTemplates, source: 'local' };
      }

      const mapRow = (row: Record<string, unknown>): MessageTemplate => ({
        id: String(row.id),
        organizationId: String(row.organization_id || supaOrgId),
        name: String(row.name || 'Modelo sem título'),
        category: (row.category as MessageTemplate['category']) || 'custom',
        channel: (row.channel as MessageTemplate['channel']) || 'whatsapp',
        content: String(row.content || ''),
        variables: Array.isArray(row.variables)
          ? (row.variables as string[])
          : [
              'nome_paciente',
              'nome_clinica',
              'nome_profissional',
              'data_consulta',
              'horario_consulta',
              'endereco_filial',
            ],
        isActive: row.is_active !== false,
        createdAt: row.created_at ? String(row.created_at) : undefined,
        updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      });

      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('organization_id', supaOrgId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('Erro ao carregar public.message_templates:', error.message);
        return {
          templates: localTemplates,
          source: 'local',
          organizationId: supaOrgId,
          error: error.message,
        };
      }

      if (data && data.length > 0) {
        const mapped = data.map((row) => mapRow(row as Record<string, unknown>));
        setStored(STORAGE_KEYS.TEMPLATES, mapped);
        return { templates: mapped, source: 'cloud', organizationId: supaOrgId };
      }

      // First load for this tenant: seed defaults in public.message_templates so ERP and n8n stay synchronized
      const nowIso = new Date().toISOString();
      const seedPayload = localTemplates.map((tpl) => ({
        organization_id: supaOrgId,
        name: tpl.name.trim(),
        category: tpl.category || 'custom',
        channel: tpl.channel || 'whatsapp',
        content: tpl.content,
        variables: tpl.variables || [],
        is_active: tpl.isActive !== false,
        updated_at: nowIso,
      }));

      let seedRes = await supabase.from('message_templates').upsert(seedPayload).select('*');
      if (seedRes.error && /updated_at/i.test(seedRes.error.message)) {
        const seedWithoutUpdatedAt = seedPayload.map(({ updated_at: _u, ...rest }) => rest);
        seedRes = await supabase
          .from('message_templates')
          .upsert(seedWithoutUpdatedAt)
          .select('*');
      }

      if (!seedRes.error && seedRes.data && seedRes.data.length > 0) {
        const mappedSeed = seedRes.data.map((row) => mapRow(row as Record<string, unknown>));
        setStored(STORAGE_KEYS.TEMPLATES, mappedSeed);
        return { templates: mappedSeed, source: 'cloud', organizationId: supaOrgId };
      }

      return {
        templates: localTemplates,
        source: 'local',
        organizationId: supaOrgId,
        error: seedRes.error?.message,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Aviso ao buscar modelos na nuvem.';
      console.warn('Aviso ao buscar modelos de mensagens na nuvem:', msg);
      return { templates: localTemplates, source: 'local', error: msg };
    }
  },
  saveTemplateToCloud: async (
    template: MessageTemplate,
    tenantHints?: { organizationId?: string; slug?: string }
  ): Promise<{ template: MessageTemplate; syncedCloud: boolean; error?: string }> => {
    const nowIso = new Date().toISOString();
    const extractedVars = Array.from(
      new Set(
        Array.from(template.content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map(
          (m) => m[1]
        )
      )
    );
    const prepared: MessageTemplate = {
      ...template,
      variables: extractedVars.length > 0 ? extractedVars : template.variables || [],
      updatedAt: nowIso,
    };

    StorageService.saveTemplate(prepared);
    StorageService.addAuditLog({
      action: 'Salvou Modelo de Mensagem',
      entity: 'Comunicação',
      entityId: prepared.id,
      details: `Modelo "${prepared.name}" (${prepared.category})`,
    });

    const supabase = getSupabase();
    if (!supabase) {
      return {
        template: prepared,
        syncedCloud: false,
        error: 'Cliente Supabase não configurado neste ambiente.',
      };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    const generateUuid = (): string => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    try {
      let supaOrgId: string | undefined = isUuid(tenantHints?.organizationId)
        ? tenantHints?.organizationId
        : isUuid(prepared.organizationId)
          ? prepared.organizationId
          : undefined;

      if (!supaOrgId) {
        const orgSlug = (
          tenantHints?.slug ||
          StorageService.getOrganization().slug ||
          'dr-newton-mureb'
        )
          .trim()
          .toLowerCase();

        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          supaOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) supaOrgId = String(firstOrg.id);
        }
      }

      if (!supaOrgId) {
        return {
          template: prepared,
          syncedCloud: false,
          error: 'Organização ativa não localizada no Supabase (public.organizations).',
        };
      }

      let targetUuid: string | undefined = isUuid(prepared.id) ? prepared.id : undefined;

      if (!targetUuid) {
        const { data: byName } = await supabase
          .from('message_templates')
          .select('id')
          .eq('organization_id', supaOrgId)
          .eq('name', prepared.name.trim())
          .limit(1)
          .maybeSingle();

        if (byName?.id) {
          targetUuid = String(byName.id);
        } else if (prepared.category && prepared.category !== 'custom') {
          const { data: byCategory } = await supabase
            .from('message_templates')
            .select('id')
            .eq('organization_id', supaOrgId)
            .eq('category', prepared.category)
            .limit(1)
            .maybeSingle();
          if (byCategory?.id) {
            targetUuid = String(byCategory.id);
          }
        }
      }

      if (!targetUuid) {
        targetUuid = generateUuid();
      }

      const upsertPayload = {
        id: targetUuid,
        organization_id: supaOrgId,
        name: prepared.name.trim(),
        category: prepared.category || 'custom',
        channel: prepared.channel || 'whatsapp',
        content: prepared.content,
        variables: prepared.variables,
        is_active: prepared.isActive !== false,
        updated_at: nowIso,
      };

      let { data: upsertedRow, error: upsertErr } = await supabase
        .from('message_templates')
        .upsert(upsertPayload, { onConflict: 'id' })
        .select('*')
        .maybeSingle();

      // Fallback if remote table doesn't have updated_at migrated yet
      if (upsertErr && /updated_at/i.test(upsertErr.message)) {
        const { updated_at: _omitted, ...legacyPayload } = upsertPayload;
        const retry = await supabase
          .from('message_templates')
          .upsert(legacyPayload, { onConflict: 'id' })
          .select('*')
          .maybeSingle();
        upsertedRow = retry.data;
        upsertErr = retry.error;
      }

      if (upsertErr) {
        console.warn('Erro no upsert em public.message_templates:', upsertErr.message);
        return { template: prepared, syncedCloud: false, error: upsertErr.message };
      }

      const synced: MessageTemplate = {
        ...prepared,
        id: upsertedRow?.id ? String(upsertedRow.id) : targetUuid,
        organizationId: upsertedRow?.organization_id
          ? String(upsertedRow.organization_id)
          : supaOrgId,
        createdAt: upsertedRow?.created_at ? String(upsertedRow.created_at) : prepared.createdAt,
        updatedAt: upsertedRow?.updated_at ? String(upsertedRow.updated_at) : nowIso,
      };

      const updatedList = StorageService.getTemplates().map((t) =>
        t.id === prepared.id || t.id === synced.id ? synced : t
      );
      setStored(STORAGE_KEYS.TEMPLATES, updatedList);

      return { template: synced, syncedCloud: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar modelo na nuvem.';
      return { template: prepared, syncedCloud: false, error: msg };
    }
  },
  getMessages: (): MessageLog[] => getStored<MessageLog[]>(STORAGE_KEYS.MESSAGES, INITIAL_MESSAGES),
  sendMessage: (msg: Omit<MessageLog, 'id' | 'sentAt'>): MessageLog => {
    const fullMsg: MessageLog = {
      ...msg,
      id: `msg_${Date.now()}`,
      sentAt: new Date().toISOString(),
    };
    const list = StorageService.getMessages();
    list.unshift(fullMsg);
    setStored(STORAGE_KEYS.MESSAGES, list);

    StorageService.addAuditLog({
      action: `Envio de Mensagem WhatsApp (${fullMsg.status})`,
      entity: 'Comunicação',
      entityId: fullMsg.id,
      details: `Destinatário: ${fullMsg.patientName} (${fullMsg.recipientPhone})`,
    });

    return fullMsg;
  },
  sendMessageToCloud: async (
    msg: Omit<MessageLog, 'id' | 'sentAt'>
  ): Promise<{ message: MessageLog; syncedCloud: boolean; error?: string }> => {
    const localMsg = StorageService.sendMessage(msg);
    const supabase = getSupabase();
    if (!supabase) {
      return { message: localMsg, syncedCloud: false };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      let supaOrgId = isUuid(msg.organizationId) ? msg.organizationId : undefined;
      if (!supaOrgId) {
        const orgSlug = (StorageService.getOrganization().slug || 'dr-newton-mureb')
          .trim()
          .toLowerCase();
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          supaOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) supaOrgId = String(firstOrg.id);
        }
      }

      if (!supaOrgId) {
        return { message: localMsg, syncedCloud: false };
      }

      let supaBranchId: string | null = isUuid(msg.branchId) ? msg.branchId! : null;
      if (!supaBranchId) {
        const { data: brRow } = await supabase
          .from('branches')
          .select('id')
          .eq('organization_id', supaOrgId)
          .limit(1)
          .maybeSingle();
        if (brRow?.id) supaBranchId = String(brRow.id);
      }

      let supaPatientId: string | null = isUuid(msg.patientId) ? msg.patientId! : null;
      if (!supaPatientId && msg.patientId) {
        const localPatient = StorageService.getPatients().find((p) => p.id === msg.patientId);
        if (localPatient?.documentCpf) {
          const cleanCpf = localPatient.documentCpf.replace(/\D/g, '');
          const { data: patRow } = await supabase
            .from('patients')
            .select('id')
            .eq('organization_id', supaOrgId)
            .or(`document_cpf.eq.${localPatient.documentCpf},document_cpf.eq.${cleanCpf}`)
            .limit(1)
            .maybeSingle();
          if (patRow?.id) supaPatientId = String(patRow.id);
        }
      }

      const supaAppointmentId: string | null = isUuid(msg.appointmentId)
        ? msg.appointmentId!
        : null;

      const { data: insertedRow, error: insertErr } = await supabase
        .from('messages')
        .insert({
          organization_id: supaOrgId,
          branch_id: supaBranchId,
          patient_id: supaPatientId,
          appointment_id: supaAppointmentId,
          channel: msg.channel || 'whatsapp',
          recipient_phone: msg.recipientPhone,
          direction: msg.direction || 'outbound',
          content: msg.content,
          status: msg.status || 'sent',
          sent_at: localMsg.sentAt,
        })
        .select('id, sent_at')
        .maybeSingle();

      if (insertErr) {
        console.warn('Aviso ao salvar mensagem em public.messages:', insertErr.message);
        return { message: localMsg, syncedCloud: false, error: insertErr.message };
      }

      if (insertedRow?.id) {
        const syncedMsg: MessageLog = {
          ...localMsg,
          id: String(insertedRow.id),
          sentAt: insertedRow.sent_at ? String(insertedRow.sent_at) : localMsg.sentAt,
        };
        const currentList = StorageService.getMessages().map((item) =>
          item.id === localMsg.id ? syncedMsg : item
        );
        setStored(STORAGE_KEYS.MESSAGES, currentList);
        return { message: syncedMsg, syncedCloud: true };
      }

      return { message: localMsg, syncedCloud: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('Aviso ao persistir mensagem no Supabase:', errMsg);
      return { message: localMsg, syncedCloud: false, error: errMsg };
    }
  },
  fetchMessagesFromCloud: async (): Promise<MessageLog[]> => {
    const localList = StorageService.getMessages();
    const supabase = getSupabase();
    if (!supabase) return localList;

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*, patients(full_name)')
        .order('sent_at', { ascending: false })
        .limit(100);

      if (error || !data) {
        return localList;
      }

      const localPatients = StorageService.getPatients();
      const cloudMapped: MessageLog[] = (data as Array<Record<string, unknown>>).map((row) => {
        const joinedPat = row.patients as { full_name?: string } | null | undefined;
        const patientId = row.patient_id ? String(row.patient_id) : undefined;
        const recipientPhone = String(row.recipient_phone || '');
        const cleanRecipient = recipientPhone.replace(/\D/g, '');
        const matchedLocalPatient =
          localPatients.find((p) => p.id === patientId) ||
          localPatients.find((p) => {
            const pDigits = (p.whatsapp || p.phone).replace(/\D/g, '');
            return pDigits && cleanRecipient.endsWith(pDigits.slice(-8));
          });

        const rawStatus = String(row.status || 'delivered');
        const status: MessageLog['status'] =
          rawStatus === 'sent' || rawStatus === 'delivered' || rawStatus === 'read' || rawStatus === 'failed'
            ? rawStatus
            : 'delivered';

        return {
          id: String(row.id),
          organizationId: String(row.organization_id || 'org_mureb_01'),
          branchId: row.branch_id ? String(row.branch_id) : undefined,
          patientId,
          appointmentId: row.appointment_id ? String(row.appointment_id) : undefined,
          patientName: joinedPat?.full_name || matchedLocalPatient?.fullName || 'Paciente',
          recipientPhone,
          channel: (String(row.channel || 'whatsapp') as MessageLog['channel']),
          direction: (String(row.direction || 'outbound') as MessageLog['direction']),
          content: String(row.content || ''),
          status,
          sentAt: String(row.sent_at || row.created_at || new Date().toISOString()),
        };
      });

      const unsyncedLocal = localList.filter(
        (local) =>
          !isUuid(local.id) &&
          !cloudMapped.some(
            (cloud) =>
              cloud.content === local.content &&
              Math.abs(Date.parse(cloud.sentAt) - Date.parse(local.sentAt)) < 60000
          )
      );

      const merged = [...unsyncedLocal, ...cloudMapped].sort(
        (a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)
      );
      setStored(STORAGE_KEYS.MESSAGES, merged);
      return merged;
    } catch {
      return localList;
    }
  },

  // =========================================================================
  // Gerenciador Inteligente de Automações WhatsApp (Gatilhos & Execuções)
  // =========================================================================

  getAutomationTriggers: (): WhatsAppAutomationTrigger[] => {
    runDataMigrationIfNeeded();
    const legacyClinic = getStored<Clinic>(STORAGE_KEYS.CLINIC, INITIAL_CLINIC);
    const legacyFlags = legacyClinic.automationTriggers;

    const mapLegacySeed = (def: WhatsAppAutomationTrigger): WhatsAppAutomationTrigger => {
      if (!legacyFlags) return def;
      let status = def.status;
      if (def.triggerCode === 'immediate_confirmation') {
        status = legacyFlags.immediateConfirmation ? 'active' : 'paused';
      } else if (def.triggerCode === 'confirmation_48h') {
        status = legacyFlags.confirmation48h ? 'active' : 'paused';
      } else if (def.triggerCode === 'reminder_24h') {
        status = legacyFlags.reminder24h ? 'active' : 'paused';
      } else if (def.triggerCode === 'auto_reply_confirm') {
        status = legacyFlags.autoReplyConfirm ? 'active' : 'paused';
      } else if (def.triggerCode === 'post_care') {
        status = legacyFlags.postCare ? 'active' : 'paused';
      }
      return { ...def, status };
    };

    let stored: WhatsAppAutomationTrigger[] = [];
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEYS.AUTOMATION_TRIGGERS);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) stored = parsed as WhatsAppAutomationTrigger[];
        } catch {
          stored = [];
        }
      }
    }

    if (stored.length === 0) {
      const seeded = INITIAL_AUTOMATION_TRIGGERS.map(mapLegacySeed);
      setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, seeded);
      return seeded;
    }

    // Ensure all 10 baseline triggerCodes exist at least once without creating duplicates
    const existingCodes = new Set(
      stored.map((t) => t.triggerCode).filter((c): c is string => Boolean(c))
    );
    const existingIds = new Set(stored.map((t) => t.id));
    const missingSeeds = INITIAL_AUTOMATION_TRIGGERS.filter(
      (def) =>
        !existingIds.has(def.id) && (!def.triggerCode || !existingCodes.has(def.triggerCode))
    ).map(mapLegacySeed);

    if (missingSeeds.length > 0) {
      const merged = [...stored, ...missingSeeds];
      setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, merged);
      return merged;
    }

    return stored;
  },

  saveAutomationTriggerLocal: (trigger: WhatsAppAutomationTrigger): WhatsAppAutomationTrigger => {
    const list = StorageService.getAutomationTriggers();
    const nowIso = new Date().toISOString();
    const prepared: WhatsAppAutomationTrigger = {
      ...trigger,
      updatedAt: nowIso,
      createdAt: trigger.createdAt || nowIso,
    };

    const idx = list.findIndex((t) => t.id === prepared.id);
    if (idx >= 0) {
      list[idx] = prepared;
    } else {
      list.unshift(prepared);
    }
    setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, list);

    // Keep legacy Clinic.automationTriggers flags synced for backward compatibility
    if (prepared.triggerCode) {
      const clinic = StorageService.getClinic();
      const currentFlags: AutomationTriggerSettings = clinic.automationTriggers || {
        immediateConfirmation: true,
        confirmation48h: true,
        reminder24h: true,
        autoReplyConfirm: true,
        postCare: true,
      };
      const isEnabled = prepared.status === 'active';
      const nextFlags: AutomationTriggerSettings = { ...currentFlags };
      let changed = false;
      if (prepared.triggerCode === 'immediate_confirmation') {
        nextFlags.immediateConfirmation = isEnabled;
        changed = true;
      } else if (prepared.triggerCode === 'confirmation_48h') {
        nextFlags.confirmation48h = isEnabled;
        changed = true;
      } else if (prepared.triggerCode === 'reminder_24h') {
        nextFlags.reminder24h = isEnabled;
        changed = true;
      } else if (prepared.triggerCode === 'auto_reply_confirm') {
        nextFlags.autoReplyConfirm = isEnabled;
        changed = true;
      } else if (prepared.triggerCode === 'post_care') {
        nextFlags.postCare = isEnabled;
        changed = true;
      }
      if (changed) {
        StorageService.updateClinic({ automationTriggers: nextFlags });
      }
    }

    return prepared;
  },

  fetchAutomationTriggersFromCloud: async (tenantHints?: {
    organizationId?: string;
    clinicId?: string;
    slug?: string;
  }): Promise<{
    triggers: WhatsAppAutomationTrigger[];
    source: 'cloud' | 'local';
    error?: string;
  }> => {
    const localTriggers = StorageService.getAutomationTriggers();
    const supabase = getSupabase();
    if (!supabase) {
      return { triggers: localTriggers, source: 'local' };
    }

    const isUuid = (val?: string | null) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      let supaOrgId = isUuid(tenantHints?.organizationId)
        ? tenantHints?.organizationId
        : undefined;

      if (!supaOrgId) {
        const orgSlug = (
          tenantHints?.slug ||
          StorageService.getOrganization().slug ||
          'dr-newton-mureb'
        )
          .trim()
          .toLowerCase();
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          supaOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) supaOrgId = String(firstOrg.id);
        }
      }

      if (!supaOrgId) {
        return { triggers: localTriggers, source: 'local' };
      }

      const templates = StorageService.getTemplates();
      const mapRow = (row: Record<string, unknown>): WhatsAppAutomationTrigger => {
        const tplId = row.template_id ? String(row.template_id) : '';
        const tplCat = row.template_category
          ? (String(row.template_category) as MessageTemplate['category'])
          : undefined;
        const matchedTpl =
          templates.find((t) => t.id === tplId) ||
          (tplCat ? templates.find((t) => t.category === tplCat) : undefined);

        return {
          id: String(row.id),
          organizationId: String(row.organization_id || supaOrgId),
          clinicId: row.clinic_id ? String(row.clinic_id) : undefined,
          branchId: row.branch_id ? String(row.branch_id) : null,
          triggerCode: row.trigger_code ? String(row.trigger_code) : undefined,
          name: String(row.name || 'Gatilho sem nome'),
          description: String(row.description || ''),
          category: (row.category as WhatsAppAutomationTrigger['category']) || 'custom',
          eventType: (row.event_type as WhatsAppAutomationTrigger['eventType']) || 'custom',
          templateId: matchedTpl?.id || tplId,
          templateName: matchedTpl?.name,
          templateCategory: tplCat || matchedTpl?.category,
          status: (row.status as AutomationTriggerStatus) || 'active',
          totalSends: Number(row.total_sends || 1),
          intervalValue: Number(row.interval_value ?? 24),
          intervalUnit: (row.interval_unit as WhatsAppAutomationTrigger['intervalUnit']) || 'hours',
          maxDurationDays: Number(row.max_duration_days ?? 7),
          scheduleMode: (row.schedule_mode as WhatsAppAutomationTrigger['scheduleMode']) || 'relative',
          leadTimeValue: Number(row.lead_time_value ?? 0),
          leadTimeUnit: (row.lead_time_unit as WhatsAppAutomationTrigger['leadTimeUnit']) || 'hours',
          preferredSendTime: String(row.preferred_send_time || '09:00'),
          allowedDays: Array.isArray(row.allowed_days)
            ? (row.allowed_days as WhatsAppAutomationTrigger['allowedDays'])
            : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
          windowStart: String(row.window_start || '08:00'),
          windowEnd: String(row.window_end || '20:00'),
          timezone: String(row.timezone || 'America/Sao_Paulo'),
          outsideWindowPolicy:
            (row.outside_window_policy as WhatsAppAutomationTrigger['outsideWindowPolicy']) ||
            'next_allowed_window',
          smartRules:
            row.smart_rules && typeof row.smart_rules === 'object'
              ? {
                  requireValidPhone: true,
                  skipCancelledAppointments: true,
                  stopOnAppointmentCancel: true,
                  stopOnAppointmentConfirm: false,
                  respectAppointmentStatus: true,
                  respectOriginBranch: true,
                  respectOrganizationIsolation: true,
                  minIntervalMinutesPerPatient: 120,
                  dailyLimitPerPatient: 3,
                  retryOnFailure: true,
                  maxRetries: 3,
                  preventDuplicates: true,
                  ...(row.smart_rules as Partial<WhatsAppAutomationTrigger['smartRules']>),
                }
              : INITIAL_AUTOMATION_TRIGGERS[0].smartRules,
          stepSchedule: Array.isArray(row.step_schedule)
            ? (row.step_schedule as WhatsAppAutomationTrigger['stepSchedule'])
            : [],
          createdAt: String(row.created_at || new Date().toISOString()),
          updatedAt: String(row.updated_at || new Date().toISOString()),
        };
      };

      const { data, error } = await supabase
        .from('whatsapp_automation_triggers')
        .select('*')
        .eq('organization_id', supaOrgId)
        .order('created_at', { ascending: true });

      if (error) {
        return { triggers: localTriggers, source: 'local', error: error.message };
      }

      if (data && data.length > 0) {
        const mapped = (data as Array<Record<string, unknown>>).map(mapRow);
        setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, mapped);
        return { triggers: mapped, source: 'cloud' };
      }

      // First cloud sync for this org: resolve template UUIDs + clinic UUID and seed initial triggers
      const { data: cloudTemplates } = await supabase
        .from('message_templates')
        .select('id, category, name')
        .eq('organization_id', supaOrgId);
      const { data: clinicRow } = await supabase
        .from('clinics')
        .select('id')
        .eq('organization_id', supaOrgId)
        .limit(1)
        .maybeSingle();

      const cloudTplList = (cloudTemplates || []) as Array<{
        id: string;
        category?: string;
        name?: string;
      }>;

      const seedRows = localTriggers.map((trig) => {
        const matchedCloudTpl =
          cloudTplList.find((ct) => ct.id === trig.templateId) ||
          cloudTplList.find((ct) => ct.category === trig.templateCategory) ||
          cloudTplList.find((ct) => ct.name === trig.templateName);

        return {
          organization_id: supaOrgId,
          clinic_id: clinicRow?.id || null,
          branch_id: isUuid(trig.branchId) ? trig.branchId : null,
          trigger_code: trig.triggerCode || null,
          name: trig.name,
          description: trig.description || null,
          category: trig.category,
          event_type: trig.eventType,
          template_id: matchedCloudTpl?.id || null,
          template_category: trig.templateCategory || null,
          status: trig.status,
          total_sends: trig.totalSends,
          interval_value: trig.intervalValue,
          interval_unit: trig.intervalUnit,
          max_duration_days: trig.maxDurationDays,
          schedule_mode: trig.scheduleMode,
          lead_time_value: trig.leadTimeValue,
          lead_time_unit: trig.leadTimeUnit,
          preferred_send_time: trig.preferredSendTime,
          allowed_days: trig.allowedDays,
          window_start: trig.windowStart,
          window_end: trig.windowEnd,
          timezone: trig.timezone || 'America/Sao_Paulo',
          outside_window_policy: trig.outsideWindowPolicy,
          smart_rules: trig.smartRules,
          step_schedule: trig.stepSchedule || [],
        };
      });

      const { data: insertedRows, error: seedErr } = await supabase
        .from('whatsapp_automation_triggers')
        .insert(seedRows)
        .select('*');

      if (!seedErr && insertedRows && insertedRows.length > 0) {
        const mappedSeed = (insertedRows as Array<Record<string, unknown>>).map(mapRow);
        setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, mappedSeed);
        return { triggers: mappedSeed, source: 'cloud' };
      }

      return {
        triggers: localTriggers,
        source: 'local',
        error: seedErr?.message,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { triggers: localTriggers, source: 'local', error: msg };
    }
  },

  saveAutomationTriggerToCloud: async (
    trigger: WhatsAppAutomationTrigger,
    tenantHints?: { organizationId?: string; clinicId?: string; slug?: string }
  ): Promise<{ trigger: WhatsAppAutomationTrigger; syncedCloud: boolean; error?: string }> => {
    const savedLocal = StorageService.saveAutomationTriggerLocal(trigger);
    StorageService.addAuditLog({
      action: 'Salvou Gatilho de Automação WhatsApp',
      entity: 'Comunicação',
      entityId: savedLocal.id,
      details: `Gatilho "${savedLocal.name}" (${savedLocal.status})`,
    });

    const supabase = getSupabase();
    if (!supabase) {
      return { trigger: savedLocal, syncedCloud: false };
    }

    const isUuid = (val?: string | null) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    const generateUuid = (): string => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    try {
      let supaOrgId = isUuid(tenantHints?.organizationId)
        ? tenantHints?.organizationId
        : isUuid(savedLocal.organizationId)
          ? savedLocal.organizationId
          : undefined;

      if (!supaOrgId) {
        const orgSlug = (
          tenantHints?.slug ||
          StorageService.getOrganization().slug ||
          'dr-newton-mureb'
        )
          .trim()
          .toLowerCase();
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          supaOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) supaOrgId = String(firstOrg.id);
        }
      }

      if (!supaOrgId) {
        return { trigger: savedLocal, syncedCloud: false };
      }

      let supaClinicId: string | null = isUuid(tenantHints?.clinicId)
        ? tenantHints!.clinicId!
        : isUuid(savedLocal.clinicId)
          ? savedLocal.clinicId!
          : null;
      if (!supaClinicId) {
        const { data: cRow } = await supabase
          .from('clinics')
          .select('id')
          .eq('organization_id', supaOrgId)
          .limit(1)
          .maybeSingle();
        if (cRow?.id) supaClinicId = String(cRow.id);
      }

      let supaTemplateId: string | null = isUuid(savedLocal.templateId)
        ? savedLocal.templateId
        : null;
      if (!supaTemplateId) {
        const { data: tRows } = await supabase
          .from('message_templates')
          .select('id, category, name')
          .eq('organization_id', supaOrgId);
        const listT = (tRows || []) as Array<{ id: string; category?: string; name?: string }>;
        const matchT =
          listT.find((t) => t.name === savedLocal.templateName) ||
          (savedLocal.templateCategory
            ? listT.find((t) => t.category === savedLocal.templateCategory)
            : undefined);
        if (matchT?.id) supaTemplateId = matchT.id;
      }

      let targetUuid = isUuid(savedLocal.id) ? savedLocal.id : undefined;
      if (!targetUuid && savedLocal.triggerCode) {
        const { data: existingByCode } = await supabase
          .from('whatsapp_automation_triggers')
          .select('id')
          .eq('organization_id', supaOrgId)
          .eq('trigger_code', savedLocal.triggerCode)
          .limit(1)
          .maybeSingle();
        if (existingByCode?.id) targetUuid = String(existingByCode.id);
      }
      if (!targetUuid) targetUuid = generateUuid();

      const upsertPayload = {
        id: targetUuid,
        organization_id: supaOrgId,
        clinic_id: supaClinicId,
        branch_id: isUuid(savedLocal.branchId) ? savedLocal.branchId : null,
        trigger_code: savedLocal.triggerCode || null,
        name: savedLocal.name.trim(),
        description: savedLocal.description || null,
        category: savedLocal.category,
        event_type: savedLocal.eventType,
        template_id: supaTemplateId,
        template_category: savedLocal.templateCategory || null,
        status: savedLocal.status,
        total_sends: savedLocal.totalSends,
        interval_value: savedLocal.intervalValue,
        interval_unit: savedLocal.intervalUnit,
        max_duration_days: savedLocal.maxDurationDays,
        schedule_mode: savedLocal.scheduleMode,
        lead_time_value: savedLocal.leadTimeValue,
        lead_time_unit: savedLocal.leadTimeUnit,
        preferred_send_time: savedLocal.preferredSendTime,
        allowed_days: savedLocal.allowedDays,
        window_start: savedLocal.windowStart,
        window_end: savedLocal.windowEnd,
        timezone: savedLocal.timezone || 'America/Sao_Paulo',
        outside_window_policy: savedLocal.outsideWindowPolicy,
        smart_rules: savedLocal.smartRules,
        step_schedule: savedLocal.stepSchedule || [],
        updated_at: savedLocal.updatedAt,
      };

      const { data: upsertedRow, error: upsertErr } = await supabase
        .from('whatsapp_automation_triggers')
        .upsert(upsertPayload, { onConflict: 'id' })
        .select('*')
        .maybeSingle();

      if (upsertErr) {
        return { trigger: savedLocal, syncedCloud: false, error: upsertErr.message };
      }

      const synced: WhatsAppAutomationTrigger = {
        ...savedLocal,
        id: upsertedRow?.id ? String(upsertedRow.id) : targetUuid,
        organizationId: upsertedRow?.organization_id
          ? String(upsertedRow.organization_id)
          : supaOrgId,
        clinicId: supaClinicId || savedLocal.clinicId,
      };

      const updatedList = StorageService.getAutomationTriggers().map((item) =>
        item.id === savedLocal.id || item.id === synced.id ? synced : item
      );
      setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, updatedList);
      return { trigger: synced, syncedCloud: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { trigger: savedLocal, syncedCloud: false, error: msg };
    }
  },

  toggleAutomationTriggerStatusInCloud: async (
    triggerId: string,
    nextStatus: AutomationTriggerStatus,
    tenantHints?: { organizationId?: string; clinicId?: string; slug?: string }
  ): Promise<{ trigger?: WhatsAppAutomationTrigger; syncedCloud: boolean; error?: string }> => {
    const existing = StorageService.getAutomationTriggers().find((t) => t.id === triggerId);
    if (!existing) return { syncedCloud: false, error: 'Gatilho não encontrado.' };
    const updated: WhatsAppAutomationTrigger = {
      ...existing,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };
    return StorageService.saveAutomationTriggerToCloud(updated, tenantHints);
  },

  duplicateAutomationTriggerToCloud: async (
    triggerId: string,
    tenantHints?: { organizationId?: string; clinicId?: string; slug?: string }
  ): Promise<{ trigger?: WhatsAppAutomationTrigger; syncedCloud: boolean; error?: string }> => {
    const existing = StorageService.getAutomationTriggers().find((t) => t.id === triggerId);
    if (!existing) return { syncedCloud: false, error: 'Gatilho não encontrado.' };

    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `trig_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const cloned: WhatsAppAutomationTrigger = {
      ...existing,
      id: newId,
      triggerCode: undefined,
      name: `${existing.name} (Cópia)`,
      status: 'draft',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    return StorageService.saveAutomationTriggerToCloud(cloned, tenantHints);
  },

  deleteAutomationTriggerFromCloud: async (
    triggerId: string
  ): Promise<{ success: boolean; syncedCloud: boolean; error?: string }> => {
    const list = StorageService.getAutomationTriggers().filter((t) => t.id !== triggerId);
    setStored(STORAGE_KEYS.AUTOMATION_TRIGGERS, list);
    StorageService.addAuditLog({
      action: 'Excluiu Gatilho de Automação WhatsApp',
      entity: 'Comunicação',
      entityId: triggerId,
      details: `Gatilho removido (${triggerId})`,
    });

    const supabase = getSupabase();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(triggerId);
    if (!supabase || !isUuid) {
      return { success: true, syncedCloud: false };
    }

    try {
      const { error } = await supabase
        .from('whatsapp_automation_triggers')
        .delete()
        .eq('id', triggerId);
      if (error) {
        return { success: true, syncedCloud: false, error: error.message };
      }
      return { success: true, syncedCloud: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: true, syncedCloud: false, error: msg };
    }
  },

  getAutomationExecutions: (): AutomationExecutionRecord[] => {
    runDataMigrationIfNeeded();
    return getStored<AutomationExecutionRecord[]>(
      STORAGE_KEYS.AUTOMATION_EXECUTIONS,
      INITIAL_AUTOMATION_EXECUTIONS
    );
  },

  fetchAutomationExecutionsFromCloud: async (tenantHints?: {
    organizationId?: string;
    slug?: string;
  }): Promise<{
    executions: AutomationExecutionRecord[];
    source: 'cloud' | 'local';
    error?: string;
  }> => {
    const localExecutions = StorageService.getAutomationExecutions();
    const supabase = getSupabase();
    if (!supabase) {
      return { executions: localExecutions, source: 'local' };
    }

    const isUuid = (val?: string | null) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      let supaOrgId = isUuid(tenantHints?.organizationId)
        ? tenantHints?.organizationId
        : undefined;
      if (!supaOrgId) {
        const orgSlug = (
          tenantHints?.slug ||
          StorageService.getOrganization().slug ||
          'dr-newton-mureb'
        )
          .trim()
          .toLowerCase();
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          supaOrgId = String(orgRow.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) supaOrgId = String(firstOrg.id);
        }
      }

      if (!supaOrgId) {
        return { executions: localExecutions, source: 'local' };
      }

      const { data, error } = await supabase
        .from('whatsapp_automation_executions')
        .select('*')
        .eq('organization_id', supaOrgId)
        .order('scheduled_for', { ascending: false })
        .limit(200);

      if (error || !data) {
        return { executions: localExecutions, source: 'local', error: error?.message };
      }

      if (data.length === 0) {
        return { executions: localExecutions, source: 'local' };
      }

      const triggers = StorageService.getAutomationTriggers();
      const branches = StorageService.getBranches();

      const mapped: AutomationExecutionRecord[] = (data as Array<Record<string, unknown>>).map(
        (row) => {
          const trigId = String(row.trigger_id || '');
          const matchedTrig = triggers.find((t) => t.id === trigId);
          const brId = row.branch_id ? String(row.branch_id) : null;
          const matchedBr = brId ? branches.find((b) => b.id === brId) : undefined;

          return {
            id: String(row.id),
            organizationId: String(row.organization_id || supaOrgId),
            branchId: brId,
            branchName: matchedBr?.name,
            triggerId: trigId,
            triggerName: matchedTrig?.name || 'Automação WhatsApp',
            patientId: row.patient_id ? String(row.patient_id) : null,
            patientName: String(row.patient_name || 'Paciente'),
            patientPhone: String(row.patient_phone || ''),
            appointmentId: row.appointment_id ? String(row.appointment_id) : null,
            stepNumber: Number(row.step_number || 1),
            totalSteps: matchedTrig?.totalSends,
            scheduledFor: String(row.scheduled_for || new Date().toISOString()),
            executedAt: row.executed_at ? String(row.executed_at) : undefined,
            status: (row.status as AutomationExecutionRecord['status']) || 'pending',
            renderedMessage: row.rendered_message ? String(row.rendered_message) : undefined,
            externalMessageId: row.external_message_id
              ? String(row.external_message_id)
              : undefined,
            attemptCount: Number(row.attempt_count || 0),
            maxAttempts: Number(row.max_attempts || 3),
            errorMessage: row.error_message ? String(row.error_message) : undefined,
            idempotencyKey: String(row.idempotency_key || row.id),
            createdAt: String(row.created_at || new Date().toISOString()),
            updatedAt: String(row.updated_at || new Date().toISOString()),
          };
        }
      );

      setStored(STORAGE_KEYS.AUTOMATION_EXECUTIONS, mapped);
      return { executions: mapped, source: 'cloud' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { executions: localExecutions, source: 'local', error: msg };
    }
  },

  retryAutomationExecutionInCloud: async (
    executionId: string
  ): Promise<{
    execution?: AutomationExecutionRecord;
    syncedCloud: boolean;
    error?: string;
  }> => {
    const list = StorageService.getAutomationExecutions();
    const target = list.find((e) => e.id === executionId);
    if (!target) {
      return { syncedCloud: false, error: 'Registro de envio não encontrado.' };
    }
    if (target.attemptCount >= target.maxAttempts) {
      return {
        execution: target,
        syncedCloud: false,
        error: `Limite máximo de ${target.maxAttempts} tentativas atingido para este envio.`,
      };
    }

    const nowIso = new Date().toISOString();
    // Preserves exact idempotencyKey so re-enqueueing NEVER creates duplicate dispatches
    const updated: AutomationExecutionRecord = {
      ...target,
      status: 'pending',
      scheduledFor: nowIso,
      errorMessage: undefined,
      updatedAt: nowIso,
    };

    const nextList = list.map((item) => (item.id === executionId ? updated : item));
    setStored(STORAGE_KEYS.AUTOMATION_EXECUTIONS, nextList);

    StorageService.addAuditLog({
      action: 'Reprocessou Envio de Automação WhatsApp',
      entity: 'Comunicação',
      entityId: updated.id,
      details: `Reprogramado envio para ${updated.patientName} (chave ${updated.idempotencyKey})`,
    });

    const supabase = getSupabase();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(executionId);
    if (!supabase || !isUuid) {
      return { execution: updated, syncedCloud: false };
    }

    try {
      const { error } = await supabase
        .from('whatsapp_automation_executions')
        .update({
          status: 'pending',
          scheduled_for: nowIso,
          error_message: null,
          updated_at: nowIso,
        })
        .eq('id', executionId)
        .eq('idempotency_key', target.idempotencyKey);

      if (error) {
        return { execution: updated, syncedCloud: false, error: error.message };
      }
      return { execution: updated, syncedCloud: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { execution: updated, syncedCloud: false, error: msg };
    }
  },

  // Financial Transactions
  getFinancial: (branchFilterId?: string): FinancialTransaction[] => {
    const list = getStored<FinancialTransaction[]>(STORAGE_KEYS.FINANCIAL, INITIAL_FINANCIAL);
    if (!branchFilterId || branchFilterId === 'all') return list;
    return list.filter(f => f.branchId === branchFilterId);
  },
  saveFinancialTransaction: (tx: FinancialTransaction): void => {
    const list = getStored<FinancialTransaction[]>(STORAGE_KEYS.FINANCIAL, INITIAL_FINANCIAL);
    const index = list.findIndex(f => f.id === tx.id);
    if (index >= 0) {
      list[index] = tx;
    } else {
      list.unshift(tx);
    }
    setStored(STORAGE_KEYS.FINANCIAL, list);

    StorageService.addAuditLog({
      action: index >= 0 ? 'Atualizou Lançamento Financeiro' : 'Novo Recebimento Registrado',
      entity: 'Financeiro',
      entityId: tx.id,
      details: `${tx.description} - R$ ${tx.amount.toFixed(2)} (${tx.paymentMethod})`,
    });
  },

  // Website Config (localStorage + Supabase public.websites persistence)
  getWebsite: (): WebsiteConfig => getStored<WebsiteConfig>(STORAGE_KEYS.WEBSITE, INITIAL_WEBSITE),
  updateWebsite: (updates: Partial<WebsiteConfig>): WebsiteConfig => {
    const site = { ...StorageService.getWebsite(), ...updates };
    setStored(STORAGE_KEYS.WEBSITE, site);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('medsync-website-updated', { detail: site }));
    }
    return site;
  },
  fetchWebsiteFromCloud: async (params?: {
    customDomain?: string;
    slug?: string;
    organizationId?: string;
  }): Promise<{ website: WebsiteConfig; clinic?: Clinic; source: 'cloud' | 'local' }> => {
    const localSite = StorageService.getWebsite();
    const localClinic = StorageService.getClinic();
    const supabase = getSupabase();
    if (!supabase) {
      return { website: localSite, clinic: localClinic, source: 'local' };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    const mapRow = (row: Record<string, unknown>): WebsiteConfig => {
      const validPalettes: ColorPalette[] = [
        'azul-clinico',
        'verde-saude',
        'elegancia',
        'minimalista',
        'natural',
      ];
      const rawPalette = String(row.palette_name || localSite.paletteName) as ColorPalette;
      const paletteName = validPalettes.includes(rawPalette)
        ? rawPalette
        : localSite.paletteName;

      return {
        id: String(row.id || localSite.id),
        organizationId: String(row.organization_id || localSite.organizationId),
        clinicId: String(row.clinic_id || localSite.clinicId),
        slug: String(row.slug || localSite.slug),
        customDomain: row.custom_domain ? String(row.custom_domain) : localSite.customDomain,
        title: row.title ? String(row.title) : localSite.title,
        tagline: row.tagline != null && String(row.tagline).trim() !== '' ? String(row.tagline) : localSite.tagline,
        paletteName,
        heroHeadline:
          row.hero_headline != null && String(row.hero_headline).trim() !== ''
            ? String(row.hero_headline)
            : localSite.heroHeadline,
        heroSubheadline:
          row.hero_subheadline != null && String(row.hero_subheadline).trim() !== ''
            ? String(row.hero_subheadline)
            : localSite.heroSubheadline,
        aboutText:
          row.about_text != null && String(row.about_text).trim() !== ''
            ? String(row.about_text)
            : localSite.aboutText,
        medicalApproach:
          row.medical_approach != null && String(row.medical_approach).trim() !== ''
            ? String(row.medical_approach)
            : localSite.medicalApproach,
        onlineBookingEnabled:
          typeof row.online_booking_enabled === 'boolean'
            ? row.online_booking_enabled
            : localSite.onlineBookingEnabled,
        contactPhone:
          row.contact_phone != null && String(row.contact_phone).trim() !== ''
            ? String(row.contact_phone)
            : localSite.contactPhone,
        contactWhatsapp:
          row.contact_whatsapp != null && String(row.contact_whatsapp).trim() !== ''
            ? String(row.contact_whatsapp)
            : localSite.contactWhatsapp,
        contactEmail:
          row.contact_email != null && String(row.contact_email).trim() !== ''
            ? String(row.contact_email)
            : localSite.contactEmail,
        isPublished:
          typeof row.is_published === 'boolean' ? row.is_published : localSite.isPublished,
      };
    };

    try {
      let row: Record<string, unknown> | null = null;
      const targetDomain = (params?.customDomain || localSite.customDomain || '')
        .trim()
        .toLowerCase();
      const targetSlug = (params?.slug || localSite.slug || '').trim().toLowerCase();
      const targetOrgId = isUuid(params?.organizationId) ? params?.organizationId : undefined;

      // 1. Direct lookup on public.websites by custom_domain
      if (targetDomain) {
        const bareDomain = targetDomain.replace(/^www\./, '');
        const domainCandidates = Array.from(
          new Set([targetDomain, bareDomain, `www.${bareDomain}`])
        );
        const { data: domRow } = await supabase
          .from('websites')
          .select('*')
          .in('custom_domain', domainCandidates)
          .limit(1)
          .maybeSingle();
        if (domRow) {
          row = domRow as Record<string, unknown>;
        }

        // 2. Fallback via public.clinic_domains -> clinic_id / organization_id -> public.websites
        if (!row) {
          const { data: clinicDomRow } = await supabase
            .from('clinic_domains')
            .select('clinic_id, organization_id')
            .in('domain', domainCandidates)
            .limit(1)
            .maybeSingle();

          if (clinicDomRow?.clinic_id) {
            const { data: siteByClinic } = await supabase
              .from('websites')
              .select('*')
              .eq('clinic_id', clinicDomRow.clinic_id)
              .limit(1)
              .maybeSingle();
            if (siteByClinic) row = siteByClinic as Record<string, unknown>;
          }

          if (!row && clinicDomRow?.organization_id) {
            const { data: siteByOrg } = await supabase
              .from('websites')
              .select('*')
              .eq('organization_id', clinicDomRow.organization_id)
              .limit(1)
              .maybeSingle();
            if (siteByOrg) row = siteByOrg as Record<string, unknown>;
          }
        }
      }

      // 3. Lookup by slug
      if (!row && targetSlug) {
        const { data: slugRow } = await supabase
          .from('websites')
          .select('*')
          .eq('slug', targetSlug)
          .limit(1)
          .maybeSingle();
        if (slugRow) {
          row = slugRow as Record<string, unknown>;
        }
      }

      // 4. Lookup by organization_id
      if (!row && targetOrgId) {
        const { data: orgSiteRow } = await supabase
          .from('websites')
          .select('*')
          .eq('organization_id', targetOrgId)
          .limit(1)
          .maybeSingle();
        if (orgSiteRow) {
          row = orgSiteRow as Record<string, unknown>;
        }
      }

      // 5. Latest published website fallback
      if (!row) {
        const { data: anyRow } = await supabase
          .from('websites')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (anyRow) {
          row = anyRow as Record<string, unknown>;
        }
      }

      const clinicLookup = await StorageService.fetchClinicFromCloud({
        clinicId: row?.clinic_id ? String(row.clinic_id) : undefined,
        organizationId: row?.organization_id
          ? String(row.organization_id)
          : targetOrgId,
        customDomain: targetDomain,
        slug: targetSlug,
      });

      if (row) {
        const mapped = mapRow(row);
        setStored(STORAGE_KEYS.WEBSITE, mapped);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('medsync-website-updated', { detail: mapped }));
        }
        return { website: mapped, clinic: clinicLookup.clinic, source: 'cloud' };
      }

      return {
        website: localSite,
        clinic: clinicLookup.clinic,
        source: clinicLookup.source,
      };
    } catch (err) {
      console.warn('Aviso ao carregar configurações do site institucional:', err);
      return { website: localSite, clinic: localClinic, source: 'local' };
    }
  },
  saveWebsiteToCloud: async (
    updates: Partial<WebsiteConfig>
  ): Promise<{ success: boolean; website: WebsiteConfig; syncedCloud: boolean; error?: string }> => {
    const merged = StorageService.updateWebsite(updates);

    StorageService.addAuditLog({
      action: 'Publicou Site Institucional',
      entity: 'Site Institucional',
      entityId: merged.id,
      details: `Atualizou identidade visual (${merged.paletteName}) e textos de ${merged.title}`,
    });

    const supabase = getSupabase();
    if (!supabase) {
      return { success: true, website: merged, syncedCloud: false };
    }

    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    try {
      const resolvedSlug = (merged.slug || StorageService.getOrganization().slug || 'dr-newton-mureb')
        .trim()
        .toLowerCase();

      let orgId = isUuid(merged.organizationId) ? merged.organizationId : undefined;
      if (!orgId) {
        const { data: orgBySlug } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', resolvedSlug)
          .limit(1)
          .maybeSingle();
        if (orgBySlug?.id) {
          orgId = String(orgBySlug.id);
        } else {
          const { data: firstOrg } = await supabase
            .from('organizations')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstOrg?.id) orgId = String(firstOrg.id);
        }
      }

      let clinicId = isUuid(merged.clinicId) ? merged.clinicId : undefined;
      if (!clinicId && orgId) {
        const { data: clinicRow } = await supabase
          .from('clinics')
          .select('id')
          .eq('organization_id', orgId)
          .limit(1)
          .maybeSingle();
        if (clinicRow?.id) clinicId = String(clinicRow.id);
      }
      if (!clinicId) {
        const { data: firstClinic } = await supabase
          .from('clinics')
          .select('id, organization_id')
          .limit(1)
          .maybeSingle();
        if (firstClinic?.id) {
          clinicId = String(firstClinic.id);
          if (!orgId && firstClinic.organization_id) {
            orgId = String(firstClinic.organization_id);
          }
        }
      }

      if (!orgId || !clinicId) {
        return { success: true, website: merged, syncedCloud: false };
      }

      const dbPayload: Record<string, unknown> = {
        organization_id: orgId,
        clinic_id: clinicId,
        slug: resolvedSlug,
        custom_domain: merged.customDomain || null,
        title: merged.title,
        tagline: merged.tagline || null,
        palette_name: merged.paletteName,
        hero_headline: merged.heroHeadline || null,
        hero_subheadline: merged.heroSubheadline || null,
        about_text: merged.aboutText || null,
        medical_approach: merged.medicalApproach || null,
        online_booking_enabled: Boolean(merged.onlineBookingEnabled),
        contact_phone: merged.contactPhone || null,
        contact_whatsapp: merged.contactWhatsapp || null,
        contact_email: merged.contactEmail || null,
        is_published: merged.isPublished !== false,
        updated_at: new Date().toISOString(),
      };

      if (isUuid(merged.id)) {
        dbPayload.id = merged.id;
      }

      let savedRow: Record<string, unknown> | null = null;

      const { data: upserted, error: upsertErr } = await supabase
        .from('websites')
        .upsert(dbPayload, { onConflict: 'slug' })
        .select('*')
        .maybeSingle();

      if (!upsertErr && upserted) {
        savedRow = upserted as Record<string, unknown>;
      } else {
        // Fallback: check if record already exists by clinic_id or slug and update explicitly
        const { data: existingRow } = await supabase
          .from('websites')
          .select('id')
          .or(`slug.eq.${resolvedSlug},clinic_id.eq.${clinicId}`)
          .limit(1)
          .maybeSingle();

        if (existingRow?.id) {
          const { data: updatedRow, error: updateErr } = await supabase
            .from('websites')
            .update(dbPayload)
            .eq('id', existingRow.id)
            .select('*')
            .maybeSingle();
          if (!updateErr && updatedRow) {
            savedRow = updatedRow as Record<string, unknown>;
          } else if (updateErr) {
            console.warn('Erro ao atualizar public.websites:', updateErr.message);
            return { success: true, website: merged, syncedCloud: false, error: updateErr.message };
          }
        } else if (upsertErr) {
          console.warn('Erro ao fazer upsert em public.websites:', upsertErr.message);
          return { success: true, website: merged, syncedCloud: false, error: upsertErr.message };
        }
      }

      if (savedRow) {
        const syncedWebsite: WebsiteConfig = {
          ...merged,
          id: String(savedRow.id || merged.id),
          organizationId: String(savedRow.organization_id || orgId),
          clinicId: String(savedRow.clinic_id || clinicId),
          slug: String(savedRow.slug || resolvedSlug),
        };
        setStored(STORAGE_KEYS.WEBSITE, syncedWebsite);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('medsync-website-updated', { detail: syncedWebsite })
          );
        }
        return { success: true, website: syncedWebsite, syncedCloud: true };
      }

      return { success: true, website: merged, syncedCloud: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Aviso ao sincronizar site institucional na nuvem:', msg);
      return { success: true, website: merged, syncedCloud: false, error: msg };
    }
  },

  // Audit Logs
  getAuditLogs: (): AuditLog[] => getStored<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS),
  addAuditLog: (entry: { action: string; entity: string; entityId?: string; details: string }): void => {
    const currentUsers = StorageService.getUsers();
    const activeUserId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID) : null;
    const currentUser =
      currentUsers.find(u => u.id === activeUserId) ||
      currentUsers.find(u => u.id === 'usr_doctor_newton') ||
      currentUsers[0]; // Default Dr. Newton Mureb

    const log: AuditLog = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      organizationId: 'org_mureb_01',
      userId: currentUser.id,
      userName: currentUser.fullName,
      userRole: currentUser.role,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      details: entry.details,
      timestamp: new Date().toISOString(),
    };

    const list = StorageService.getAuditLogs();
    list.unshift(log);
    setStored(STORAGE_KEYS.AUDIT_LOGS, list.slice(0, 100)); // Keep latest 100
  },

  // Active Branch Preference
  getActiveBranchId: (): string => {
    if (typeof window === 'undefined') return 'all';
    runDataMigrationIfNeeded();
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_BRANCH_ID) || 'all';
  },
  setActiveBranchId: (id: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_BRANCH_ID, id);
    window.dispatchEvent(new Event('medsync_storage_update'));
  },

  // Active User / Role Switcher for Testing
  getActiveUserId: (): string => {
    if (typeof window === 'undefined') return 'usr_doctor_newton';
    runDataMigrationIfNeeded();
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID) || 'usr_doctor_newton';
  },
  setActiveUserId: (id: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, id);
    window.dispatchEvent(new Event('medsync_storage_update'));
  },

  // Clinic Custom Domains (Multi-tenant Architecture)
  getClinicDomains: (): ClinicDomain[] => getStored<ClinicDomain[]>(STORAGE_KEYS.CLINIC_DOMAINS, INITIAL_CLINIC_DOMAINS),
  
  saveClinicDomain: (domain: ClinicDomain): { success: boolean; error?: string } => {
    const list = StorageService.getClinicDomains();
    const cleanDomain = domain.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    
    // Validate uniqueness of domain name
    const existingDomainName = list.find(d => d.domain.toLowerCase() === cleanDomain && d.id !== domain.id);
    if (existingDomainName) {
      return { success: false, error: `O domínio "${cleanDomain}" já está em uso por outra clínica ou ambiente.` };
    }

    // Validate only one domain per (clinic_id, canonical domain_type), allowing multiple website/apex aliases
    const normalizeDomainCat = (t: ClinicDomain['domainType']) => {
      if (t === 'app' || t === 'clinic_app') return 'app';
      if (t === 'booking' || t === 'clinic_booking') return 'booking';
      return 'website';
    };
    const targetCat = normalizeDomainCat(domain.domainType);
    const existingType = list.find(
      d =>
        d.clinicId === domain.clinicId &&
        normalizeDomainCat(d.domainType) === targetCat &&
        d.id !== domain.id &&
        targetCat !== 'website'
    );
    if (existingType) {
      const catLabel =
        targetCat === 'app'
          ? 'Painel do Sistema'
          : targetCat === 'booking'
            ? 'Agenda Online (n8n)'
            : 'Site Institucional';
      return {
        success: false,
        error: `A clínica já possui um domínio configurado para o tipo ${catLabel}. Remova ou edite o existente.`,
      };
    }

    const domainToSave: ClinicDomain = {
      ...domain,
      domain: cleanDomain,
      updatedAt: new Date().toISOString()
    };

    const index = list.findIndex(d => d.id === domainToSave.id);
    if (index >= 0) {
      list[index] = domainToSave;
    } else {
      list.push(domainToSave);
    }

    setStored(STORAGE_KEYS.CLINIC_DOMAINS, list);
    return { success: true };
  },

  deleteClinicDomain: (id: string): void => {
    const list = StorageService.getClinicDomains().filter(d => d.id !== id);
    setStored(STORAGE_KEYS.CLINIC_DOMAINS, list);
  },

  toggleDomainActive: (id: string): void => {
    const list = StorageService.getClinicDomains();
    const index = list.findIndex(d => d.id === id);
    if (index >= 0) {
      list[index].isActive = !list[index].isActive;
      list[index].updatedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.CLINIC_DOMAINS, list);
    }
  },

  verifyDomainDns: (id: string): { success: boolean; message: string } => {
    const list = StorageService.getClinicDomains();
    const index = list.findIndex(d => d.id === id);
    if (index >= 0) {
      list[index].dnsStatus = 'verified';
      list[index].isVerified = true;
      list[index].sslStatus = 'active';
      list[index].verifiedAt = new Date().toISOString();
      list[index].lastDnsCheckAt = new Date().toISOString();
      list[index].updatedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.CLINIC_DOMAINS, list);
      return { success: true, message: `DNS e certificado SSL validados com sucesso para ${list[index].domain}!` };
    }
    return { success: false, message: 'Domínio não encontrado.' };
  },

  getDomainsByClinic: (clinicId: string): ClinicDomain[] => {
    return StorageService.getClinicDomains().filter(d => d.clinicId === clinicId);
  },

  findDomainByName: (domainName: string): ClinicDomain | undefined => {
    const normalized = domainName.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0];
    const domains = StorageService.getClinicDomains().filter(d => d.isActive);
    
    // 1. Exact match
    const exact = domains.find(d => d.domain.toLowerCase() === normalized);
    if (exact) return exact;

    // 2. Try adding or removing www.
    if (normalized.startsWith('www.')) {
      const stripped = normalized.substring(4);
      const matchStripped = domains.find(d => d.domain.toLowerCase() === stripped);
      if (matchStripped) return matchStripped;
    } else {
      const withWww = `www.${normalized}`;
      const matchWithWww = domains.find(d => d.domain.toLowerCase() === withWww);
      if (matchWithWww) return matchWithWww;
    }

    return undefined;
  },

  // =========================================================================
  // Supabase Cloud Sync: Appointments & Waitlist (with localStorage fallback)
  // =========================================================================

  fetchAppointmentsFromCloudDetailed: async (
    dateFilter?: string
  ): Promise<CloudAppointmentsSyncResult> => {
    const localList = StorageService.getAppointments();
    const supabase = getSupabase();
    if (!supabase) {
      return {
        appointments: localList,
        source: 'local_fallback',
        count: localList.length,
      };
    }

    const extractJoin = (val: unknown): Record<string, unknown> | null => {
      if (!val) return null;
      if (Array.isArray(val)) return (val[0] as Record<string, unknown>) || null;
      if (typeof val === 'object') return val as Record<string, unknown>;
      return null;
    };

    try {
      // 1. Primary query using aliased left-joins without any mock organization_id filter
      let primaryQuery = supabase
        .from('appointments')
        .select(
          `
          *,
          patient:patients (id, full_name, phone, whatsapp, document_cpf, email, health_plan_type),
          professional:professionals (id, full_name, council_number),
          branch:branches (id, name),
          service:services (id, name)
        `
        )
        .order('start_time', { ascending: true });

      if (dateFilter) {
        primaryQuery = primaryQuery
          .gte('start_time', `${dateFilter}T00:00:00`)
          .lte('start_time', `${dateFilter}T23:59:59.999`);
      }

      let { data: appointmentsData, error: appError } = await primaryQuery;

      // 2. Cloud fallback 1: join only patients if any auxiliary table/column (branches/services/professionals) fails
      if (appError) {
        console.warn('Primary appointments join failed, trying patient-only join:', appError.message);
        let fallbackPatientQuery = supabase
          .from('appointments')
          .select('*, patient:patients (*)')
          .order('start_time', { ascending: true });

        if (dateFilter) {
          fallbackPatientQuery = fallbackPatientQuery
            .gte('start_time', `${dateFilter}T00:00:00`)
            .lte('start_time', `${dateFilter}T23:59:59.999`);
        }

        const res1 = await fallbackPatientQuery;
        appointmentsData = res1.data;
        appError = res1.error;
      }

      // 3. Cloud fallback 2: flat select(*) on appointments + separate patients lookup
      const patientsById = new Map<string, Record<string, unknown>>();
      if (appError) {
        console.warn('Patient join failed, trying flat appointments select(*):', appError.message);
        let flatQuery = supabase
          .from('appointments')
          .select('*')
          .order('start_time', { ascending: true });

        if (dateFilter) {
          flatQuery = flatQuery
            .gte('start_time', `${dateFilter}T00:00:00`)
            .lte('start_time', `${dateFilter}T23:59:59.999`);
        }

        const res2 = await flatQuery;
        appointmentsData = res2.data;
        appError = res2.error;

        if (!appError && appointmentsData && appointmentsData.length > 0) {
          const { data: patientsRows } = await supabase
            .from('patients')
            .select('id, full_name, phone, whatsapp, document_cpf, email, health_plan_type');
          if (Array.isArray(patientsRows)) {
            for (const patRow of patientsRows as Array<Record<string, unknown>>) {
              if (patRow.id) {
                patientsById.set(String(patRow.id), patRow);
              }
            }
          }
        }
      }

      if (appError || !appointmentsData) {
        const errMsg = appError?.message || 'Erro desconhecido ao consultar public.appointments.';
        console.warn('Erro ao buscar agendamentos no Supabase:', errMsg);
        return {
          appointments: localList,
          source: 'local_fallback',
          error: errMsg,
          count: 0,
        };
      }

      const branches = StorageService.getBranches();
      const defaultBranchId = branches[0]?.id || 'branch_cf_centro';
      const defaultBranchName = branches[0]?.name || 'Unidade Matriz Cabo Frio (Centro)';

      const cachedPatients = getStored<Patient[]>(STORAGE_KEYS.PATIENTS, INITIAL_PATIENTS);
      let patientsCacheDirty = false;

      const cloudAppointments: Appointment[] = (
        appointmentsData as Array<Record<string, unknown>>
      ).map((row) => {
        const patientJoin =
          extractJoin(row.patient) ||
          extractJoin(row.patients) ||
          (row.patient_id ? patientsById.get(String(row.patient_id)) || null : null);
        const serviceJoin = extractJoin(row.service) || extractJoin(row.services);
        const profJoin = extractJoin(row.professional) || extractJoin(row.professionals);
        const branchJoin = extractJoin(row.branch) || extractJoin(row.branches);
        const roomJoin = extractJoin(row.room) || extractJoin(row.rooms);

        const resolvedPatientId = String(row.patient_id || patientJoin?.id || '');
        const resolvedPatientName = String(
          patientJoin?.full_name ||
            row.patient_name ||
            row.nome ||
            'Paciente Online'
        );
        const resolvedPatientPhone = String(
          patientJoin?.whatsapp ||
            patientJoin?.phone ||
            row.patient_phone ||
            row.whatsapp ||
            row.phone ||
            row.celular ||
            ''
        );

        // Cache real patient in localStorage once for PEP navigation / modal selection
        if (patientJoin && patientJoin.id && patientJoin.full_name) {
          const patCpfClean = String(patientJoin.document_cpf || '').replace(/\D/g, '');
          const alreadyExists = cachedPatients.some(
            (p) =>
              p.id === String(patientJoin.id) ||
              (patCpfClean.length >= 11 &&
                p.documentCpf.replace(/\D/g, '') === patCpfClean)
          );
          if (!alreadyExists) {
            cachedPatients.unshift({
              id: String(patientJoin.id),
              organizationId: String(row.organization_id || 'org_mureb_01'),
              originBranchId: String(row.branch_id || defaultBranchId),
              fullName: String(patientJoin.full_name),
              documentCpf: String(patientJoin.document_cpf || ''),
              birthDate: '',
              gender: 'N',
              phone: String(patientJoin.phone || patientJoin.whatsapp || ''),
              whatsapp: String(patientJoin.whatsapp || patientJoin.phone || ''),
              email: String(patientJoin.email || ''),
              healthPlanType:
                patientJoin.health_plan_type === 'convenio' ? 'convenio' : 'particular',
              sharingMode: 'model_b_shared',
              authorizedBranchIds: [String(row.branch_id || defaultBranchId)],
              lgpdConsent: true,
              createdAt: String(row.created_at || new Date().toISOString()),
              isActive: true,
            });
            patientsCacheDirty = true;
          }
        }

        const rawNotes = row.notes ? String(row.notes) : '';
        const notesServiceMatch = rawNotes.match(/Tipo:\s*([^·\n]+)/i);
        const startTimeIso = String(row.start_time || row.created_at || new Date().toISOString());
        const endTimeIso = row.end_time
          ? String(row.end_time)
          : new Date(new Date(startTimeIso).getTime() + 50 * 60000).toISOString();

        return {
          id: String(row.id),
          organizationId: String(row.organization_id || 'org_mureb_01'),
          branchId: String(row.branch_id || defaultBranchId),
          branchName: String(
            branchJoin?.name || row.branch_name || row.unidade || defaultBranchName
          ),
          patientId: resolvedPatientId,
          patientName: resolvedPatientName,
          patientPhone: resolvedPatientPhone,
          professionalId: String(row.professional_id || profJoin?.id || 'prof_newton'),
          professionalName: String(
            profJoin?.full_name ||
              row.professional_name ||
              row.especialista ||
              'Dr. Newton Mureb'
          ),
          serviceId: row.service_id ? String(row.service_id) : undefined,
          serviceName: String(
            serviceJoin?.name ||
              row.service_name ||
              row.tipo_atendimento ||
              (notesServiceMatch ? notesServiceMatch[1].trim() : 'Consulta Médica')
          ),
          roomId: row.room_id ? String(row.room_id) : undefined,
          roomName: String(
            roomJoin?.name ||
              row.room_name ||
              'Consultório 01 - Clínica Médica, Endocrinologia e Metabologia'
          ),
          startTime: startTimeIso,
          endTime: endTimeIso,
          status: (row.status as AppointmentStatus) || 'scheduled',
          appointmentType:
            row.appointment_type === 'telemedicina' ? 'telemedicina' : 'presencial',
          notes: rawNotes || undefined,
          cancellationReason: row.cancellation_reason
            ? String(row.cancellation_reason)
            : undefined,
          createdAt: String(row.created_at || new Date().toISOString()),
        };
      });

      if (patientsCacheDirty) {
        setStored(STORAGE_KEYS.PATIENTS, cachedPatients);
      }

      // CRITICAL: When Supabase responds without error, replace local appointments cache with real Supabase rows
      // (never merge INITIAL_APPOINTMENTS mock records back in)
      if (!dateFilter) {
        setStored(STORAGE_KEYS.APPOINTMENTS, cloudAppointments);
      }

      return {
        appointments: cloudAppointments,
        source: 'supabase',
        count: cloudAppointments.length,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('Exceção ao carregar agendamentos do Supabase:', errMsg);
      return {
        appointments: localList,
        source: 'local_fallback',
        error: errMsg,
        count: 0,
      };
    }
  },

  fetchAppointmentsFromCloud: async (dateFilter?: string): Promise<Appointment[]> => {
    const res = await StorageService.fetchAppointmentsFromCloudDetailed(dateFilter);
    return res.appointments;
  },

  updateAppointmentStatusInCloud: async (
    appointmentId: string,
    newStatus: AppointmentStatus,
    notes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    // 1. Update localStorage immediately for responsive UI
    StorageService.updateAppointmentStatus(
      appointmentId,
      newStatus,
      newStatus === 'cancelled' ? notes : undefined
    );

    const supabase = getSupabase();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId);

    if (!supabase || !isUuid) {
      return { success: true };
    }

    try {
      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };
      if (newStatus === 'cancelled' && notes) {
        updatePayload.cancellation_reason = notes;
      } else if (newStatus === 'scheduled' || newStatus === 'confirmed') {
        updatePayload.cancellation_reason = null;
        if (notes) updatePayload.notes = notes;
      } else if (notes) {
        updatePayload.notes = notes;
      }

      const { error } = await supabase
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId);

      if (error) {
        console.warn('Erro ao atualizar status no Supabase:', error.message);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },

  createAppointmentInCloud: async (input: {
    existingAppointmentId?: string;
    existingPatientId?: string;
    newPatient?: {
      fullName: string;
      documentCpf: string;
      phone: string;
      whatsapp?: string;
      email?: string;
    };
    branchId: string;
    professionalId: string;
    serviceId?: string;
    serviceName?: string;
    roomId?: string;
    roomName?: string;
    startTime: string;
    endTime: string;
    status: AppointmentStatus;
    appointmentType: 'presencial' | 'telemedicina';
    notes?: string;
    isOverbook?: boolean;
    dateYmd?: string;
    horaFormatada?: string;
    n8nInicio?: string;
    sendToN8n?: boolean;
  }): Promise<{ success: boolean; appointment?: Appointment; message?: string }> => {
    const clinic = StorageService.getClinic();
    const org = StorageService.getOrganization();
    const branches = StorageService.getBranches();
    const professionals = StorageService.getProfessionals();
    const services = StorageService.getServices();
    const rooms = StorageService.getRooms();

    const targetBranch = branches.find((b) => b.id === input.branchId) || branches[0];
    const targetProf = professionals.find((p) => p.id === input.professionalId) || professionals[0];
    const targetService = services.find((s) => s.id === input.serviceId) || services[0];
    const targetRoom = rooms.find((r) => r.id === input.roomId) || rooms[0];

    let resolvedPatient: Patient | undefined;

    if (input.newPatient) {
      const nowIso = new Date().toISOString();
      resolvedPatient = StorageService.upsertPatientByCpf({
        id: `pat_${Date.now()}`,
        organizationId: org.id || 'org_mureb_01',
        originBranchId: targetBranch?.id || 'branch_cf_centro',
        authorizedBranchIds: [targetBranch?.id || 'branch_cf_centro'],
        sharingMode: 'model_b_shared',
        fullName: input.newPatient.fullName.trim(),
        documentCpf: input.newPatient.documentCpf,
        birthDate: '',
        gender: 'N',
        phone: input.newPatient.phone,
        whatsapp: input.newPatient.whatsapp || input.newPatient.phone,
        email: input.newPatient.email || '',
        lgpdConsent: true,
        lgpdConsentDate: nowIso,
        administrativeNotes: 'Paciente cadastrado diretamente via Agenda Visual.',
        isActive: true,
        createdAt: nowIso,
      });
    } else if (input.existingPatientId) {
      resolvedPatient = StorageService.getPatients().find((p) => p.id === input.existingPatientId);
    }

    if (!resolvedPatient) {
      return { success: false, message: 'Selecione ou cadastre um paciente para agendar.' };
    }

    const nowIso = new Date().toISOString();
    let finalAppointmentId = input.existingAppointmentId || `apt_${Date.now()}`;
    const isUuid = (val?: string) =>
      Boolean(
        val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
      );

    // 1. Optional n8n webhook notification (if requested for new appointments)
    if (input.sendToN8n && !input.existingAppointmentId) {
      const webhookUrl = (
        clinic.n8nWebhookAgendamento ||
        'https://n8n.srv1352561.hstgr.cloud/webhook/agendaclinica'
      ).trim();

      const cleanCpf = resolvedPatient.documentCpf.replace(/\D/g, '');
      const cleanPhone = (resolvedPatient.whatsapp || resolvedPatient.phone).replace(/\D/g, '');
      const celularE164 =
        cleanPhone.startsWith('55') && cleanPhone.length >= 12
          ? `+${cleanPhone}`
          : `+55${cleanPhone}`;

      const dateYmd =
        input.dateYmd ||
        `${new Date(input.startTime).getFullYear()}-${String(new Date(input.startTime).getMonth() + 1).padStart(2, '0')}-${String(new Date(input.startTime).getDate()).padStart(2, '0')}`;
      const horaFmt =
        input.horaFormatada ||
        new Date(input.startTime).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        });

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unidade: targetBranch
              ? `${targetBranch.name} (${targetBranch.city}/${targetBranch.state})`
              : 'Unidade Matriz Cabo Frio (Centro) (Cabo Frio/RJ)',
            especialista: targetProf?.fullName || 'Dr. Newton Mureb',
            tipo_atendimento: input.serviceName || targetService?.name || 'Primeira consulta',
            nome: resolvedPatient.fullName,
            cpf: cleanCpf,
            celular: celularE164,
            email: resolvedPatient.email || '',
            assunto: input.notes || '',
            data: dateYmd,
            horario: input.n8nInicio || input.startTime,
            hora_formatada: horaFmt,
            inicio: input.n8nInicio || input.startTime,
            tenant_slug: org.slug || 'dr-newton-mureb',
            organization_id: org.id || 'org_mureb_01',
            clinic_cnpj: clinic.documentNumber || '55.937.470/0001-78',
          }),
        });
      } catch (n8nErr) {
        console.warn('Aviso ao enviar confirmação para webhook n8n:', n8nErr);
      }
    }

    // 2. Persist in Supabase (if configured)
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .limit(1)
          .maybeSingle();

        const supaOrgId = orgRow?.id;
        if (supaOrgId) {
          const { data: branchRow } = await supabase
            .from('branches')
            .select('id')
            .eq('organization_id', supaOrgId)
            .limit(1)
            .maybeSingle();

          const { data: profRow } = await supabase
            .from('professionals')
            .select('id')
            .eq('organization_id', supaOrgId)
            .limit(1)
            .maybeSingle();

          const { data: srvRow } = await supabase
            .from('services')
            .select('id')
            .eq('organization_id', supaOrgId)
            .limit(1)
            .maybeSingle();

          const cleanCpf = resolvedPatient.documentCpf.replace(/\D/g, '');
          let supaPatientId = isUuid(resolvedPatient.id) ? resolvedPatient.id : undefined;

          if (!supaPatientId && cleanCpf) {
            const { data: foundPat } = await supabase
              .from('patients')
              .select('id')
              .eq('organization_id', supaOrgId)
              .or(`document_cpf.eq.${resolvedPatient.documentCpf},document_cpf.eq.${cleanCpf}`)
              .limit(1)
              .maybeSingle();
            supaPatientId = foundPat?.id;
          }

          if (!supaPatientId && branchRow?.id) {
            const { data: insertedPat } = await supabase
              .from('patients')
              .insert({
                organization_id: supaOrgId,
                origin_branch_id: branchRow.id,
                full_name: resolvedPatient.fullName,
                document_cpf: resolvedPatient.documentCpf,
                phone: resolvedPatient.phone,
                whatsapp: resolvedPatient.whatsapp || resolvedPatient.phone,
                email: resolvedPatient.email || null,
                lgpd_consent: true,
                lgpd_consent_date: nowIso,
                sharing_mode: 'model_b_shared',
              })
              .select('id')
              .single();
            supaPatientId = insertedPat?.id;
          }

          if (supaPatientId && branchRow?.id && profRow?.id) {
            if (isUuid(input.existingAppointmentId)) {
              await supabase
                .from('appointments')
                .update({
                  patient_id: supaPatientId,
                  service_id: isUuid(input.serviceId) ? input.serviceId : srvRow?.id || null,
                  room_id: isUuid(input.roomId) ? input.roomId : null,
                  start_time: input.startTime,
                  end_time: input.endTime,
                  status: input.status,
                  appointment_type: input.appointmentType,
                  notes: input.notes || null,
                  updated_at: nowIso,
                })
                .eq('id', input.existingAppointmentId!);
            } else {
              const { data: insertedApt } = await supabase
                .from('appointments')
                .insert({
                  organization_id: supaOrgId,
                  branch_id: branchRow.id,
                  patient_id: supaPatientId,
                  professional_id: profRow.id,
                  service_id: isUuid(input.serviceId) ? input.serviceId : srvRow?.id || null,
                  room_id: isUuid(input.roomId) ? input.roomId : null,
                  start_time: input.startTime,
                  end_time: input.endTime,
                  status: input.status,
                  appointment_type: input.appointmentType,
                  notes: input.notes || null,
                })
                .select('id')
                .single();
              if (insertedApt?.id) {
                finalAppointmentId = insertedApt.id;
              }
            }
          }
        }
      } catch (supaErr) {
        console.warn('Aviso ao persistir agendamento no Supabase:', supaErr);
      }
    }

    // 3. Persist in localStorage ERP
    const appointmentObj: Appointment = {
      id: finalAppointmentId,
      organizationId: org.id || 'org_mureb_01',
      branchId: targetBranch?.id || 'branch_cf_centro',
      patientId: resolvedPatient.id,
      patientName: resolvedPatient.fullName,
      patientPhone: resolvedPatient.whatsapp || resolvedPatient.phone,
      professionalId: targetProf?.id || 'prof_newton',
      professionalName: targetProf?.fullName || 'Dr. Newton Mureb',
      serviceId: targetService?.id,
      serviceName: input.serviceName || targetService?.name || 'Consulta Médica',
      roomId: targetRoom?.id,
      roomName: targetRoom?.name || 'Consultório 01 - Clínica Médica, Endocrinologia e Metabologia',
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status,
      appointmentType: input.appointmentType,
      notes: input.notes,
      isOverbook: input.isOverbook,
      createdAt: nowIso,
    };

    const localRes = StorageService.saveAppointment(appointmentObj);
    if (!localRes.success) {
      return { success: false, message: localRes.message };
    }

    if (input.sendToN8n && !input.existingAppointmentId && appointmentObj.patientPhone) {
      const startDt = new Date(input.startTime);
      const formattedDate = startDt.toLocaleDateString('pt-BR');
      const formattedHour =
        input.horaFormatada ||
        startDt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const branchLabel = targetBranch
        ? `${targetBranch.name} (${targetBranch.city}/${targetBranch.state})`
        : 'nossa clínica';
      const confirmationText = `Olá, ${appointmentObj.patientName}! Confirmamos seu agendamento (${appointmentObj.serviceName}) com ${appointmentObj.professionalName} para o dia ${formattedDate} às ${formattedHour} em ${branchLabel}.`;

      if (clinic.megaapiInstanceUrl?.trim() && clinic.megaapiToken?.trim()) {
        try {
          const { sendWhatsAppMessage } = await import('./megaApiService');
          await sendWhatsAppMessage(appointmentObj.patientPhone, confirmationText, clinic, {
            organizationId: appointmentObj.organizationId,
            branchId: appointmentObj.branchId,
            patientId: appointmentObj.patientId,
            patientName: appointmentObj.patientName,
            appointmentId: appointmentObj.id,
            recordAttemptOnFailure: true,
          });
        } catch (megaErr) {
          console.warn('Aviso ao disparar WhatsApp de confirmação:', megaErr);
        }
      } else {
        await StorageService.sendMessageToCloud({
          organizationId: appointmentObj.organizationId,
          branchId: appointmentObj.branchId,
          patientId: appointmentObj.patientId,
          appointmentId: appointmentObj.id,
          patientName: appointmentObj.patientName,
          recipientPhone: appointmentObj.patientPhone,
          channel: 'whatsapp',
          direction: 'outbound',
          content: confirmationText,
          status: 'delivered',
        });
      }
    }

    return { success: true, appointment: appointmentObj };
  },

  fetchWaitlistFromCloud: async (branchFilterId?: string): Promise<WaitlistEntry[]> => {
    const localList = StorageService.getWaitlist(branchFilterId);
    const supabase = getSupabase();
    if (!supabase) return localList;

    try {
      const { data, error } = await supabase
        .from('waitlist')
        .select(
          `
          id,
          organization_id,
          branch_id,
          patient_id,
          professional_id,
          specialty_id,
          preferred_days,
          preferred_period,
          notes,
          status,
          created_at,
          patients (
            full_name,
            phone,
            whatsapp
          )
        `
        )
        .eq('status', 'waiting')
        .order('created_at', { ascending: false });

      if (error || !data) {
        return localList;
      }

      const cloudWaitlist: WaitlistEntry[] = (data as Array<Record<string, unknown>>).map((row) => {
        const pat = Array.isArray(row.patients)
          ? (row.patients[0] as Record<string, unknown> | undefined)
          : (row.patients as Record<string, unknown> | null);
        return {
          id: String(row.id),
          organizationId: String(row.organization_id),
          branchId: String(row.branch_id),
          patientId: String(row.patient_id),
          patientName: String(pat?.full_name || 'Paciente'),
          patientPhone: String(pat?.whatsapp || pat?.phone || ''),
          professionalId: row.professional_id ? String(row.professional_id) : undefined,
          specialtyId: row.specialty_id ? String(row.specialty_id) : undefined,
          preferredDays: Array.isArray(row.preferred_days)
            ? (row.preferred_days as string[])
            : [],
          preferredPeriod:
            (row.preferred_period as WaitlistEntry['preferredPeriod']) || 'qualquer',
          notes: row.notes ? String(row.notes) : undefined,
          status: (row.status as WaitlistEntry['status']) || 'waiting',
          createdAt: String(row.created_at || new Date().toISOString()),
        };
      });

      const cloudIds = new Set(cloudWaitlist.map((w) => w.id));
      const merged = [
        ...cloudWaitlist,
        ...StorageService.getWaitlist().filter((l) => !cloudIds.has(l.id)),
      ];
      setStored(STORAGE_KEYS.WAITLIST, merged);
      return !branchFilterId || branchFilterId === 'all'
        ? merged
        : merged.filter((w) => w.branchId === branchFilterId);
    } catch {
      return localList;
    }
  },

  createWaitlistInCloud: async (entry: WaitlistEntry): Promise<WaitlistEntry> => {
    let savedId = entry.id;
    const supabase = getSupabase();

    if (supabase) {
      try {
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (orgRow?.id) {
          const { data: branchRow } = await supabase
            .from('branches')
            .select('id')
            .eq('organization_id', orgRow.id)
            .limit(1)
            .maybeSingle();
          const { data: profRow } = await supabase
            .from('professionals')
            .select('id')
            .eq('organization_id', orgRow.id)
            .limit(1)
            .maybeSingle();

          const localPatient = StorageService.getPatients().find((p) => p.id === entry.patientId);
          let supaPatientId: string | undefined;
          if (localPatient) {
            const cleanCpf = localPatient.documentCpf.replace(/\D/g, '');
            const { data: patRow } = await supabase
              .from('patients')
              .select('id')
              .eq('organization_id', orgRow.id)
              .or(`document_cpf.eq.${localPatient.documentCpf},document_cpf.eq.${cleanCpf}`)
              .limit(1)
              .maybeSingle();
            supaPatientId = patRow?.id;
          }

          if (branchRow?.id && supaPatientId) {
            const { data: inserted } = await supabase
              .from('waitlist')
              .insert({
                organization_id: orgRow.id,
                branch_id: branchRow.id,
                patient_id: supaPatientId,
                professional_id: profRow?.id || null,
                preferred_days: entry.preferredDays,
                preferred_period: entry.preferredPeriod,
                notes: entry.notes || null,
                status: 'waiting',
              })
              .select('id')
              .single();
            if (inserted?.id) savedId = inserted.id;
          }
        }
      } catch (err) {
        console.warn('Aviso ao inserir na waitlist do Supabase:', err);
      }
    }

    const finalEntry = { ...entry, id: savedId };
    StorageService.saveWaitlistEntry(finalEntry);
    return finalEntry;
  },

  removeWaitlistInCloud: async (id: string): Promise<void> => {
    StorageService.removeWaitlistEntry(id);
    const supabase = getSupabase();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (supabase && isUuid) {
      try {
        await supabase.from('waitlist').delete().eq('id', id);
      } catch (err) {
        console.warn('Aviso ao remover item da waitlist no Supabase:', err);
      }
    }
  }
};


