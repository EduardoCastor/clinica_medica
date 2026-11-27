import { BillingCycle, LicenseStatus, OnboardingProgress, Organization, Plan } from '../types';

export interface CyclePricingBreakdown {
  cycle: BillingCycle;
  isTrial: boolean;
  isApplicable: boolean;
  months: number;
  baseMonthly: number;
  fullPeriodAmount: number;
  discountPercent: number;
  finalPeriodAmount: number;
  effectiveMonthly: number;
  savingsAmount: number;
}

export interface TrialLicenseState {
  licenseStatus: LicenseStatus;
  legacyStatus: Organization['status'];
  isTrial: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  isActivePaid: boolean;
  isBlockedForWrites: boolean;
  daysRemaining: number;
  endsAt?: string;
  formattedEndsAt: string;
  badgeLabel: string;
  badgeTone: 'emerald' | 'amber' | 'rose' | 'slate' | 'sky';
}

export interface OnboardingStepDefinition {
  key: string;
  stepNumber: number;
  title: string;
  description: string;
  targetTab:
    | 'settings'
    | 'users'
    | 'patients'
    | 'appointments'
    | 'dashboard'
    | 'medical_records'
    | 'communication';
  actionLabel: string;
}

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    key: 'clinic',
    stepNumber: 1,
    title: 'Dados da Clínica',
    description: 'Configure razão social, nome fantasia, CNPJ, telefone e apresentação institucional.',
    targetTab: 'settings',
    actionLabel: 'Configurar Clínica',
  },
  {
    key: 'branches_rooms',
    stepNumber: 2,
    title: 'Unidade e Consultórios',
    description: 'Revise sua unidade matriz, horários de funcionamento e salas de atendimento.',
    targetTab: 'settings',
    actionLabel: 'Gerenciar Unidades',
  },
  {
    key: 'professionals',
    stepNumber: 3,
    title: 'Médicos e Profissionais',
    description: 'Cadastre médicos, especialidades, registros no conselho (CRM) e equipe.',
    targetTab: 'users',
    actionLabel: 'Cadastrar Equipe',
  },
  {
    key: 'services',
    stepNumber: 4,
    title: 'Serviços e Procedimentos',
    description: 'Defina consultas, durações padrão e valores para agenda e financeiro.',
    targetTab: 'settings',
    actionLabel: 'Configurar Serviços',
  },
  {
    key: 'patients',
    stepNumber: 5,
    title: 'Pacientes',
    description: 'Cadastre seu primeiro paciente ou importe a base inicial da clínica.',
    targetTab: 'patients',
    actionLabel: 'Abrir Pacientes',
  },
  {
    key: 'appointments',
    stepNumber: 6,
    title: 'Agenda',
    description: 'Crie o primeiro agendamento para testar confirmações e painel de chamada.',
    targetTab: 'appointments',
    actionLabel: 'Ir para Agenda',
  },
  {
    key: 'overview',
    stepNumber: 7,
    title: 'Conhecer Recursos',
    description: 'Explore o Prontuário Eletrônico, Financeiro, Painel de Chamada e Site White-Label.',
    targetTab: 'dashboard',
    actionLabel: 'Explorar Painel',
  },
];

export function roundMoney(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function clampDiscountPercent(value?: number | null): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  if (num > 95) return 95;
  return roundMoney(num);
}

