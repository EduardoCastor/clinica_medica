import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar,
  Clock,
  AlertCircle,
  DollarSign,
  TrendingUp,
  UserCheck,
  Building2,
  ChevronRight,
  Loader2,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import { FinancialCloudService } from '../../services/financialCloudService';
import {
  addDaysToYmdSaoPaulo,
  computeFinancialEffectiveStatus,
  formatCurrencyPtBr,
  formatDatePtBr,
  getMonthStartEndYmd,
  getSaoPauloTodayYmd,
  isYmdWithinRange,
  normalizeDateToSaoPauloYmd,
} from '../../services/financialDateUtils';
import { FinancialSettleModal } from '../financial/FinancialSettleAndCancelModals';
import { FinancialDeepLink } from '../financial/FinancialModule';
import {
  Appointment,
  AppointmentStatus,
  AuditLog,
  FinancialTransaction,
  Patient,
  WaitlistEntry,
} from '../../types';
import { ClinicTab } from '../../components/Sidebar';

interface ClinicDashboardProps {
  onNavigateTab: (tab: ClinicTab) => void;
  onNavigateToRecord?: (patient: Patient) => void;
  onOpenFinancialTransaction?: (link: FinancialDeepLink) => void;
}

type PeriodFilter = 'today' | '7d' | 'month' | 'all';

function getLocalDateKey(dateInput: Date): string {
  return `${dateInput.getFullYear()}-${String(dateInput.getMonth() + 1).padStart(2, '0')}-${String(
    dateInput.getDate()
  ).padStart(2, '0')}`;
}

function isInPeriod(isoOrYmd: string | undefined, period: PeriodFilter): boolean {
  if (period === 'all') return true;
  if (!isoOrYmd) return false;
  const parsed = isoOrYmd.length === 10 ? new Date(`${isoOrYmd}T12:00:00`) : new Date(isoOrYmd);
  if (Number.isNaN(parsed.getTime())) return false;

  const now = new Date();
  const targetKey = getLocalDateKey(parsed);
  const todayKey = getLocalDateKey(now);

  if (period === 'today') {
    return targetKey === todayKey;
  }
  if (period === '7d') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return parsed >= start && parsed <= end;
  }
  // month
  return (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth()
  );
}

