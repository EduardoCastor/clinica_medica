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
} from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
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
}) => {
  const { activeBranchId, branches, organization } = useTenant();
  const { currentUser, currentRole, canViewMenu, canConsultMenu, canEditInMenu } = useAuth();
  const canOpenAppointments = canViewMenu('appointments');
  const canEditAppointments = canEditInMenu('appointments');
  const canOpenMedicalRecords = canViewMenu('medical_records') || canConsultMenu('medical_records');
  const canOpenFinancial = canViewMenu('financial');
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
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [updatingAptId, setUpdatingAptId] = useState<string | null>(null);
  const [openingRecordAptId, setOpeningRecordAptId] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [aptRes, waitRes, finRes, auditRes] = await Promise.all([
        StorageService.fetchAppointmentsFromCloudDetailed(),
        StorageService.fetchWaitlistFromCloudDetailed(activeBranchId),
        canOpenFinancial
          ? StorageService.fetchFinancialFromCloud(activeBranchId, organization.id)
          : Promise.resolve({ transactions: [] as FinancialTransaction[] }),
        canViewAuditTrail
          ? StorageService.fetchAuditLogsFromCloud(6, organization.id)
          : Promise.resolve({ logs: [] as AuditLog[] }),
      ]);

      const errors: string[] = [];
      if (aptRes.error) errors.push(`Agenda: ${aptRes.error}`);
      if (waitRes.error) errors.push(`Lista de espera: ${waitRes.error}`);
      if ('error' in finRes && finRes.error) errors.push(`Financeiro: ${finRes.error}`);

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

  const filteredFinancialPaid = useMemo(() => {
    return financial.filter((f) => {
      if (f.status !== 'paid') return false;
      if (professionalFilter !== 'all' && f.professionalId !== professionalFilter) return false;
      return isInPeriod(f.paidAt || f.dueDate || f.createdAt, periodFilter);
    });
  }, [financial, professionalFilter, periodFilter]);

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

  const totalReceivablesPeriod = filteredFinancialPaid.reduce((acc, curr) => acc + curr.amount, 0);

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
            <span className="text-xs font-medium">Recebimentos ({periodLabel[periodFilter]})</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          {canOpenFinancial ? (
            <>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-sm font-semibold text-slate-600">R$</span>
                <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {isLoading
                    ? '—'
                    : totalReceivablesPeriod.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-emerald-600 font-medium">
                {filteredFinancialPaid.length}{' '}
                {filteredFinancialPaid.length === 1 ? 'lançamento quitado' : 'lançamentos quitados'}
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
    </div>
  );
};