export function formatBrl(value: number): string {
  return roundMoney(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function deriveQuarterlyDiscount(plan: Plan): number {
  if (plan.code === 'trial' || (plan.priceMonthly || 0) <= 0) return 0;
  if (plan.quarterlyDiscountPercent !== undefined && plan.quarterlyDiscountPercent !== null) {
    return clampDiscountPercent(plan.quarterlyDiscountPercent);
  }
  if (plan.priceMonthly > 0 && plan.priceQuarterly && plan.priceQuarterly > 0) {
    const full = plan.priceMonthly * 3;
    return clampDiscountPercent((1 - plan.priceQuarterly / full) * 100);
  }
  return 10;
}

export function deriveYearlyDiscount(plan: Plan): number {
  if (plan.code === 'trial' || (plan.priceMonthly || 0) <= 0) return 0;
  if (plan.yearlyDiscountPercent !== undefined && plan.yearlyDiscountPercent !== null) {
    return clampDiscountPercent(plan.yearlyDiscountPercent);
  }
  if (plan.priceMonthly > 0 && plan.priceYearly > 0) {
    const full = plan.priceMonthly * 12;
    return clampDiscountPercent((1 - plan.priceYearly / full) * 100);
  }
  return 20;
}

export function calculatePlanCyclePricing(
  plan: Plan,
  cycle: BillingCycle
): CyclePricingBreakdown {
  const baseMonthly = roundMoney(plan.priceMonthly || 0);
  const isTrial = plan.code === 'trial' || baseMonthly === 0 || cycle === 'trial';

  if (isTrial) {
    return {
      cycle: 'trial',
      isTrial: true,
      isApplicable: false,
      months: 0,
      baseMonthly: 0,
      fullPeriodAmount: 0,
      discountPercent: 0,
      finalPeriodAmount: 0,
      effectiveMonthly: 0,
      savingsAmount: 0,
    };
  }

  if (cycle === 'quarterly') {
    const discountPercent = deriveQuarterlyDiscount(plan);
    const fullPeriodAmount = roundMoney(baseMonthly * 3);
    const finalPeriodAmount = roundMoney(fullPeriodAmount * (1 - discountPercent / 100));
    return {
      cycle: 'quarterly',
      isTrial: false,
      isApplicable: true,
      months: 3,
      baseMonthly,
      fullPeriodAmount,
      discountPercent,
      finalPeriodAmount,
      effectiveMonthly: roundMoney(finalPeriodAmount / 3),
      savingsAmount: roundMoney(Math.max(0, fullPeriodAmount - finalPeriodAmount)),
    };
  }

  if (cycle === 'yearly') {
    const discountPercent = deriveYearlyDiscount(plan);
    const fullPeriodAmount = roundMoney(baseMonthly * 12);
    const finalPeriodAmount = roundMoney(fullPeriodAmount * (1 - discountPercent / 100));
    return {
      cycle: 'yearly',
      isTrial: false,
      isApplicable: true,
      months: 12,
      baseMonthly,
      fullPeriodAmount,
      discountPercent,
      finalPeriodAmount,
      effectiveMonthly: roundMoney(finalPeriodAmount / 12),
      savingsAmount: roundMoney(Math.max(0, fullPeriodAmount - finalPeriodAmount)),
    };
  }

  return {
    cycle: 'monthly',
    isTrial: false,
    isApplicable: true,
    months: 1,
    baseMonthly,
    fullPeriodAmount: baseMonthly,
    discountPercent: 0,
    finalPeriodAmount: baseMonthly,
    effectiveMonthly: baseMonthly,
    savingsAmount: 0,
  };
}

export function sortPlansByCommercialOrder(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => {
    const orderA = a.displayOrder ?? (a.code === 'trial' ? 1 : a.code === 'basic' ? 2 : 3);
    const orderB = b.displayOrder ?? (b.code === 'trial' ? 1 : b.code === 'basic' ? 2 : 3);
    if (orderA !== orderB) return orderA - orderB;
    return (a.priceMonthly || 0) - (b.priceMonthly || 0);
  });
}

export function resolveCanonicalLicenseStatus(
  org: Pick<Organization, 'status' | 'licenseStatus' | 'trialEndsAt' | 'subscriptionRenewsAt'>,
  nowDate: Date = new Date()
): LicenseStatus {
  const nowMs = nowDate.getTime();
  const explicit = org.licenseStatus;

  if (explicit) {
    if (explicit === 'TESTE_ATIVO' && org.trialEndsAt) {
      const endMs = new Date(org.trialEndsAt).getTime();
      if (Number.isFinite(endMs) && endMs <= nowMs) {
        return 'TESTE_EXPIRADO';
      }
    }
    return explicit;
  }

  if (org.status === 'suspended') return 'SUSPENSA';
  if (org.status === 'overdue') return 'INADIMPLENTE';
  if (org.status === 'trial') {
    if (org.trialEndsAt) {
      const endMs = new Date(org.trialEndsAt).getTime();
      if (Number.isFinite(endMs) && endMs <= nowMs) {
        return 'TESTE_EXPIRADO';
      }
    }
    return 'TESTE_ATIVO';
  }
  return 'ATIVA';
}

export function computeTrialLicenseState(
  org: Organization,
  nowDate: Date = new Date()
): TrialLicenseState {
  const licenseStatus = resolveCanonicalLicenseStatus(org, nowDate);
  const endsAt =
    licenseStatus === 'TESTE_ATIVO' || licenseStatus === 'TESTE_EXPIRADO'
      ? org.trialEndsAt
      : org.subscriptionRenewsAt || org.trialEndsAt;

  let daysRemaining = 0;
  if (endsAt) {
    const diffMs = new Date(endsAt).getTime() - nowDate.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const formattedEndsAt = endsAt
    ? new Date(endsAt).toLocaleDateString('pt-BR')
    : 'Não definida';

  const isTrial = licenseStatus === 'TESTE_ATIVO' || licenseStatus === 'TESTE_EXPIRADO';
  const isTrialActive = licenseStatus === 'TESTE_ATIVO';
  const isTrialExpired = licenseStatus === 'TESTE_EXPIRADO';
  const isActivePaid = licenseStatus === 'ATIVA';

  let isBlockedForWrites = false;
  if (
    licenseStatus === 'TESTE_EXPIRADO' ||
    licenseStatus === 'INADIMPLENTE' ||
    licenseStatus === 'SUSPENSA' ||
    licenseStatus === 'CANCELADA'
  ) {
    isBlockedForWrites = true;
  } else if (licenseStatus === 'PAGAMENTO_PENDENTE') {
    const graceMs = endsAt ? new Date(endsAt).getTime() : 0;
    isBlockedForWrites = graceMs > 0 ? graceMs <= nowDate.getTime() : true;
  }

  const badgeMap: Record<
    LicenseStatus,
    { label: string; tone: TrialLicenseState['badgeTone']; legacy: Organization['status'] }
  > = {
    TESTE_ATIVO: { label: 'Teste Gratuito Ativo', tone: 'amber', legacy: 'trial' },
    TESTE_EXPIRADO: { label: 'Teste Expirado', tone: 'rose', legacy: 'overdue' },
    ATIVA: { label: 'Assinatura Ativa', tone: 'emerald', legacy: 'active' },
    PAGAMENTO_PENDENTE: { label: 'Pagamento Pendente', tone: 'sky', legacy: 'overdue' },
    INADIMPLENTE: { label: 'Inadimplente', tone: 'rose', legacy: 'overdue' },
    SUSPENSA: { label: 'Licença Suspensa', tone: 'rose', legacy: 'suspended' },
    CANCELADA: { label: 'Licença Cancelada', tone: 'slate', legacy: 'suspended' },
  };

  const meta = badgeMap[licenseStatus];

  return {
    licenseStatus,
    legacyStatus: meta.legacy,
    isTrial,
    isTrialActive,
    isTrialExpired,
    isActivePaid,
    isBlockedForWrites,
    daysRemaining,
    endsAt,
    formattedEndsAt,
    badgeLabel: meta.label,
    badgeTone: meta.tone,
  };
}

export function normalizeOnboardingProgress(raw?: unknown): OnboardingProgress {
  if (!raw || typeof raw !== 'object') {
    return { completedSteps: [], skipped: false, currentStep: 1 };
  }
  const obj = raw as Record<string, unknown>;
  const completedSteps = Array.isArray(obj.completedSteps)
    ? obj.completedSteps.map((s) => String(s))
    : [];
  return {
    completedSteps,
    skipped: Boolean(obj.skipped),
    currentStep: Number(obj.currentStep || 1),
    updatedAt: obj.updatedAt ? String(obj.updatedAt) : undefined,
  };
}
