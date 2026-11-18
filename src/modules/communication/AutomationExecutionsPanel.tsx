import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  AutomationExecutionRecord,
  AutomationExecutionStatus,
  Branch,
  WhatsAppAutomationTrigger,
} from '../../types';
import { AUTOMATION_EXECUTION_STATUS_LABELS } from './automationHelpers';

interface AutomationExecutionsPanelProps {
  executions: AutomationExecutionRecord[];
  triggers: WhatsAppAutomationTrigger[];
  branches: Branch[];
  initialTriggerFilter?: string;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onRetryExecution: (executionId: string) => Promise<{ ok: boolean; message: string }>;
}

export const AutomationExecutionsPanel: React.FC<AutomationExecutionsPanelProps> = ({
  executions,
  triggers,
  branches,
  initialTriggerFilter = 'all',
  isRefreshing,
  onRefresh,
  onRetryExecution,
}) => {
  const [triggerFilter, setTriggerFilter] = useState<string>(initialTriggerFilter);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [appointmentFilter, setAppointmentFilter] = useState<string>('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [detailRecord, setDetailRecord] = useState<AutomationExecutionRecord | null>(null);

  const triggerMap = useMemo(() => {
    const map = new Map<string, WhatsAppAutomationTrigger>();
    triggers.forEach((t) => map.set(t.id, t));
    return map;
  }, [triggers]);

  const branchMap = useMemo(() => {
    const map = new Map<string, Branch>();
    branches.forEach((b) => map.set(b.id, b));
    return map;
  }, [branches]);

  const filteredExecutions = useMemo(() => {
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);
    const searchLower = searchQuery.trim().toLowerCase();
    const aptLower = appointmentFilter.trim().toLowerCase();

    return executions.filter((item) => {
      if (triggerFilter !== 'all' && item.triggerId !== triggerFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (branchFilter !== 'all' && item.branchId !== branchFilter) return false;

      if (periodFilter !== 'all') {
        const ts = Date.parse(item.scheduledFor);
        if (periodFilter === 'today' && !item.scheduledFor.startsWith(todayStr)) return false;
        if (periodFilter === '7d' && now - ts > 7 * 24 * 60 * 60 * 1000) return false;
        if (periodFilter === '30d' && now - ts > 30 * 24 * 60 * 60 * 1000) return false;
      }

      if (searchLower) {
        const hay = `${item.patientName} ${item.patientPhone} ${item.triggerName || ''}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }

      if (aptLower) {
        const aptHay = `${item.appointmentId || ''} ${item.appointmentLabel || ''}`.toLowerCase();
        if (!aptHay.includes(aptLower)) return false;
      }

      return true;
    });
  }, [
    executions,
    triggerFilter,
    statusFilter,
    branchFilter,
    periodFilter,
    searchQuery,
    appointmentFilter,
  ]);

  const handleRetry = async (exec: AutomationExecutionRecord) => {
    setRetryingId(exec.id);
    setFeedback(null);
    try {
      const res = await onRetryExecution(exec.id);
      setFeedback({ type: res.ok ? 'success' : 'error', text: res.message });
    } finally {
      setRetryingId(null);
    }
  };

  const getStatusBadge = (status: AutomationExecutionStatus) => {
    switch (status) {
      case 'delivered':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'sent':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'pending':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'processing':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'failed':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'cancelled':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'skipped':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const formatDateTime = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-600" />
            <span>Acompanhamento e Histórico de Envios Automáticos</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitore mensagens programadas, entregues, ignoradas por regra ou com falha de entrega.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isRefreshing}
          className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition inline-flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Atualizando...' : 'Atualizar histórico'}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
          <Filter className="w-3.5 h-3.5 text-sky-600" />
          <span>Filtros de acompanhamento</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por paciente ou telefone..."
              className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <select
            value={triggerFilter}
            onChange={(e) => setTriggerFilter(e.target.value)}
            className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todos os gatilhos</option>
            {triggers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todas as situações</option>
            {Object.entries(AUTOMATION_EXECUTION_STATUS_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={periodFilter}
            onChange={(e) =>
              setPeriodFilter(e.target.value as 'all' | 'today' | '7d' | '30d')
            }
            className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todo o período</option>
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
          </select>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todas as filiais</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={appointmentFilter}
              onChange={(e) => setAppointmentFilter(e.target.value)}
              placeholder="Filtrar por consulta ou código do agendamento..."
              className="w-72 max-w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-[11px] focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <span className="text-[11px] text-slate-500">
            Exibindo <strong>{filteredExecutions.length}</strong> de {executions.length} registro(s)
          </span>
        </div>
      </div>

      {feedback && (
        <div
          className={`mx-5 mt-4 p-3 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* List / Table */}
      {filteredExecutions.length === 0 ? (
        <div className="p-10 text-center space-y-2">
          <Send className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-xs font-semibold text-slate-700">
            Nenhum registro encontrado para os filtros aplicados.
          </p>
          <p className="text-[11px] text-slate-500">
            Altere os filtros acima para visualizar todos os envios programados e realizados.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filteredExecutions.map((exec) => {
            const trig = triggerMap.get(exec.triggerId);
            const br = exec.branchId ? branchMap.get(exec.branchId) : undefined;
            const canRetry =
              exec.status === 'failed' && exec.attemptCount < exec.maxAttempts;

            return (
              <div
                key={exec.id}
                className="p-4 hover:bg-slate-50/70 transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${getStatusBadge(
                        exec.status
                      )}`}
                    >
                      {AUTOMATION_EXECUTION_STATUS_LABELS[exec.status]}
                    </span>
                    <span className="font-bold text-slate-900">{exec.patientName}</span>
                    <span className="text-slate-500 font-mono text-[11px]">
                      {exec.patientPhone}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                      Etapa {exec.stepNumber}
                      {exec.totalSteps ? ` de ${exec.totalSteps}` : ''}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                    <span>
                      <strong>Gatilho:</strong> {exec.triggerName || trig?.name || 'Automação'}
                    </span>
                    {(exec.appointmentLabel || exec.appointmentId) && (
                      <span>
                        <strong>Consulta:</strong> {exec.appointmentLabel || exec.appointmentId}
                      </span>
                    )}
                    {(exec.branchName || br?.name) && (
                      <span>
                        <strong>Unidade:</strong> {exec.branchName || br?.name}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span>
                      <strong>Programado:</strong> {formatDateTime(exec.scheduledFor)}
                    </span>
                    <span>
                      <strong>Efetivo:</strong> {formatDateTime(exec.executedAt)}
                    </span>
                    <span>
                      <strong>Tentativas:</strong> {exec.attemptCount}/{exec.maxAttempts}
                    </span>
                  </div>

                  {exec.errorMessage && (
                    <div
                      className={`mt-1.5 p-2 rounded-lg border text-[11px] flex items-start gap-1.5 ${
                        exec.status === 'failed'
                          ? 'bg-rose-50 border-rose-200 text-rose-800'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {exec.status === 'failed' ? (
                        <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <span>{exec.errorMessage}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDetailRecord(exec)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Detalhes</span>
                  </button>

                  {canRetry && (
                    <button
                      type="button"
                      disabled={retryingId === exec.id}
                      onClick={() => void handleRetry(exec)}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                    >
                      {retryingId === exec.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      <span>Reprocessar envio</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Details Modal */}
      {detailRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Detalhes do Envio Automático</h4>
                <p className="text-[11px] text-slate-500">
                  {detailRecord.patientName} · {detailRecord.patientPhone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailRecord(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Situação</span>
                  <p className="font-bold text-slate-900 mt-0.5">
                    {AUTOMATION_EXECUTION_STATUS_LABELS[detailRecord.status]}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Etapa</span>
                  <p className="font-bold text-slate-900 mt-0.5">
                    {detailRecord.stepNumber}
                    {detailRecord.totalSteps ? ` de ${detailRecord.totalSteps}` : ''}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Data programada
                  </span>
                  <p className="text-slate-800 mt-0.5">
                    {formatDateTime(detailRecord.scheduledFor)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Data efetiva
                  </span>
                  <p className="text-slate-800 mt-0.5">
                    {formatDateTime(detailRecord.executedAt)}
                  </p>
                </div>
              </div>

              {detailRecord.renderedMessage && (
                <div>
                  <span className="text-[11px] font-bold text-slate-700 block mb-1.5">
                    Conteúdo da mensagem
                  </span>
                  <div className="p-3 rounded-xl bg-[#D9FDD3] border border-[#c6ecc0] text-slate-800 whitespace-pre-line text-[11px] leading-relaxed">
                    {detailRecord.renderedMessage}
                  </div>
                </div>
              )}

              {detailRecord.errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-[11px]">
                  <strong>Motivo registrado:</strong> {detailRecord.errorMessage}
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">
                    Controle contra envios duplicados ativo
                  </p>
                  <p className="font-mono text-[10px] text-slate-500 break-all mt-0.5">
                    Código único: {detailRecord.idempotencyKey}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
