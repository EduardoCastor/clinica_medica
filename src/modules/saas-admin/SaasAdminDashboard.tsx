import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Edit,
  Globe,
  KeyRound,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  LicenseStatus,
  Plan,
  SaasAuditLog,
  SaasInvoice,
  SaasInvoiceStatus,
} from '../../types';
import {
  SaasAdminCloudService,
  SaasAdminTenantRecord,
} from '../../services/saasCloudService';
import {
  calculatePlanCyclePricing,
  computeTrialLicenseState,
  formatBrl,
  sortPlansByCommercialOrder,
} from '../../services/saasCommercialUtils';
import { getSupabaseCredentials } from '../../services/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { DomainsManagement } from './DomainsManagement';
import { TeamManagement } from '../clinic/TeamManagement';
import { SuperAdminCandidateInfo, TeamCloudService } from '../../services/teamCloudService';
import {
  ManualPaymentModal,
  OrganizationDetailModal,
  PlanEditorModal,
} from './SaasAdminModals';

interface SaasAdminDashboardProps {
  onSimulateDomain?: (domain: string) => void;
}

type AdminTab =
  | 'overview'
  | 'organizations'
  | 'licenses'
  | 'plans'
  | 'billing'
  | 'audit'
  | 'domains'
  | 'team';

type PeriodFilter = '7d' | '30d' | '90d' | 'all';
type LicenseFilter = 'ALL' | LicenseStatus | 'EXPIRING_SOON';

const STATUS_STYLE_MAP: Record<LicenseStatus, string> = {
  ATIVA: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  TESTE_ATIVO: 'bg-amber-50 text-amber-800 border-amber-200',
  TESTE_EXPIRADO: 'bg-rose-50 text-rose-800 border-rose-200',
  PAGAMENTO_PENDENTE: 'bg-sky-50 text-sky-800 border-sky-200',
  INADIMPLENTE: 'bg-rose-50 text-rose-800 border-rose-200',
  SUSPENSA: 'bg-slate-100 text-slate-700 border-slate-300',
  CANCELADA: 'bg-slate-100 text-slate-600 border-slate-300',
};

function isInsidePeriod(isoDate: string | undefined, period: PeriodFilter): boolean {
  if (period === 'all') return true;
  if (!isoDate) return false;
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return false;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  return ts >= Date.now() - days * 24 * 60 * 60 * 1000;
}