export const ClinicDashboard: React.FC<ClinicDashboardProps> = ({
  onNavigateTab,
  onNavigateToRecord,
  onOpenFinancialTransaction,
}) => {
  const { activeBranchId, branches, organization } = useTenant();
  const { currentUser, currentRole, canViewMenu, canConsultMenu, canEditInMenu } = useAuth();
  const canOpenAppointments = canViewMenu('appointments');
  const canEditAppointments = canEditInMenu('appointments');
  const canOpenMedicalRecords = canViewMenu('medical_records') || canConsultMenu('medical_records');
  const canOpenFinancial = canViewMenu('financial') || canConsultMenu('financial');
  const canEditFinancial = canEditInMenu('financial');
  const canOpenSettings = canViewMenu('settings');
  const canViewAuditTrail =
    currentRole === 'super_admin' ||
    currentRole === 'clinic_admin' ||
    currentRole === 'branch_admin';

  const professionals = StorageService.getProfessionals();

  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('today');
  const [professionalFilter, setProfessionalFilter] = useState<string>('all');

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [financial, setFinancial] = useState<FinancialTransaction[]>([]);
  const [financialError, setFinancialError] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [updatingAptId, setUpdatingAptId] = useState<string | null>(null);
  const [openingRecordAptId, setOpeningRecordAptId] = useState<string | null>(null);
  const [settlingTx, setSettlingTx] = useState<FinancialTransaction | null>(null);

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    setFinancialError('');
    try {
      const [aptRes, waitRes, finRes, auditRes] = await Promise.all([
        StorageService.fetchAppointmentsFromCloudDetailed(),
        StorageService.fetchWaitlistFromCloudDetailed(activeBranchId),
        canOpenFinancial
          ? FinancialCloudService.fetchFinancialFromCloud(activeBranchId, organization.id)
          : Promise.resolve({ transactions: [] as FinancialTransaction[] } as {
              transactions: FinancialTransaction[];
              error?: string;
            }),
        canViewAuditTrail
          ? StorageService.fetchAuditLogsFromCloud(6, organization.id)
          : Promise.resolve({ logs: [] as AuditLog[] }),
      ]);

      const errors: string[] = [];
      if (aptRes.error) errors.push(`Agenda: ${aptRes.error}`);
      if (waitRes.error) errors.push(`Lista de espera: ${waitRes.error}`);
      if ('error' in finRes && finRes.error) {
        setFinancialError(finRes.error);
        errors.push(`Financeiro: ${finRes.error}`);
      }

      setAppointments(aptRes.appointments);
      setWaitlist(waitRes.waitlist);
      setFinancial(finRes.transactions);
      setAuditLogs(auditRes.logs);
      if (errors.length > 0) {
        setLoadError(errors.join(' · '));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar dados operacionais.');
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, organization.id, canOpenFinancial, canViewAuditTrail]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const filteredAppointments = useMemo(() => {
    return appointments
      .filter((a) => {
        if (activeBranchId !== 'all' && a.branchId !== activeBranchId) return false;
        if (professionalFilter !== 'all' && a.professionalId !== professionalFilter) return false;
        return isInPeriod(a.startTime, periodFilter);
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments, activeBranchId, professionalFilter, periodFilter]);

  const todaySpYmd = getSaoPauloTodayYmd();

  const financialOverview = useMemo(() => {
    const start7d = addDaysToYmdSaoPaulo(todaySpYmd, -6);
    const monthRange = getMonthStartEndYmd(todaySpYmd);

    const isPayDateInSelectedPeriod = (payYmd: string): boolean => {
      if (!payYmd) return false;
      if (periodFilter === 'all') return true;
      if (periodFilter === 'today') return payYmd === todaySpYmd;
      if (periodFilter === '7d') return isYmdWithinRange(payYmd, start7d, todaySpYmd);
      return isYmdWithinRange(payYmd, monthRange.start, monthRange.end);
    };

    let receivablePendingTotal = 0;
    let receivablePendingCount = 0;
    let payablePendingTotal = 0;
    let payablePendingCount = 0;
    let receivableOverdueTotal = 0;
    let receivableOverdueCount = 0;
    let payableOverdueTotal = 0;
    let payableOverdueCount = 0;
    let receivedPeriodTotal = 0;
    let receivedPeriodCount = 0;
    let paidPeriodTotal = 0;
    let paidPeriodCount = 0;

    const receivablesDueToday: FinancialTransaction[] = [];
    const payablesDueToday: FinancialTransaction[] = [];
    const overdueObligations: FinancialTransaction[] = [];

    for (const tx of financial) {
      const effective = computeFinancialEffectiveStatus(tx, todaySpYmd);
      const dueYmd = normalizeDateToSaoPauloYmd(tx.dueDate);
      const payYmd = normalizeDateToSaoPauloYmd(tx.paymentDate || tx.paidAt);

      if (tx.type === 'receivable') {
        if (effective === 'pending' || effective === 'overdue') {
          receivablePendingTotal += tx.amount;
          receivablePendingCount += 1;
        }
        if (effective === 'overdue') {
          receivableOverdueTotal += tx.amount;
          receivableOverdueCount += 1;
          overdueObligations.push(tx);
        } else if (effective === 'pending' && dueYmd === todaySpYmd) {
          receivablesDueToday.push(tx);
        } else if (effective === 'paid' && isPayDateInSelectedPeriod(payYmd)) {
          receivedPeriodTotal += tx.amount;
          receivedPeriodCount += 1;
        }
      } else {
        if (effective === 'pending' || effective === 'overdue') {
          payablePendingTotal += tx.amount;
          payablePendingCount += 1;
        }
        if (effective === 'overdue') {
          payableOverdueTotal += tx.amount;
          payableOverdueCount += 1;
          overdueObligations.push(tx);
        } else if (effective === 'pending' && dueYmd === todaySpYmd) {
          payablesDueToday.push(tx);
        } else if (effective === 'paid' && isPayDateInSelectedPeriod(payYmd)) {
          paidPeriodTotal += tx.amount;
          paidPeriodCount += 1;
        }
      }
    }

    overdueObligations.sort((a, b) =>
      (normalizeDateToSaoPauloYmd(a.dueDate) || '').localeCompare(
        normalizeDateToSaoPauloYmd(b.dueDate) || ''
      )
    );

    return {
      receivablePendingTotal,
      receivablePendingCount,
      payablePendingTotal,
      payablePendingCount,
      receivableOverdueTotal,
      receivableOverdueCount,
      payableOverdueTotal,
      payableOverdueCount,
      receivedPeriodTotal,
      receivedPeriodCount,
      paidPeriodTotal,
      paidPeriodCount,
      receivablesDueToday,
      payablesDueToday,
      overdueObligations,
    };
  }, [financial, todaySpYmd, periodFilter]);

  // Real Status counters
  const totalInPeriod = filteredAppointments.length;
  const confirmedCount = filteredAppointments.filter((a) => a.status === 'confirmed').length;
  const inWaitingRoom = filteredAppointments.filter((a) => a.status === 'waiting_room').length;
  const inConsultation = filteredAppointments.filter((a) => a.status === 'in_consultation').length;
  const completedCount = filteredAppointments.filter((a) => a.status === 'completed').length;
  const noShowCount = filteredAppointments.filter((a) => a.status === 'no_show').length;
  const cancelledCount = filteredAppointments.filter((a) => a.status === 'cancelled').length;

  const adherencePercent =
    totalInPeriod > 0
      ? Math.round(
          ((confirmedCount + inWaitingRoom + inConsultation + completedCount) / totalInPeriod) *
            100
        )
      : null;

  const periodLabel: Record<PeriodFilter, string> = {
    today: 'Hoje',
    '7d': 'Últimos 7 dias',
    month: 'Mês Atual',
    all: 'Todo o Período',
  };

  const handleUpdateStatus = async (id: string, status: AppointmentStatus) => {
    setActionError('');
    setUpdatingAptId(id);
    const res = await StorageService.updateAppointmentStatusInCloud(id, status);
    setUpdatingAptId(null);
    if (!res.success) {
      setActionError(res.error || 'Não foi possível atualizar o status da consulta.');
      return;
    }
    setAppointments((prev) =>
      prev.map((apt) => (apt.id === id ? { ...apt, status } : apt))
    );
  };

  const handleOpenPatientRecord = async (apt: Appointment) => {
    if (!onNavigateToRecord) {
      onNavigateTab('medical_records');
      return;
    }
    setActionError('');
    if (apt.patientId) {
      setOpeningRecordAptId(apt.id);
      const patientRes = await ClinicalCloudService.fetchPatientByIdFromCloud(apt.patientId);
      setOpeningRecordAptId(null);
      if (patientRes.patient) {
        onNavigateToRecord(patientRes.patient);
        return;
      }
      if (patientRes.error) {
        setActionError(patientRes.error);
        return;
      }
    }
    onNavigateTab('medical_records');
  };

  const statusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'in_consultation':
        return (
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            Em Atendimento
          </span>
        );
      case 'waiting_room':
        return (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
            Na Sala de Espera
          </span>
        );
      case 'confirmed':
        return (
          <span className="text-xs font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
            Confirmado
          </span>
        );
      case 'completed':
        return (
          <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            Concluído
          </span>
        );
      case 'no_show':
        return (
          <span className="text-xs font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
            Faltou
          </span>
        );
      case 'cancelled':
        return (
          <span className="text-xs font-semibold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">
            Cancelado
          </span>
        );
      default:
        return (
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
            Agendado
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Painel Operacional da Clínica
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Olá, <strong className="text-slate-800">{currentUser.fullName}</strong> ({currentRole}) ·{' '}
            {activeBranchId === 'all'
              ? 'Visão Consolidada de Todas as Filiais'
              : `Filtrado para ${branches.find((b) => b.id === activeBranchId)?.name || 'Unidade'}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filtrar período do painel"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="month">Mês Atual</option>
            <option value="all">Todo o Período</option>
          </select>

          <select
            aria-label="Filtrar profissional"
            value={professionalFilter}
            onChange={(e) => setProfessionalFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todos os Profissionais</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void loadDashboardData()}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          {canOpenAppointments && (
            <button
              onClick={() => onNavigateTab('appointments')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition flex items-center gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Ver Agenda Completa</span>
            </button>
          )}
        </div>
      </div>

      {(loadError || actionError) && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError || loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboardData()}
            className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-rose-200 rounded-lg hover:bg-rose-100 inline-flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Agendados ({periodLabel[periodFilter]})</span>
            <Calendar className="w-4 h-4 text-sky-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {isLoading ? '—' : totalInPeriod}
            </span>
            <span className="text-xs text-slate-500">consultas</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
            <span>{confirmedCount} confirmadas</span>
            <span aria-hidden="true">·</span>
            <span>{inWaitingRoom} em espera</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Na Sala de Espera</span>
            <UserCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-amber-600 tabular-nums">
              {isLoading ? '—' : inWaitingRoom}
            </span>
            <span className="text-xs text-slate-500">aguardando atendimento</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {inConsultation > 0 ? `${inConsultation} já no consultório` : 'Nenhum atendimento em curso'}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Taxa de Presença</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {isLoading || adherencePercent === null ? '—' : `${adherencePercent}%`}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {adherencePercent === null
                ? 'Sem consultas no período'
                : adherencePercent >= 80
                  ? 'alta adesão'
                  : 'acompanhamento'}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {noShowCount} faltas · {cancelledCount} cancelados
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Recebido ({periodLabel[periodFilter]})</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          {canOpenFinancial ? (
            <>
              <div className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">
                {isLoading ? '—' : formatCurrencyPtBr(financialOverview.receivedPeriodTotal)}
              </div>
              <div className="mt-2 text-[11px] text-emerald-600 font-medium">
                {financialOverview.receivedPeriodCount}{' '}
                {financialOverview.receivedPeriodCount === 1
                  ? 'recebimento conciliado'
                  : 'recebimentos conciliados'}
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-sm font-bold text-slate-400">Acesso Restrito</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Disponível para perfil financeiro
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resumo Financeiro Real (Visível apenas para perfis autorizados ao Financeiro) */}
      {canOpenFinancial && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                Obrigações Financeiras & Acompanhamento ({periodLabel[periodFilter]})
              </h2>
              <p className="text-[11px] text-slate-500">
                Totais reais persistidos no Supabase · Vencimentos e baixas em horário de Brasília ({formatDatePtBr(todaySpYmd)}).
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('financial')}
              className="text-xs font-semibold text-sky-700 hover:text-sky-800 inline-flex items-center gap-1 self-start sm:self-auto"
            >
              <span>Abrir Módulo Financeiro</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {financialError && financial.length === 0 ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Erro ao carregar o resumo financeiro: {financialError}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadDashboardData()}
                className="px-3 py-1.5 bg-white border border-rose-200 rounded-lg font-semibold hover:bg-rose-100 inline-flex items-center gap-1 shrink-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Tentar novamente</span>
              </button>
            </div>
          ) : (
            <>
              {/* 6 Financial KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium">
                    <span>A Receber Pendente</span>
                    <ArrowDownLeft className="w-3.5 h-3.5 text-sky-600" />
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-slate-900 tabular-nums">
                    {isLoading ? '—' : formatCurrencyPtBr(financialOverview.receivablePendingTotal)}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {financialOverview.receivablePendingCount} título(s)
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium">
                    <span>A Pagar Pendente</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-slate-900 tabular-nums">
                    {isLoading ? '—' : formatCurrencyPtBr(financialOverview.payablePendingTotal)}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {financialOverview.payablePendingCount} título(s)
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-rose-200 shadow-xs">
                  <div className="flex items-center justify-between text-rose-700 text-[11px] font-semibold">
                    <span>Receitas Vencidas</span>
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-rose-700 tabular-nums">
                    {isLoading ? '—' : formatCurrencyPtBr(financialOverview.receivableOverdueTotal)}
                  </div>
                  <p className="text-[10px] text-rose-600 mt-0.5">
                    {financialOverview.receivableOverdueCount} em atraso
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-rose-200 shadow-xs">
                  <div className="flex items-center justify-between text-rose-700 text-[11px] font-semibold">
                    <span>Despesas Vencidas</span>
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-rose-700 tabular-nums">
                    {isLoading ? '—' : formatCurrencyPtBr(financialOverview.payableOverdueTotal)}
                  </div>
                  <p className="text-[10px] text-rose-600 mt-0.5">
                    {financialOverview.payableOverdueCount} em atraso
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-emerald-200/80 shadow-xs">
                  <div className="flex items-center justify-between text-emerald-700 text-[11px] font-semibold">
                    <span>Recebido ({periodLabel[periodFilter]})</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-emerald-700 tabular-nums">
                    {isLoading ? '—' : formatCurrencyPtBr(financialOverview.receivedPeriodTotal)}
                  </div>
                  <p className="text-[10px] text-emerald-700 mt-0.5">
                    {financialOverview.receivedPeriodCount} baixa(s)
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-600 text-[11px] font-medium">
                    <span>Pago ({periodLabel[periodFilter]})</span>
                    <DollarSign className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-slate-900 tabular-nums">
                    {isLoading ? '—' : formatCurrencyPtBr(financialOverview.paidPeriodTotal)}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {financialOverview.paidPeriodCount} baixa(s)
                  </p>
                </div>
              </div>

              {/* Highlight Lists: Receivables Today, Payables Today, Overdue */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Contas a Receber Hoje */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                      <h3 className="text-xs font-bold text-slate-900">
                        Contas a Receber Hoje ({financialOverview.receivablesDueToday.length})
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenFinancialTransaction
                          ? onOpenFinancialTransaction({ tab: 'receivable' })
                          : onNavigateTab('financial')
                      }
                      className="text-[11px] font-semibold text-sky-600 hover:text-sky-700"
                    >
                      Ver todas
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100 flex-1">
                    {isLoading ? (
                      <div className="p-6 text-center text-xs text-slate-400">Carregando...</div>
                    ) : financialOverview.receivablesDueToday.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        Nenhuma conta a receber com vencimento hoje.
                      </div>
                    ) : (
                      financialOverview.receivablesDueToday.slice(0, 5).map((tx) => (
                        <div key={tx.id} className="p-3.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">{tx.description}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {tx.patientName || 'Cliente avulso'} · {tx.branchName}
                            </p>
                            <p className="text-[11px] font-extrabold text-emerald-700 tabular-nums mt-0.5">
                              {formatCurrencyPtBr(tx.amount)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {canEditFinancial && (
                              <button
                                type="button"
                                onClick={() => setSettlingTx(tx)}
                                className="px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg"
                              >
                                Receber
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFinancialTransaction
                                  ? onOpenFinancialTransaction({ transactionId: tx.id, tab: tx.type })
                                  : onNavigateTab('financial')
                              }
                              className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg"
                              title="Abrir no Financeiro"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Contas a Pagar Hoje */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-amber-600" />
                      <h3 className="text-xs font-bold text-slate-900">
                        Contas a Pagar Hoje ({financialOverview.payablesDueToday.length})
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenFinancialTransaction
                          ? onOpenFinancialTransaction({ tab: 'payable' })
                          : onNavigateTab('financial')
                      }
                      className="text-[11px] font-semibold text-sky-600 hover:text-sky-700"
                    >
                      Ver todas
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100 flex-1">
                    {isLoading ? (
                      <div className="p-6 text-center text-xs text-slate-400">Carregando...</div>
                    ) : financialOverview.payablesDueToday.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        Nenhuma conta a pagar com vencimento hoje.
                      </div>
                    ) : (
                      financialOverview.payablesDueToday.slice(0, 5).map((tx) => (
                        <div key={tx.id} className="p-3.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">{tx.description}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {tx.supplierName || tx.categoryName || 'Fornecedor'} · {tx.branchName}
                            </p>
                            <p className="text-[11px] font-extrabold text-rose-700 tabular-nums mt-0.5">
                              {formatCurrencyPtBr(tx.amount)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {canEditFinancial && (
                              <button
                                type="button"
                                onClick={() => setSettlingTx(tx)}
                                className="px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg"
                              >
                                Pagar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFinancialTransaction
                                  ? onOpenFinancialTransaction({ transactionId: tx.id, tab: tx.type })
                                  : onNavigateTab('financial')
                              }
                              className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg"
                              title="Abrir no Financeiro"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Contas Vencidas */}
                <div className="bg-white rounded-2xl border border-rose-200/80 shadow-xs overflow-hidden flex flex-col">
                  <div className="px-4 py-3 border-b border-rose-100 bg-rose-50/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                      <h3 className="text-xs font-bold text-rose-900">
                        Contas Vencidas ({financialOverview.overdueObligations.length})
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigateTab('financial')}
                      className="text-[11px] font-semibold text-rose-700 hover:text-rose-900"
                    >
                      Gerenciar
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100 flex-1">
                    {isLoading ? (
                      <div className="p-6 text-center text-xs text-slate-400">Carregando...</div>
                    ) : financialOverview.overdueObligations.length === 0 ? (
                      <div className="p-6 text-center text-xs text-emerald-700">
                        Nenhuma conta vencida em aberto.
                      </div>
                    ) : (
                      financialOverview.overdueObligations.slice(0, 5).map((tx) => (
                        <div key={tx.id} className="p-3.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  tx.type === 'receivable'
                                    ? 'bg-sky-100 text-sky-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {tx.type === 'receivable' ? 'Receber' : 'Pagar'}
                              </span>
                              <p className="font-bold text-slate-900 truncate">{tx.description}</p>
                            </div>
                            <p className="text-[11px] text-rose-700 mt-0.5">
                              Venceu em {formatDatePtBr(tx.dueDate)} ·{' '}
                              {tx.type === 'receivable'
                                ? tx.patientName || 'Avulso'
                                : tx.supplierName || tx.categoryName || 'Despesa'}
                            </p>
                            <p className="text-[11px] font-extrabold text-slate-900 tabular-nums mt-0.5">
                              {formatCurrencyPtBr(tx.amount)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {canEditFinancial && (
                              <button
                                type="button"
                                onClick={() => setSettlingTx(tx)}
                                className="px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg"
                              >
                                {tx.type === 'receivable' ? 'Receber' : 'Pagar'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFinancialTransaction
                                  ? onOpenFinancialTransaction({ transactionId: tx.id, tab: tx.type })
                                  : onNavigateTab('financial')
                              }
                              className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg"
                              title="Abrir no Financeiro"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main Grid: Atendimentos & Lista de Espera / Filiais */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Atendimentos do Período (Col 1 & 2) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Consultas e Atendimentos ({periodLabel[periodFilter]})
              </h2>
            </div>
            {canOpenAppointments && (
              <button
                onClick={() => onNavigateTab('appointments')}
                className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1"
              >
                <span>Gerenciar</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                <span>Carregando atendimentos do Supabase...</span>
              </div>
            ) : filteredAppointments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Nenhuma consulta agendada para este filtro de unidade/período.
              </div>
            ) : (
              filteredAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        {periodFilter === 'today'
                          ? new Date(apt.startTime).toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : `${new Date(apt.startTime).toLocaleDateString('pt-BR')} · ${new Date(
                              apt.startTime
                            ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs font-bold text-slate-800">{apt.patientName}</span>
                      {statusBadge(apt.status)}
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                      <span>{apt.professionalName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{apt.serviceName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{apt.roomName || 'Consultório'}</span>
                    </div>
                    {apt.notes && (
                      <p className="text-[11px] text-slate-600 italic">"{apt.notes}"</p>
                    )}
                  </div>

                  {/* Quick Workflow Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {canEditAppointments && apt.status === 'confirmed' && (
                      <button
                        disabled={updatingAptId === apt.id}
                        onClick={() => void handleUpdateStatus(apt.id, 'waiting_room')}
                        className="px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition disabled:opacity-50"
                      >
                        Chegou na Clínica
                      </button>
                    )}
                    {canEditAppointments && apt.status === 'waiting_room' && (
                      <button
                        disabled={updatingAptId === apt.id}
                        onClick={() => void handleUpdateStatus(apt.id, 'in_consultation')}
                        className="px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition disabled:opacity-50"
                      >
                        Iniciar Consulta
                      </button>
                    )}
                    {canEditAppointments && apt.status === 'in_consultation' && (
                      <button
                        disabled={updatingAptId === apt.id}
                        onClick={() => void handleUpdateStatus(apt.id, 'completed')}
                        className="px-2.5 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition disabled:opacity-50"
                      >
                        Finalizar Consulta
                      </button>
                    )}
                    {canEditAppointments && apt.status === 'scheduled' && (
                      <button
                        disabled={updatingAptId === apt.id}
                        onClick={() => void handleUpdateStatus(apt.id, 'confirmed')}
                        className="px-2.5 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                    )}
                    {canOpenMedicalRecords && (
                      <button
                        disabled={openingRecordAptId === apt.id}
                        onClick={() => void handleOpenPatientRecord(apt)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition inline-flex items-center gap-1 disabled:opacity-50"
                        title="Abrir Prontuário do Paciente"
                      >
                        {openingRecordAptId === apt.id && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        <span>Prontuário</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sidebar Widgets: Filiais, Lista de Espera & Auditoria (Col 3) */}
        <div className="space-y-6">
          {/* Filiais Cadastradas */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-sky-600" />
                <h3 className="text-xs font-bold text-slate-900">Unidades da Rede</h3>
              </div>
              {canOpenSettings && (
                <button
                  onClick={() => onNavigateTab('settings')}
                  className="text-[11px] font-semibold text-sky-600 hover:text-sky-700"
                >
                  Gerenciar
                </button>
              )}
            </div>

            {branches.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-2">
                Nenhuma filial cadastrada.
              </p>
            ) : (
              <div className="space-y-2.5">
                {branches.map((b) => (
                  <div
                    key={b.id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-bold text-slate-800">
                      <span>{b.name}</span>
                      {b.isHeadquarters && (
                        <span className="text-[10px] text-sky-700 bg-sky-100/70 px-1.5 py-0.5 rounded font-semibold">
                          Matriz
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {b.street}, {b.number} · {b.neighborhood}, {b.city}/{b.state}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span>{b.phone}</span>
                      <span className="text-teal-700 font-medium">
                        {b.patientSharingMode === 'model_b'
                          ? 'Modelo B: Compartilhado'
                          : 'Modelo A: Exclusivo'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lista de Espera Rápida */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-bold text-slate-900">Lista de Espera Ativa</h3>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">
                {waitlist.length} aguardando
              </span>
            </div>

            {isLoading ? (
              <div className="py-3 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Carregando fila...</span>
              </div>
            ) : waitlist.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-2">
                Nenhum paciente na fila de espera no momento.
              </p>
            ) : (
              <div className="space-y-2">
                {waitlist.map((w) => (
                  <div
                    key={w.id}
                    className="p-2.5 bg-amber-50/50 rounded-xl border border-amber-100 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{w.patientName}</span>
                      <span className="text-[10px] text-amber-800 font-medium capitalize">
                        {w.preferredPeriod}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Dias preferidos: {w.preferredDays.join(', ') || 'Flexível'}
                    </p>
                    {w.notes && (
                      <p className="text-[10px] text-slate-500 italic">"{w.notes}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Auditoria LGPD Recente (somente perfis autorizados por RLS) */}
          {canViewAuditTrail && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-900">Trilha de Auditoria LGPD</span>
                <span className="text-[10px] text-emerald-600 font-medium">Imutável</span>
              </div>
              {isLoading ? (
                <div className="py-3 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Carregando auditoria...</span>
                </div>
              ) : auditLogs.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">
                  Nenhum evento de auditoria registrado recentemente.
                </p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="text-[11px] text-slate-600 space-y-0.5">
                      <div className="flex items-center justify-between text-slate-700">
                        <strong className="font-semibold">{log.userName}</strong>
                        <span className="text-[10px] text-slate-400">
                          {new Date(log.timestamp).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-slate-500">
                        {log.action} · {log.entity}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Quick Settle Modal from Dashboard */}
      <FinancialSettleModal
        transaction={settlingTx}
        onClose={() => setSettlingTx(null)}
        onSettled={loadDashboardData}
      />
    </div>
  );
};
