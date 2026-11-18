import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  History,
  Link2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  AutomationExecutionRecord,
  AutomationTriggerCategory,
  AutomationTriggerStatus,
  Branch,
  Clinic,
  MessageTemplate,
  Organization,
  WhatsAppAutomationTrigger,
} from '../../types';
import { MegaapiConnectionResult } from '../../services/megaApiService';
import { StorageService } from '../../services/storage';
import {
  AUTOMATION_CATEGORY_LABELS,
  AUTOMATION_EVENT_OPTIONS,
  AUTOMATION_STATUS_LABELS,
  computeNextRunPreviewText,
  formatIntervalText,
} from './automationHelpers';
import { AutomationTriggerForm } from './AutomationTriggerForm';
import { AutomationExecutionsPanel } from './AutomationExecutionsPanel';

interface WhatsAppAutomationManagerProps {
  clinic: Clinic;
  organization: Organization;
  branches: Branch[];
  templates: MessageTemplate[];
  connectionStatus: MegaapiConnectionResult;
  n8nInboundWebhook: string;
  onSaveInboundWebhook: (url: string) => Promise<void>;
  renderPreview: (content: string) => string;
  onOpenTemplateEditor: (templateId: string) => void;
  onOpenMegaapiConfig: () => void;
}

export const WhatsAppAutomationManager: React.FC<WhatsAppAutomationManagerProps> = ({
  clinic,
  organization,
  branches,
  templates,
  connectionStatus,
  n8nInboundWebhook,
  onSaveInboundWebhook,
  renderPreview,
  onOpenTemplateEditor,
  onOpenMegaapiConfig,
}) => {
  const [triggers, setTriggers] = useState<WhatsAppAutomationTrigger[]>(() =>
    StorageService.getAutomationTriggers()
  );
  const [executions, setExecutions] = useState<AutomationExecutionRecord[]>(() =>
    StorageService.getAutomationExecutions()
  );

  const [subView, setSubView] = useState<'triggers' | 'executions' | 'form'>('triggers');
  const [editingTrigger, setEditingTrigger] = useState<WhatsAppAutomationTrigger | null>(null);
  const [execTriggerFilter, setExecTriggerFilter] = useState<string>('all');

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [busyTriggerId, setBusyTriggerId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<WhatsAppAutomationTrigger | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [bannerFeedback, setBannerFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Inbound auto-reply modal state
  const [showAutoReplySettings, setShowAutoReplySettings] = useState(false);
  const [inboundUrlDraft, setInboundUrlDraft] = useState(n8nInboundWebhook);
  const [isSavingInbound, setIsSavingInbound] = useState(false);
  const [copiedInbound, setCopiedInbound] = useState(false);

  useEffect(() => {
    setInboundUrlDraft(n8nInboundWebhook);
  }, [n8nInboundWebhook]);

  const tenantHints = useMemo(
    () => ({
      organizationId: clinic.organizationId || organization.id,
      clinicId: clinic.id,
      slug: organization.slug,
    }),
    [clinic.id, clinic.organizationId, organization.id, organization.slug]
  );

  const loadFromCloud = useCallback(async () => {
    setIsLoadingCloud(true);
    try {
      const [trigRes, execRes] = await Promise.all([
        StorageService.fetchAutomationTriggersFromCloud(tenantHints),
        StorageService.fetchAutomationExecutionsFromCloud(tenantHints),
      ]);
      setTriggers(trigRes.triggers);
      setExecutions(execRes.executions);
    } finally {
      setIsLoadingCloud(false);
    }
  }, [tenantHints]);

  useEffect(() => {
    void loadFromCloud();
  }, [loadFromCloud]);

  const templateMap = useMemo(() => {
    const map = new Map<string, MessageTemplate>();
    templates.forEach((t) => map.set(t.id, t));
    return map;
  }, [templates]);

  const branchMap = useMemo(() => {
    const map = new Map<string, Branch>();
    branches.forEach((b) => map.set(b.id, b));
    return map;
  }, [branches]);

  // KPI Metrics (Area A)
  const kpis = useMemo(() => {
    const total = triggers.length;
    const active = triggers.filter((t) => t.status === 'active').length;
    const paused = triggers.filter((t) => t.status === 'paused').length;
    const scheduled = executions.filter(
      (e) => e.status === 'pending' || e.status === 'processing'
    ).length;
    const sent = executions.filter(
      (e) => e.status === 'sent' || e.status === 'delivered'
    ).length;
    const failed = executions.filter((e) => e.status === 'failed').length;
    return { total, active, paused, scheduled, sent, failed };
  }, [triggers, executions]);

  // Filtered Triggers (Area B)
  const filteredTriggers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return triggers.filter((t) => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (branchFilter !== 'all') {
        if (branchFilter === 'global' && t.branchId) return false;
        if (branchFilter !== 'global' && t.branchId !== branchFilter) return false;
      }
      if (q) {
        const eventLabel =
          AUTOMATION_EVENT_OPTIONS.find((e) => e.value === t.eventType)?.label || '';
        const tplName = templateMap.get(t.templateId)?.name || t.templateName || '';
        const hay = `${t.name} ${t.description} ${eventLabel} ${tplName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [triggers, searchTerm, categoryFilter, statusFilter, branchFilter, templateMap]);

  const handleOpenCreate = () => {
    setEditingTrigger(null);
    setBannerFeedback(null);
    setSubView('form');
  };

  const handleOpenEdit = (trigger: WhatsAppAutomationTrigger) => {
    setEditingTrigger(trigger);
    setBannerFeedback(null);
    setSubView('form');
  };

  const handleSaveTrigger = async (
    trigger: WhatsAppAutomationTrigger,
    saveMode: 'draft' | 'activate' | 'keep'
  ) => {
    const res = await StorageService.saveAutomationTriggerToCloud(trigger, tenantHints);
    setTriggers(StorageService.getAutomationTriggers());
    setSubView('triggers');
    setEditingTrigger(null);

    const actionWord =
      saveMode === 'draft'
        ? 'salvo como rascunho'
        : saveMode === 'activate'
          ? 'salvo e ativado'
          : 'atualizado';

    setBannerFeedback({
      type: 'success',
      text: res.syncedCloud
        ? `Gatilho "${res.trigger.name}" ${actionWord} e sincronizado com a nuvem.`
        : `Gatilho "${res.trigger.name}" ${actionWord} no sistema.`,
    });
  };

  const handleToggleStatus = async (trigger: WhatsAppAutomationTrigger) => {
    const nextStatus: AutomationTriggerStatus =
      trigger.status === 'active' ? 'paused' : 'active';
    setBusyTriggerId(trigger.id);
    try {
      const res = await StorageService.toggleAutomationTriggerStatusInCloud(
        trigger.id,
        nextStatus,
        tenantHints
      );
      setTriggers(StorageService.getAutomationTriggers());
      setBannerFeedback({
        type: 'success',
        text: `Gatilho "${trigger.name}" ${
          nextStatus === 'active' ? 'ativado' : 'pausado'
        } com sucesso.${res.syncedCloud ? ' Sincronizado na nuvem.' : ''}`,
      });
    } finally {
      setBusyTriggerId(null);
    }
  };

  const handleDuplicate = async (trigger: WhatsAppAutomationTrigger) => {
    setBusyTriggerId(trigger.id);
    try {
      const res = await StorageService.duplicateAutomationTriggerToCloud(
        trigger.id,
        tenantHints
      );
      setTriggers(StorageService.getAutomationTriggers());
      setBannerFeedback({
        type: 'success',
        text: `Cópia "${res.trigger?.name || `${trigger.name} (Cópia)`}" criada em rascunho para você revisar e ativar.`,
      });
    } finally {
      setBusyTriggerId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    try {
      await StorageService.deleteAutomationTriggerFromCloud(deleteCandidate.id);
      setTriggers(StorageService.getAutomationTriggers());
      setBannerFeedback({
        type: 'success',
        text: `Gatilho "${deleteCandidate.name}" removido da lista de automações.`,
      });
      setDeleteCandidate(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleViewTriggerExecutions = (triggerId: string) => {
    setExecTriggerFilter(triggerId);
    setSubView('executions');
  };

  const handleRetryExecution = async (
    executionId: string
  ): Promise<{ ok: boolean; message: string }> => {
    const res = await StorageService.retryAutomationExecutionInCloud(executionId);
    setExecutions(StorageService.getAutomationExecutions());
    if (res.error && !res.execution) {
      return { ok: false, message: res.error };
    }
    if (res.error && res.execution?.status !== 'pending') {
      return { ok: false, message: res.error };
    }
    return {
      ok: true,
      message: res.syncedCloud
        ? 'Envio recolocado na fila de automações com proteção contra duplicidade.'
        : 'Envio recolocado na fila local para nova tentativa.',
    };
  };

  const handleSaveAutoReplyModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInbound(true);
    try {
      await onSaveInboundWebhook(inboundUrlDraft.trim());
      setShowAutoReplySettings(false);
      setBannerFeedback({
        type: 'success',
        text: 'Configuração de recebimento de respostas ("1" para confirmar) atualizada com sucesso.',
      });
    } finally {
      setIsSavingInbound(false);
    }
  };

  const getStatusBadgeClasses = (status: AutomationTriggerStatus) => {
    if (status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'paused') return 'bg-amber-50 text-amber-800 border-amber-200';
    if (status === 'draft') return 'bg-sky-50 text-sky-700 border-sky-200';
    return 'bg-slate-100 text-slate-600 border-slate-200';
  };

  const getCategoryBadgeClasses = (cat: AutomationTriggerCategory) => {
    switch (cat) {
      case 'appointment_confirmation':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'reminder':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      case 'auto_reply':
        return 'bg-indigo-50 text-indigo-800 border-indigo-200';
      case 'post_care':
        return 'bg-teal-50 text-teal-800 border-teal-200';
      case 'birthday':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  if (subView === 'form') {
    return (
      <AutomationTriggerForm
        initialTrigger={editingTrigger}
        organizationId={organization.id}
        clinicId={clinic.id}
        branches={branches}
        templates={templates}
        renderPreview={renderPreview}
        onOpenTemplateEditor={onOpenTemplateEditor}
        onSave={handleSaveTrigger}
        onCancel={() => {
          setSubView('triggers');
          setEditingTrigger(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* ÁREA A — VISÃO GERAL DAS AUTOMAÇÕES */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600" />
              <span>Gerenciador de Automações WhatsApp</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Controle confirmações, lembretes, acompanhamentos pós-consulta e felicitações com horários e regras inteligentes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAutoReplySettings(true)}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition inline-flex items-center gap-1.5"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Resposta Automática</span>
            </button>

            <button
              type="button"
              onClick={() => void loadFromCloud()}
              disabled={isLoadingCloud}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCloud ? 'animate-spin' : ''}`} />
              <span>Atualizar</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Gatilho</span>
            </button>
          </div>
        </div>

        {/* Integration Status Bar */}
        <div
          className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            connectionStatus.connected
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              : 'bg-amber-50/80 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {connectionStatus.connected ? (
              <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <div>
              <p className="font-bold">
                {connectionStatus.connected
                  ? 'Conexão WhatsApp pronta para disparos automáticos'
                  : 'Conexão WhatsApp aguardando verificação'}
                {connectionStatus.phoneNumber ? ` · ${connectionStatus.phoneNumber}` : ''}
              </p>
              <p className="text-[11px] opacity-85">
                {connectionStatus.connected
                  ? 'Os gatilhos ativos seguem a programação configurada no horário de Brasília (America/Sao_Paulo).'
                  : 'Verifique a conexão da instância para garantir o envio automático em tempo real.'}
              </p>
            </div>
          </div>

          {!connectionStatus.connected && (
            <button
              type="button"
              onClick={onOpenMegaapiConfig}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-semibold text-[11px] hover:bg-amber-100 transition shrink-0 self-start sm:self-auto"
            >
              Verificar conexão
            </button>
          )}
        </div>

        {/* 6 KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            {
              label: 'Total de gatilhos',
              value: kpis.total,
              icon: Sparkles,
              tone: 'bg-slate-50 border-slate-200 text-slate-900',
              iconColor: 'text-slate-600',
            },
            {
              label: 'Gatilhos ativos',
              value: kpis.active,
              icon: Activity,
              tone: 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
              iconColor: 'text-emerald-600',
            },
            {
              label: 'Gatilhos pausados',
              value: kpis.paused,
              icon: Pause,
              tone: 'bg-amber-50/70 border-amber-200 text-amber-900',
              iconColor: 'text-amber-600',
            },
            {
              label: 'Mensagens programadas',
              value: kpis.scheduled,
              icon: Clock,
              tone: 'bg-sky-50/70 border-sky-200 text-sky-900',
              iconColor: 'text-sky-600',
            },
            {
              label: 'Mensagens enviadas',
              value: kpis.sent,
              icon: Send,
              tone: 'bg-indigo-50/70 border-indigo-200 text-indigo-900',
              iconColor: 'text-indigo-600',
            },
            {
              label: 'Envios com falha',
              value: kpis.failed,
              icon: AlertCircle,
              tone:
                kpis.failed > 0
                  ? 'bg-rose-50/80 border-rose-200 text-rose-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700',
              iconColor: kpis.failed > 0 ? 'text-rose-600' : 'text-slate-500',
            },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className={`p-3.5 rounded-xl border ${kpi.tone}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-semibold opacity-80">{kpi.label}</span>
                  <Icon className={`w-4 h-4 ${kpi.iconColor} shrink-0`} />
                </div>
                <p className="text-xl font-extrabold tracking-tight">{kpi.value}</p>
              </div>
            );
          })}
        </div>

        {/* Sub-view Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSubView('triggers')}
              className={`px-3.5 py-2 rounded-lg transition inline-flex items-center gap-1.5 ${
                subView === 'triggers'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-emerald-600" />
              <span>Gatilhos Automáticos ({triggers.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setExecTriggerFilter('all');
                setSubView('executions');
              }}
              className={`px-3.5 py-2 rounded-lg transition inline-flex items-center gap-1.5 ${
                subView === 'executions'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5 text-sky-600" />
              <span>Acompanhamento de Envios ({executions.length})</span>
            </button>
          </div>
        </div>
      </div>

      {bannerFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            bannerFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{bannerFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerFeedback(null)}
            className="p-1 rounded hover:bg-black/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ÁREA D — PAINEL DE ACOMPANHAMENTO (EXECUÇÕES) */}
      {subView === 'executions' && (
        <AutomationExecutionsPanel
          executions={executions}
          triggers={triggers}
          branches={branches}
          initialTriggerFilter={execTriggerFilter}
          isRefreshing={isLoadingCloud}
          onRefresh={loadFromCloud}
          onRetryExecution={handleRetryExecution}
        />
      )}

      {/* ÁREA B — LISTA DE GATILHOS */}
      {subView === 'triggers' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Filters */}
          <div className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
            <div className="relative lg:col-span-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar gatilho por nome, evento ou modelo..."
                className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="all">Todas as categorias</option>
              {Object.entries(AUTOMATION_CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="all">Todas as situações</option>
              {Object.entries(AUTOMATION_STATUS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="all">Todas as filiais</option>
              <option value="global">Apenas gerais (todas unidades)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {filteredTriggers.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Zap className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-semibold text-slate-700">
                Nenhum gatilho encontrado com os filtros selecionados.
              </p>
              <button
                type="button"
                onClick={handleOpenCreate}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Criar novo gatilho</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTriggers.map((trig) => {
                const eventMeta = AUTOMATION_EVENT_OPTIONS.find(
                  (e) => e.value === trig.eventType
                );
                const tpl =
                  templateMap.get(trig.templateId) ||
                  templates.find((t) => t.category === trig.templateCategory);
                const br = trig.branchId ? branchMap.get(trig.branchId) : undefined;
                const isBusy = busyTriggerId === trig.id;
                const isTemplateInactive = Boolean(tpl && !tpl.isActive);

                return (
                  <div
                    key={trig.id}
                    className="p-4 sm:p-5 hover:bg-slate-50/70 transition space-y-3 text-xs"
                  >
                    <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                      {/* Main Info */}
                      <div className="space-y-2 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900">{trig.name}</h4>
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${getStatusBadgeClasses(
                              trig.status
                            )}`}
                          >
                            {AUTOMATION_STATUS_LABELS[trig.status]}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${getCategoryBadgeClasses(
                              trig.category
                            )}`}
                          >
                            {AUTOMATION_CATEGORY_LABELS[trig.category]}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium inline-flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            <span>{br ? br.name : 'Todas as filiais'}</span>
                          </span>
                        </div>

                        {trig.description && (
                          <p className="text-[11px] text-slate-600 leading-relaxed">
                            {trig.description}
                          </p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5 pt-1">
                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                              Evento disparador
                            </span>
                            <span className="text-[11px] font-semibold text-slate-800 block mt-0.5 truncate">
                              {eventMeta?.label || trig.eventType}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                              Modelo associado
                            </span>
                            <span className="text-[11px] font-semibold text-slate-800 block mt-0.5 truncate">
                              {tpl?.name || trig.templateName || 'Selecione um modelo'}
                            </span>
                            {isTemplateInactive && (
                              <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-1 mt-0.5">
                                <AlertTriangle className="w-3 h-3" />
                                Modelo inativo
                              </span>
                            )}
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                              Repetições
                            </span>
                            <span className="text-[11px] font-semibold text-slate-800 block mt-0.5">
                              {trig.totalSends} {trig.totalSends === 1 ? 'envio' : 'envios'}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                              Horário e janela
                            </span>
                            <span className="text-[11px] font-semibold text-slate-800 block mt-0.5">
                              {trig.preferredSendTime} · {trig.windowStart}–{trig.windowEnd}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                              Intervalo / Duração
                            </span>
                            <span className="text-[11px] font-semibold text-slate-800 block mt-0.5">
                              {trig.totalSends > 1
                                ? `${formatIntervalText(trig.intervalValue, trig.intervalUnit)} · Máx. ${trig.maxDurationDays}d`
                                : trig.leadTimeValue > 0
                                  ? `${trig.leadTimeValue} ${
                                      trig.leadTimeUnit === 'minutes'
                                        ? 'min'
                                        : trig.leadTimeUnit === 'hours'
                                          ? 'h'
                                          : 'dia(s)'
                                    } · Único`
                                  : 'Disparo único'}
                            </span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                            <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                              Próxima execução
                            </span>
                            <span className="text-[11px] font-semibold text-slate-800 flex items-center gap-1 mt-0.5 truncate">
                              <CalendarClock className="w-3 h-3 text-sky-600 shrink-0" />
                              <span className="truncate">{computeNextRunPreviewText(trig)}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap xl:flex-col items-stretch xl:items-end gap-1.5 shrink-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleOpenEdit(trig)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleToggleStatus(trig)}
                            className={`px-3 py-1.5 rounded-lg border font-semibold text-[11px] inline-flex items-center gap-1.5 transition ${
                              trig.status === 'active'
                                ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800'
                                : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : trig.status === 'active' ? (
                              <Pause className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                            <span>{trig.status === 'active' ? 'Pausar' : 'Ativar'}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDuplicate(trig)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Duplicar</span>
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewTriggerExecutions(trig.id)}
                            className="px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>Ver envios</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteCandidate(trig)}
                            className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Excluir</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal (No window.confirm) */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-slate-900">Excluir gatilho automático?</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tem certeza que deseja excluir o gatilho{' '}
                <strong>&quot;{deleteCandidate.name}&quot;</strong>? Se preferir manter o histórico
                sem disparar novas mensagens, você pode apenas pausá-lo.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteCandidate(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-semibold transition inline-flex items-center gap-1.5"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Excluir definitivamente</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Reply Inbound Webhook Modal (Cleanly tucked away from operational clutter) */}
      {showAutoReplySettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAutoReplyModal}
            className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Recebimento de Respostas Automáticas
                </h4>
                <p className="text-[11px] text-slate-500">
                  Endereço de retorno para confirmar consultas quando o paciente responde &quot;1&quot;.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAutoReplySettings(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-600" />
                    <span>Endereço de escuta de mensagens recebidas</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(inboundUrlDraft);
                      setCopiedInbound(true);
                      setTimeout(() => setCopiedInbound(false), 2000);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-1"
                  >
                    {copiedInbound ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedInbound ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                </div>

                <input
                  type="url"
                  required
                  value={inboundUrlDraft}
                  onChange={(e) => setInboundUrlDraft(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                />

                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Quando o paciente responde <strong>1</strong> no WhatsApp para confirmar a consulta, o fluxo automático atualiza a agenda para <strong>Confirmado</strong> e envia a mensagem de confirmação configurada.
                </p>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAutoReplySettings(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingInbound}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-semibold transition inline-flex items-center gap-1.5"
              >
                {isSavingInbound ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Salvar configuração</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