export const SaasAdminDashboard: React.FC<SaasAdminDashboardProps> = ({
  onSimulateDomain,
}) => {
  const { impersonateClinic, refreshSessionProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<SaasAdminTenantRecord[]>([]);
  const [invoices, setInvoices] = useState<SaasInvoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<SaasAuditLog[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('30d');
  const [overviewStatusFilter, setOverviewStatusFilter] = useState<LicenseFilter>('ALL');
  const [orgSearch, setOrgSearch] = useState('');
  const [orgStatusFilter, setOrgStatusFilter] = useState<LicenseFilter>('ALL');
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>('ALL');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'ALL' | SaasInvoiceStatus>('ALL');
  const [auditSearch, setAuditSearch] = useState('');

  // Modals
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<SaasAdminTenantRecord | null>(null);
  const [manualPaymentInvoice, setManualPaymentInvoice] = useState<SaasInvoice | null>(null);
  const [isManualPaymentOpen, setIsManualPaymentOpen] = useState(false);

  // Super Admin Email Audit & Migration state
  const [superAdminCandidates, setSuperAdminCandidates] = useState<SuperAdminCandidateInfo[]>([]);
  const [isAuditingSuperAdmin, setIsAuditingSuperAdmin] = useState(false);
  const [isUpdatingSuperAdminEmail, setIsUpdatingSuperAdminEmail] = useState(false);
  const [targetSuperAdminEmail, setTargetSuperAdminEmail] = useState('admin@drnewtonmureb.com.br');
  const [requireEmailConfirmation, setRequireEmailConfirmation] = useState(false);

  const loadSaasData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const res = await SaasAdminCloudService.fetchDashboardData();
    if (!res.success || !res.data) {
      setLoadError(res.error || 'Erro ao carregar dados administrativos do servidor SaaS.');
      setIsLoading(false);
      return;
    }
    setPlans(sortPlansByCommercialOrder(res.data.plans));
    setTenants(res.data.tenants);
    setInvoices(res.data.invoices);
    setAuditLogs(res.data.auditLogs);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadSaasData();
  }, [loadSaasData]);

  const showToast = (msg: string) => {
    setFeedbackMessage(msg);
    setErrorMessage(null);
    void loadSaasData();
  };

  // Enrich tenants with canonical license calculation
  const enrichedTenants = useMemo(() => {
    return tenants.map((t) => {
      const state = computeTrialLicenseState(t.organization);
      return { ...t, licenseState: state };
    });
  }, [tenants]);

  const metrics = useMemo(() => {
    const filteredForCounts = enrichedTenants.filter((t) => {
      if (overviewStatusFilter === 'ALL') return true;
      if (overviewStatusFilter === 'EXPIRING_SOON') {
        return t.licenseState.isTrialActive && t.licenseState.daysRemaining <= 3;
      }
      return t.licenseState.licenseStatus === overviewStatusFilter;
    });

    const totalOrgs = enrichedTenants.length;
    const activePaidOrgs = enrichedTenants.filter((t) => {
      const hasPaidPlan = (t.plan?.priceMonthly || 0) > 0;
      return t.licenseState.licenseStatus === 'ATIVA' && hasPaidPlan;
    });
    const activeAllCount = enrichedTenants.filter(
      (t) => t.licenseState.licenseStatus === 'ATIVA'
    ).length;
    const activeTrialCount = enrichedTenants.filter(
      (t) => t.licenseState.licenseStatus === 'TESTE_ATIVO'
    ).length;
    const expiringTrialCount = enrichedTenants.filter(
      (t) => t.licenseState.isTrialActive && t.licenseState.daysRemaining <= 3
    ).length;
    const expiredTrialCount = enrichedTenants.filter(
      (t) => t.licenseState.licenseStatus === 'TESTE_EXPIRADO'
    ).length;
    const pendingPaymentCount = enrichedTenants.filter(
      (t) => t.licenseState.licenseStatus === 'PAGAMENTO_PENDENTE'
    ).length;
    const overdueCount = enrichedTenants.filter(
      (t) => t.licenseState.licenseStatus === 'INADIMPLENTE'
    ).length;
    const suspendedOrCancelledCount = enrichedTenants.filter(
      (t) =>
        t.licenseState.licenseStatus === 'SUSPENSA' ||
        t.licenseState.licenseStatus === 'CANCELADA'
    ).length;

    // MRR: exclusivamente assinaturas ATIVA com plano pago (normalizado mensal)
    const mrr = activePaidOrgs.reduce((acc, t) => {
      const plan = t.plan;
      if (!plan || plan.priceMonthly <= 0) return acc;
      const cycle = t.organization.billingCycle || 'monthly';
      const pricing = calculatePlanCyclePricing(
        plan,
        cycle === 'trial' ? 'monthly' : cycle
      );
      return acc + pricing.effectiveMonthly;
    }, 0);

    // Receita Recebida no Período: exclusivamente faturas status='paid' no período filtrado
    const receivedInPeriod = invoices
      .filter(
        (inv) =>
          inv.status === 'paid' && isInsidePeriod(inv.paidAt || inv.createdAt, periodFilter)
      )
      .reduce((acc, inv) => acc + inv.finalAmount, 0);

    const pendingInvoicesTotal = invoices
      .filter((inv) => inv.status === 'pending' || inv.status === 'overdue')
      .reduce((acc, inv) => acc + inv.finalAmount, 0);

    return {
      filteredForCounts,
      totalOrgs,
      activeAllCount,
      activePaidCount: activePaidOrgs.length,
      activeTrialCount,
      expiringTrialCount,
      expiredTrialCount,
      pendingPaymentCount,
      overdueCount,
      suspendedOrCancelledCount,
      mrr,
      receivedInPeriod,
      pendingInvoicesTotal,
    };
  }, [enrichedTenants, invoices, overviewStatusFilter, periodFilter]);

  const filteredOrgs = useMemo(() => {
    const q = orgSearch.trim().toLowerCase();
    return enrichedTenants.filter((t) => {
      if (orgStatusFilter === 'EXPIRING_SOON') {
        if (!(t.licenseState.isTrialActive && t.licenseState.daysRemaining <= 3)) return false;
      } else if (orgStatusFilter !== 'ALL') {
        if (t.licenseState.licenseStatus !== orgStatusFilter) return false;
      }
      if (!q) return true;
      const haystack = [
        t.organization.name,
        t.organization.slug,
        t.organization.responsibleName,
        t.organization.contactEmail,
        t.clinic?.legalName,
        t.clinic?.tradeName,
        t.clinic?.documentNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [enrichedTenants, orgSearch, orgStatusFilter]);

  const filteredLicenses = useMemo(() => {
    return enrichedTenants.filter((t) => {
      if (licenseFilter === 'ALL') return true;
      if (licenseFilter === 'EXPIRING_SOON') {
        return t.licenseState.isTrialActive && t.licenseState.daysRemaining <= 3;
      }
      return t.licenseState.licenseStatus === licenseFilter;
    });
  }, [enrichedTenants, licenseFilter]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (invoiceStatusFilter !== 'ALL' && inv.status !== invoiceStatusFilter) return false;
      return isInsidePeriod(inv.paidAt || inv.createdAt, periodFilter);
    });
  }, [invoices, invoiceStatusFilter, periodFilter]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((log) =>
      [log.actorEmail, log.action, log.targetOrganizationName, log.reason, log.entity]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [auditLogs, auditSearch]);

  const handleAuditSuperAdmin = async () => {
    setErrorMessage(null);
    setFeedbackMessage(null);
    setIsAuditingSuperAdmin(true);
    try {
      const res = await TeamCloudService.auditSuperAdminAccount();
      if (!res.success) {
        setErrorMessage(res.error || 'Falha ao consultar conta Super Admin.');
        return;
      }
      setSuperAdminCandidates(res.candidates || []);
      if ((res.candidates?.length || 0) === 1) {
        setFeedbackMessage(
          `Super Admin verificado: ${res.candidates![0].fullName} (${
            res.candidates![0].authEmail || res.candidates![0].profileEmail
          }).`
        );
      }
    } finally {
      setIsAuditingSuperAdmin(false);
    }
  };

  const handleUpdateSuperAdminEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setFeedbackMessage(null);
    setIsUpdatingSuperAdminEmail(true);
    try {
      const res = await TeamCloudService.updateSuperAdminEmailInCloud(
        targetSuperAdminEmail,
        requireEmailConfirmation
      );
      if (!res.success) {
        if (res.candidates) setSuperAdminCandidates(res.candidates);
        setErrorMessage(res.error || 'Não foi possível atualizar o e-mail do Super Admin.');
        return;
      }
      await handleAuditSuperAdmin();
      await refreshSessionProfile();
      setFeedbackMessage(
        `E-mail do Super Admin atualizado para ${res.newEmail} preservando identidade e papel.`
      );
    } finally {
      setIsUpdatingSuperAdminEmail(false);
    }
  };

  const { url: supabaseUrl } = getSupabaseCredentials();
  const webhookEndpoint = supabaseUrl
    ? `${supabaseUrl}/functions/v1/saas-payment-webhook`
    : 'https://<seu-projeto>.supabase.co/functions/v1/saas-payment-webhook';

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Dashboard Geral', icon: LayoutDashboard },
    { id: 'organizations', label: 'Organizações / Clientes', icon: Building2 },
    { id: 'licenses', label: 'Licenças', icon: KeyRound },
    { id: 'plans', label: 'Planos e Preços', icon: Sparkles },
    { id: 'billing', label: 'Financeiro & Pagamentos', icon: CreditCard },
    { id: 'audit', label: 'Histórico & Auditoria', icon: ClipboardList },
    { id: 'domains', label: 'Domínios & Sites', icon: Globe },
    { id: 'team', label: 'Super Admin & Equipe', icon: Users },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Privacy & Architecture Boundary Header */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 text-xs">
          <ShieldCheck className="w-5 h-5 text-purple-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <strong className="text-slate-900 block">
              Administração Geral MedSync SaaS · Gestão Multi-Tenant
            </strong>
            <p className="text-slate-600">
              Controle comercial, assinaturas, licenças, faturas e auditoria. O administrador da plataforma não possui acesso aos prontuários clínicos dos pacientes.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void loadSaasData()}
          className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Atualizar Dados</span>
        </button>
      </div>

      {/* Feedback & Errors */}
      {feedbackMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-emerald-700 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {(errorMessage || loadError) && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
            <span>{errorMessage || loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadSaasData()}
            className="px-3 py-1 bg-white border border-rose-200 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1.5 border-b border-slate-200 pb-2 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* TAB 1: DASHBOARD GERAL */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Período da Receita:</span>
              <div className="inline-flex p-1 bg-slate-100 rounded-lg gap-1">
                {(
                  [
                    { id: '7d', label: '7 dias' },
                    { id: '30d', label: '30 dias' },
                    { id: '90d', label: '90 dias' },
                    { id: 'all', label: 'Todo período' },
                  ] as Array<{ id: PeriodFilter; label: string }>
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriodFilter(p.id)}
                    className={`px-2.5 py-1 rounded-md font-semibold whitespace-nowrap ${
                      periodFilter === p.id
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Filtrar Lista:</span>
              <select
                value={overviewStatusFilter}
                onChange={(e) => setOverviewStatusFilter(e.target.value as LicenseFilter)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold text-slate-800"
              >
                <option value="ALL">Todos os status</option>
                <option value="ATIVA">Assinaturas Ativas</option>
                <option value="TESTE_ATIVO">Em Teste Gratuito</option>
                <option value="EXPIRING_SOON">Testes Vencendo (&le; 3 dias)</option>
                <option value="TESTE_EXPIRADO">Testes Expirados</option>
                <option value="PAGAMENTO_PENDENTE">Pagamento Pendente</option>
                <option value="INADIMPLENTE">Inadimplentes</option>
                <option value="SUSPENSA">Suspensas</option>
                <option value="CANCELADA">Canceladas</option>
              </select>
            </div>
          </div>

          {/* Primary Financial & Lifecycle KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <span className="text-xs font-medium text-slate-500">
                MRR (Assinaturas Pagas Ativas)
              </span>
              <div className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">
                {isLoading ? '—' : `R$ ${formatBrl(metrics.mrr)}`}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1 tabular-nums">
                {metrics.activePaidCount} assinaturas pagas ativas
              </span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <span className="text-xs font-medium text-slate-500">
                Receita Recebida (Faturas Pagas)
              </span>
              <div className="mt-2 text-2xl font-extrabold text-emerald-700 tabular-nums">
                {isLoading ? '—' : `R$ ${formatBrl(metrics.receivedInPeriod)}`}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1">
                Somente faturas com status confirmado
              </span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <span className="text-xs font-medium text-slate-500">
                Total de Organizações / Ativas
              </span>
              <div className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">
                {isLoading ? '—' : `${metrics.totalOrgs} / ${metrics.activeAllCount}`}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1 tabular-nums">
                {metrics.suspendedOrCancelledCount} suspensas ou canceladas
              </span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <span className="text-xs font-medium text-slate-500">
                Testes Ativos / Próx. Vencimento
              </span>
              <div className="mt-2 text-2xl font-extrabold text-amber-700 tabular-nums">
                {isLoading ? '—' : `${metrics.activeTrialCount} / ${metrics.expiringTrialCount}`}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1 tabular-nums">
                {metrics.expiredTrialCount} testes expirados aguardando plano
              </span>
            </div>
          </div>

          {/* Secondary Status Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">Ativas</span>
              <strong className="tabular-nums text-emerald-700">{metrics.activeAllCount}</strong>
            </div>
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">Em Teste</span>
              <strong className="tabular-nums text-amber-700">{metrics.activeTrialCount}</strong>
            </div>
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">Pgto Pendente</span>
              <strong className="tabular-nums text-sky-700">{metrics.pendingPaymentCount}</strong>
            </div>
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">Inadimplentes</span>
              <strong className="tabular-nums text-rose-700">{metrics.overdueCount}</strong>
            </div>
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">A Receber</span>
              <strong className="tabular-nums text-slate-900">
                R$ {formatBrl(metrics.pendingInvoicesTotal)}
              </strong>
            </div>
          </div>

          {/* Filtered Quick Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between text-xs">
              <h3 className="font-bold text-slate-900">
                Acompanhamento Prioritário de Clínicas ({metrics.filteredForCounts.length})
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab('organizations')}
                className="text-purple-700 font-semibold hover:underline"
              >
                Ver tabela completa
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-4">Organização / Clínica</th>
                    <th className="py-2.5 px-4">Plano</th>
                    <th className="py-2.5 px-4">Licença</th>
                    <th className="py-2.5 px-4">Vencimento / Dias</th>
                    <th className="py-2.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                        Carregando organizações...
                      </td>
                    </tr>
                  ) : metrics.filteredForCounts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Nenhuma organização encontrada para o filtro selecionado.
                      </td>
                    </tr>
                  ) : (
                    metrics.filteredForCounts.slice(0, 12).map((t) => (
                      <tr key={t.organization.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {t.clinic?.tradeName || t.organization.name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {t.organization.responsibleName || '—'} ·{' '}
                            {t.organization.contactEmail || t.clinic?.email || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-medium">
                          {t.plan?.name || 'Sem plano'}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                              STATUS_STYLE_MAP[t.licenseState.licenseStatus]
                            }`}
                          >
                            {t.licenseState.badgeLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 tabular-nums text-slate-700">
                          {t.licenseState.formattedEndsAt}
                          {t.licenseState.isTrialActive && (
                            <span className="text-[11px] text-slate-500 ml-1.5">
                              ({t.licenseState.daysRemaining}d)
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedTenant(t)}
                            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg"
                          >
                            Gerenciar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ORGANIZAÇÕES / CLIENTES */}
      {activeTab === 'organizations' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por clínica, responsável, e-mail ou CNPJ..."
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl"
              />
            </div>

            <select
              value={orgStatusFilter}
              onChange={(e) => setOrgStatusFilter(e.target.value as LicenseFilter)}
              className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold text-slate-800"
            >
              <option value="ALL">Todos os status ({enrichedTenants.length})</option>
              <option value="ATIVA">Assinatura Ativa</option>
              <option value="TESTE_ATIVO">Teste Ativo</option>
              <option value="EXPIRING_SOON">Teste Vencendo (&le; 3 dias)</option>
              <option value="TESTE_EXPIRADO">Teste Expirado</option>
              <option value="PAGAMENTO_PENDENTE">Pagamento Pendente</option>
              <option value="INADIMPLENTE">Inadimplente</option>
              <option value="SUSPENSA">Suspensa</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Organização / Clínica</th>
                    <th className="py-3 px-4">Responsável & Contato</th>
                    <th className="py-3 px-4">Plano / Ciclo</th>
                    <th className="py-3 px-4">Licença</th>
                    <th className="py-3 px-4">Cadastro / Expiração</th>
                    <th className="py-3 px-4">Último Acesso</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrgs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        Nenhuma clínica encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredOrgs.map((t) => (
                      <tr key={t.organization.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">
                            {t.clinic?.legalName || t.organization.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {t.organization.slug} · {t.branchesCount} filiais · {t.activeUsersCount}{' '}
                            usuários
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">
                            {t.organization.responsibleName || '—'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {t.organization.contactEmail || t.clinic?.email || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {t.plan?.name || 'Plano'}
                          </div>
                          <div className="text-[11px] text-slate-500 uppercase font-mono">
                            {t.organization.billingCycle || 'trial'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${
                              STATUS_STYLE_MAP[t.licenseState.licenseStatus]
                            }`}
                          >
                            {t.licenseState.badgeLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 tabular-nums text-slate-700">
                          <div>
                            Criada: {new Date(t.organization.createdAt).toLocaleDateString('pt-BR')}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Vence: {t.licenseState.formattedEndsAt}
                          </div>
                        </td>
                        <td className="py-3 px-4 tabular-nums text-slate-600">
                          {t.organization.lastAccessedAt
                            ? new Date(t.organization.lastAccessedAt).toLocaleDateString('pt-BR')
                            : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedTenant(t)}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg"
                            >
                              Detalhes
                            </button>
                            <button
                              type="button"
                              onClick={() => impersonateClinic(t.clinic?.id || t.organization.id)}
                              className="p-1.5 text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg"
                              title="Acessar como suporte"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LICENÇAS */}
      {activeTab === 'licenses' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5 p-2 bg-white rounded-2xl border border-slate-200 text-xs">
            {(
              [
                { id: 'ALL', label: 'Todas' },
                { id: 'ATIVA', label: 'Ativas' },
                { id: 'TESTE_ATIVO', label: 'Em teste' },
                { id: 'EXPIRING_SOON', label: 'Próx. vencimento (<=3d)' },
                { id: 'TESTE_EXPIRADO', label: 'Expiradas' },
                { id: 'PAGAMENTO_PENDENTE', label: 'Pgto. pendente' },
                { id: 'INADIMPLENTE', label: 'Inadimplentes' },
                { id: 'SUSPENSA', label: 'Suspensas' },
                { id: 'CANCELADA', label: 'Canceladas' },
              ] as Array<{ id: LicenseFilter; label: string }>
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setLicenseFilter(pill.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap ${
                  licenseFilter === pill.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Organização</th>
                    <th className="py-3 px-4">Plano & Ciclo</th>
                    <th className="py-3 px-4">Status da Licença</th>
                    <th className="py-3 px-4">Dias Restantes</th>
                    <th className="py-3 px-4">Último Pagamento</th>
                    <th className="py-3 px-4">Próximo Vencimento</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLicenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        Nenhuma licença neste filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredLicenses.map((t) => (
                      <tr key={t.organization.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {t.clinic?.tradeName || t.organization.name}
                        </td>
                        <td className="py-3 px-4">
                          {t.plan?.name || '—'} ·{' '}
                          <span className="font-mono uppercase text-[11px] text-slate-500">
                            {t.organization.billingCycle || 'trial'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                              STATUS_STYLE_MAP[t.licenseState.licenseStatus]
                            }`}
                          >
                            {t.licenseState.badgeLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 tabular-nums font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{t.licenseState.daysRemaining}d</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 tabular-nums text-slate-600">
                          {t.lastPaidAt
                            ? new Date(t.lastPaidAt).toLocaleDateString('pt-BR')
                            : 'Sem pagamento'}
                        </td>
                        <td className="py-3 px-4 tabular-nums text-slate-700">
                          {t.licenseState.formattedEndsAt}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedTenant(t)}
                            className="px-3 py-1 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 font-semibold rounded-lg"
                          >
                            Alterar Licença / Prazo
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PLANOS E PREÇOS */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Catálogo Comercial de Planos (Fonte Única de Verdade)
              </h2>
              <p className="text-slate-600">
                Alterações de preço mensal, descontos trimestrais/anuais, ordem e disponibilidade atualizam a Landing Page e o Checkout imediatamente.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((plan) => {
              const qCalc = calculatePlanCyclePricing(plan, 'quarterly');
              const yCalc = calculatePlanCyclePricing(plan, 'yearly');
              return (
                <div
                  key={plan.id}
                  className="p-5 bg-white rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4 text-xs"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[11px] text-slate-400">
                          Ordem {plan.displayOrder ?? 1} · {plan.code}
                        </span>
                        <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                          plan.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        {plan.isActive ? 'Ativo' : 'Oculto'}
                      </span>
                    </div>

                    <p className="text-slate-600 leading-relaxed">{plan.description}</p>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 font-mono tabular-nums">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Mensal:</span>
                        <strong className="text-slate-900">R$ {formatBrl(plan.priceMonthly)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          Trimestral ({qCalc.discountPercent}% off):
                        </span>
                        <strong className="text-slate-900">
                          R$ {formatBrl(qCalc.finalPeriodAmount)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          Anual ({yCalc.discountPercent}% off):
                        </span>
                        <strong className="text-slate-900">
                          R$ {formatBrl(yCalc.finalPeriodAmount)}
                        </strong>
                      </div>
                    </div>

                    <div className="space-y-1 text-slate-700 pt-1">
                      <div>
                        Filiais: <strong>{plan.maxBranches}</strong> · Usuários:{' '}
                        <strong>{plan.maxUsers}</strong> · Pacientes:{' '}
                        <strong>{plan.maxPatients.toLocaleString('pt-BR')}</strong>
                      </div>
                      <div>
                        Trial: <strong>{plan.trialDays} dias</strong> · WhatsApp API:{' '}
                        <strong>{plan.hasWhatsAppAutomation ? 'Sim' : 'Não'}</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingPlan(plan)}
                    className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl inline-flex items-center justify-center gap-1.5"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Editar Preços, Descontos e Limites</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: FINANCEIRO & PAGAMENTOS */}
      {activeTab === 'billing' && (
        <div className="space-y-5">
          {/* Kiwify / Gateway Integration Readiness Card */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Integração Gateway de Pagamentos (Kiwify / Webhook Seguro)
                </h2>
                <p className="text-slate-600">
                  Recebe confirmações reais de pagamento via assinatura criptográfica HMAC-SHA256 em Edge Function dedicada, com bloqueio fail-closed até confirmação oficial do formato do gateway e sem ativar licenças sem validação transacional.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setManualPaymentInvoice(null);
                  setIsManualPaymentOpen(true);
                }}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Registrar Baixa Manual</span>
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-700">Endpoint de Webhook:</div>
              <div className="font-mono text-[11px] text-slate-900 break-all">
                {webhookEndpoint}
              </div>
              <div className="text-[11px] text-slate-500">
                Variáveis de servidor requeridas nas Edge Functions: <code>KIWIFY_WEBHOOK_SECRET</code>, <code>PAYMENT_WEBHOOK_SIGNATURE_CONFIRMED=true</code> (após homologar assinatura HMAC oficial) e <code>KIWIFY_CHECKOUT_BASE_URL</code>.
              </div>
            </div>
          </div>

          {/* Invoice Filters & Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <h3 className="font-bold text-slate-900">
                Faturas & Cobranças SaaS ({filteredInvoices.length})
              </h3>
              <select
                value={invoiceStatusFilter}
                onChange={(e) =>
                  setInvoiceStatusFilter(e.target.value as 'ALL' | SaasInvoiceStatus)
                }
                className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold"
              >
                <option value="ALL">Todos os status</option>
                <option value="paid">Pagas (Confirmadas)</option>
                <option value="pending">Pendentes</option>
                <option value="overdue">Em atraso</option>
                <option value="cancelled">Canceladas</option>
                <option value="refunded">Estornadas</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Referência</th>
                    <th className="py-3 px-4">Organização</th>
                    <th className="py-3 px-4">Plano / Ciclo</th>
                    <th className="py-3 px-4">Valor</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Pagamento / Motivo</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        Nenhuma fatura registrada no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                          {inv.referenceCode}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {inv.organizationName || inv.organizationId}
                        </td>
                        <td className="py-3 px-4">
                          {inv.planName || '—'} ·{' '}
                          <span className="font-mono uppercase text-[11px] text-slate-500">
                            {inv.billingCycle}
                          </span>
                        </td>
                        <td className="py-3 px-4 tabular-nums font-bold text-slate-900">
                          R$ {formatBrl(inv.finalAmount)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                              inv.status === 'paid'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : inv.status === 'overdue'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : inv.status === 'pending'
                                ? 'bg-sky-50 text-sky-800 border-sky-200'
                                : 'bg-slate-100 text-slate-700 border-slate-300'
                            }`}
                          >
                            {inv.status === 'paid'
                              ? 'Paga'
                              : inv.status === 'overdue'
                              ? 'Em atraso'
                              : inv.status === 'pending'
                              ? 'Pendente'
                              : inv.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-600">
                          {inv.paidAt
                            ? `Pago em ${new Date(inv.paidAt).toLocaleDateString('pt-BR')} (${
                                inv.paymentMethod || inv.paymentProvider || 'Gateway'
                              })`
                            : inv.dueDate
                            ? `Vence ${new Date(inv.dueDate).toLocaleDateString('pt-BR')}`
                            : '—'}
                          {inv.manualConfirmationReason && (
                            <span className="block text-slate-500">
                              Obs: {inv.manualConfirmationReason}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {inv.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() => {
                                setManualPaymentInvoice(inv);
                                setIsManualPaymentOpen(true);
                              }}
                              className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg"
                            >
                              Baixa Manual
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: HISTÓRICO & AUDITORIA */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center gap-3 text-xs">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Filtrar auditoria por ator, ação, clínica ou motivo..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className="flex-1 outline-none text-slate-900"
            />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Data / Hora</th>
                    <th className="py-3 px-4">Ator</th>
                    <th className="py-3 px-4">Ação</th>
                    <th className="py-3 px-4">Organização Alvo</th>
                    <th className="py-3 px-4">Motivo / Registro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-400">
                        Nenhum evento de auditoria SaaS registrado ainda.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {log.actorEmail || 'sistema'}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {log.actorRole || 'service'}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-800">{log.action}</td>
                        <td className="py-3 px-4 text-slate-700">
                          {log.targetOrganizationName || log.targetOrganizationId || 'Catálogo Global'}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{log.reason || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: DOMÍNIOS & SITES */}
      {activeTab === 'domains' && <DomainsManagement onSimulateDomain={onSimulateDomain} />}

      {/* TAB 8: SUPER ADMIN & EQUIPE */}
      {activeTab === 'team' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-purple-700" />
                  <span>Auditoria e Migração de E-mail do Super Administrador</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Atualiza o e-mail de login do Super Administrador preservando identidade, senha e papel.
                </p>
              </div>
              <button
                type="button"
                disabled={isAuditingSuperAdmin}
                onClick={() => void handleAuditSuperAdmin()}
                className="px-3.5 py-2 text-xs font-bold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl"
              >
                {isAuditingSuperAdmin ? 'Auditando...' : 'Auditar Conta Super Admin'}
              </button>
            </div>

            {superAdminCandidates.length > 0 && (
              <div className="space-y-2">
                {superAdminCandidates.map((cand) => (
                  <div
                    key={cand.profileId}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <p className="font-bold text-slate-900">
                        {cand.fullName} · <span className="text-purple-700">{cand.roleCode}</span>
                      </p>
                      <p className="text-[11px] text-slate-600 font-mono">
                        Auth: {cand.authEmail || '—'} · Perfil: {cand.profileEmail}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-slate-700">
                      {cand.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={handleUpdateSuperAdminEmail}
              className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 pt-2"
            >
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Novo E-mail do Super Administrador
                </label>
                <input
                  type="email"
                  required
                  value={targetSuperAdminEmail}
                  onChange={(e) => setTargetSuperAdminEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-600 pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireEmailConfirmation}
                  onChange={(e) => setRequireEmailConfirmation(e.target.checked)}
                />
                <span>Exigir confirmação por e-mail</span>
              </label>

              <button
                type="submit"
                disabled={isUpdatingSuperAdminEmail}
                className="px-4 py-2 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 disabled:opacity-60 rounded-xl"
              >
                {isUpdatingSuperAdminEmail ? 'Atualizando...' : 'Atualizar E-mail'}
              </button>
            </form>
          </div>

          <TeamManagement />
        </div>
      )}

      {/* Modals */}
      <PlanEditorModal
        plan={editingPlan}
        onClose={() => setEditingPlan(null)}
        onSaved={showToast}
      />

      <OrganizationDetailModal
        tenant={selectedTenant}
        plans={plans}
        invoices={invoices}
        onClose={() => setSelectedTenant(null)}
        onUpdated={showToast}
        onImpersonate={(clinicId) => {
          setSelectedTenant(null);
          impersonateClinic(clinicId);
        }}
      />

      <ManualPaymentModal
        isOpen={isManualPaymentOpen}
        invoice={manualPaymentInvoice}
        tenants={tenants}
        plans={plans}
        onClose={() => {
          setIsManualPaymentOpen(false);
          setManualPaymentInvoice(null);
        }}
        onConfirmed={showToast}
      />
    </div>
  );
};
