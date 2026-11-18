import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AutomationEventType,
  AutomationIntervalUnit,
  AutomationLeadTimeUnit,
  AutomationOutsideWindowPolicy,
  AutomationScheduleMode,
  AutomationStepDefinition,
  AutomationTriggerCategory,
  AutomationTriggerStatus,
  AutomationWeekday,
  Branch,
  MessageTemplate,
  WhatsAppAutomationTrigger,
} from '../../types';
import {
  AUTOMATION_CATEGORY_LABELS,
  AUTOMATION_EVENT_OPTIONS,
  AUTOMATION_STATUS_LABELS,
  INTERVAL_UNIT_LABELS,
  PREFERRED_TIME_PRESETS,
  WEEKDAY_OPTIONS,
  describeTriggerScheduleSummary,
  intervalToMinutes,
  isTemplateCompatibleWithTrigger,
  validateRepeatDurationCompatibility,
} from './automationHelpers';

interface AutomationTriggerFormProps {
  initialTrigger: WhatsAppAutomationTrigger | null;
  organizationId: string;
  clinicId?: string;
  branches: Branch[];
  templates: MessageTemplate[];
  renderPreview: (content: string) => string;
  onOpenTemplateEditor: (templateId: string) => void;
  onSave: (
    trigger: WhatsAppAutomationTrigger,
    saveMode: 'draft' | 'activate' | 'keep'
  ) => Promise<void>;
  onCancel: () => void;
}

const DEFAULT_DAYS: AutomationWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function buildStepSchedule(
  totalSends: number,
  intervalValue: number,
  intervalUnit: AutomationIntervalUnit,
  scheduleMode: AutomationScheduleMode,
  leadTimeValue: number,
  leadTimeUnit: AutomationLeadTimeUnit,
  preferredSendTime: string
): AutomationStepDefinition[] {
  const baseLeadMinutes =
    leadTimeUnit === 'minutes'
      ? leadTimeValue
      : leadTimeUnit === 'hours'
        ? leadTimeValue * 60
        : leadTimeValue * 24 * 60;
  const intervalMinutes = intervalToMinutes(intervalValue, intervalUnit);

  return Array.from({ length: Math.max(1, totalSends) }, (_, idx) => {
    const stepNumber = idx + 1;
    const offsetMinutes = baseLeadMinutes + idx * intervalMinutes;
    const label =
      idx === 0
        ? scheduleMode === 'fixed_time'
          ? `1º envio às ${preferredSendTime}`
          : baseLeadMinutes === 0
            ? '1º envio imediato'
            : `1º envio (${leadTimeValue} ${leadTimeUnit === 'minutes' ? 'min' : leadTimeUnit === 'hours' ? 'h' : 'dia(s)'})`
        : `${stepNumber}º envio (+${idx * intervalValue} ${
            intervalUnit === 'minutes'
              ? 'min'
              : intervalUnit === 'hours'
                ? 'h'
                : intervalUnit === 'days'
                  ? 'dia(s)'
                  : 'sem.'
          })`;
    return {
      stepNumber,
      offsetMinutes,
      label,
    };
  });
}

export const AutomationTriggerForm: React.FC<AutomationTriggerFormProps> = ({
  initialTrigger,
  organizationId,
  clinicId,
  branches,
  templates,
  renderPreview,
  onOpenTemplateEditor,
  onSave,
  onCancel,
}) => {
  const activeCompatibleTemplates = useMemo(
    () => templates.filter(isTemplateCompatibleWithTrigger),
    [templates]
  );

  const defaultTemplateId =
    initialTrigger?.templateId || activeCompatibleTemplates[0]?.id || templates[0]?.id || '';

  const [name, setName] = useState(initialTrigger?.name || '');
  const [description, setDescription] = useState(initialTrigger?.description || '');
  const [category, setCategory] = useState<AutomationTriggerCategory>(
    initialTrigger?.category || 'reminder'
  );
  const [status, setStatus] = useState<AutomationTriggerStatus>(initialTrigger?.status || 'active');
  const [branchId, setBranchId] = useState<string>(initialTrigger?.branchId || 'all');

  const [eventType, setEventType] = useState<AutomationEventType>(
    initialTrigger?.eventType || 'appointment_upcoming'
  );
  const [templateId, setTemplateId] = useState<string>(defaultTemplateId);

  const [totalSends, setTotalSends] = useState<number>(initialTrigger?.totalSends || 1);
  const [isCustomSends, setIsCustomSends] = useState<boolean>(
    (initialTrigger?.totalSends || 1) > 5
  );
  const [preferredSendTime, setPreferredSendTime] = useState<string>(
    initialTrigger?.preferredSendTime || '09:00'
  );
  const [intervalValue, setIntervalValue] = useState<number>(
    initialTrigger?.intervalValue ?? 24
  );
  const [intervalUnit, setIntervalUnit] = useState<AutomationIntervalUnit>(
    initialTrigger?.intervalUnit || 'hours'
  );
  const [maxDurationDays, setMaxDurationDays] = useState<number>(
    initialTrigger?.maxDurationDays ?? 7
  );
  const [scheduleMode, setScheduleMode] = useState<AutomationScheduleMode>(
    initialTrigger?.scheduleMode || 'relative'
  );
  const [leadTimeValue, setLeadTimeValue] = useState<number>(initialTrigger?.leadTimeValue ?? 24);
  const [leadTimeUnit, setLeadTimeUnit] = useState<AutomationLeadTimeUnit>(
    initialTrigger?.leadTimeUnit || 'hours'
  );
  const [allowedDays, setAllowedDays] = useState<AutomationWeekday[]>(
    initialTrigger?.allowedDays?.length ? initialTrigger.allowedDays : DEFAULT_DAYS
  );
  const [windowStart, setWindowStart] = useState<string>(initialTrigger?.windowStart || '08:00');
  const [windowEnd, setWindowEnd] = useState<string>(initialTrigger?.windowEnd || '20:00');
  const [timezone] = useState<string>(initialTrigger?.timezone || 'America/Sao_Paulo');
  const [outsideWindowPolicy, setOutsideWindowPolicy] = useState<AutomationOutsideWindowPolicy>(
    initialTrigger?.outsideWindowPolicy || 'next_allowed_window'
  );

  const [smartRules, setSmartRules] = useState(
    initialTrigger?.smartRules || {
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
    }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const selectedEventMeta =
    AUTOMATION_EVENT_OPTIONS.find((opt) => opt.value === eventType) || AUTOMATION_EVENT_OPTIONS[0];
  const selectedTemplate =
    activeCompatibleTemplates.find((t) => t.id === templateId) ||
    templates.find((t) => t.id === templateId);
  const isSelectedTemplateInactive = Boolean(selectedTemplate && !selectedTemplate.isActive);

  const compatibilityCheck = useMemo(
    () =>
      validateRepeatDurationCompatibility(
        totalSends,
        intervalValue,
        intervalUnit,
        maxDurationDays
      ),
    [totalSends, intervalValue, intervalUnit, maxDurationDays]
  );

  const windowError = useMemo(() => {
    if (!windowStart || !windowEnd) return 'Informe o horário de início e fim da janela.';
    if (windowStart >= windowEnd) {
      return 'O horário inicial da janela deve ser menor que o horário final.';
    }
    if (allowedDays.length === 0) {
      return 'Selecione ao menos um dia da semana permitido para envio.';
    }
    return null;
  }, [windowStart, windowEnd, allowedDays]);

  const readableSummary = useMemo(
    () =>
      describeTriggerScheduleSummary(
        {
          name: name.trim() || 'Novo gatilho',
          eventType,
          totalSends,
          intervalValue,
          intervalUnit,
          maxDurationDays,
          scheduleMode,
          leadTimeValue,
          leadTimeUnit,
          preferredSendTime,
          allowedDays,
          windowStart,
          windowEnd,
          outsideWindowPolicy,
          smartRules,
        },
        selectedTemplate?.name
      ),
    [
      name,
      eventType,
      totalSends,
      intervalValue,
      intervalUnit,
      maxDurationDays,
      scheduleMode,
      leadTimeValue,
      leadTimeUnit,
      preferredSendTime,
      allowedDays,
      windowStart,
      windowEnd,
      outsideWindowPolicy,
      smartRules,
      selectedTemplate?.name,
    ]
  );

  const handleToggleDay = (day: AutomationWeekday) => {
    setAllowedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async (saveMode: 'draft' | 'activate' | 'keep') => {
    setValidationError(null);

    if (!name.trim()) {
      setValidationError('Informe um nome identificador para este gatilho.');
      return;
    }
    if (!selectedTemplate || !selectedTemplate.isActive) {
      setValidationError('Selecione um modelo de mensagem ativo antes de salvar.');
      return;
    }
    if (totalSends < 1 || totalSends > 50) {
      setValidationError('A quantidade total de envios deve ser entre 1 e 50.');
      return;
    }
    if (totalSends > 1 && !compatibilityCheck.valid) {
      setValidationError(
        compatibilityCheck.warning ||
          'Ajuste a duração máxima ou o intervalo para comportar todos os envios configurados.'
      );
      return;
    }
    if (windowError) {
      setValidationError(windowError);
      return;
    }

    const finalStatus: AutomationTriggerStatus =
      saveMode === 'draft' ? 'draft' : saveMode === 'activate' ? 'active' : status;

    const nowIso = new Date().toISOString();
    const id =
      initialTrigger?.id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `trig_custom_${Date.now()}`);

    const payload: WhatsAppAutomationTrigger = {
      id,
      organizationId,
      clinicId,
      branchId: branchId === 'all' ? null : branchId,
      triggerCode: initialTrigger?.triggerCode,
      name: name.trim(),
      description: description.trim(),
      category,
      eventType,
      templateId: selectedTemplate.id,
      templateName: selectedTemplate.name,
      templateCategory: selectedTemplate.category,
      status: finalStatus,
      totalSends,
      intervalValue,
      intervalUnit,
      maxDurationDays,
      scheduleMode,
      leadTimeValue,
      leadTimeUnit,
      preferredSendTime,
      allowedDays,
      windowStart,
      windowEnd,
      timezone,
      outsideWindowPolicy,
      smartRules,
      stepSchedule: buildStepSchedule(
        totalSends,
        intervalValue,
        intervalUnit,
        scheduleMode,
        leadTimeValue,
        leadTimeUnit,
        preferredSendTime
      ),
      createdAt: initialTrigger?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    setIsSubmitting(true);
    try {
      await onSave(payload, saveMode);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
            title="Voltar para a lista de gatilhos"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {initialTrigger ? 'Editar Gatilho Automático' : 'Criar Novo Gatilho Automático'}
            </h3>
            <p className="text-xs text-slate-500">
              Configure o evento, o modelo ativo, o ritmo de envios e as regras de proteção ao paciente.
            </p>
          </div>
        </div>
        <span className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 self-start sm:self-auto">
          Fuso padrão: Brasília (America/Sao_Paulo)
        </span>
      </div>

      <div className="p-6 space-y-6 text-xs">
        {validationError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Revise antes de salvar</p>
              <p className="text-[11px] mt-0.5">{validationError}</p>
            </div>
          </div>
        )}

        {/* SEÇÃO 1 — IDENTIFICAÇÃO */}
        <section className="rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
              1
            </span>
            <div>
              <h4 className="font-bold text-slate-900 text-xs">Identificação</h4>
              <p className="text-[11px] text-slate-500">
                Defina nome, categoria, situação inicial e abrangência nas filiais.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Nome do gatilho *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Acompanhamento semanal pós-protocolo"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Descrição</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva em poucas palavras o objetivo desta automação para sua equipe."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AutomationTriggerCategory)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {Object.entries(AUTOMATION_CATEGORY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Situação</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AutomationTriggerStatus)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {Object.entries(AUTOMATION_STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-sky-600" />
                <span>Aplicação nas unidades</span>
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="all">Todas as filiais da clínica</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Somente {b.name} ({b.city}/{b.state})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* SEÇÃO 2 — EVENTO DISPARADOR */}
        <section className="rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
              2
            </span>
            <div>
              <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-sky-600" />
                <span>Evento disparador</span>
              </h4>
              <p className="text-[11px] text-slate-500">
                Escolha qual acontecimento na clínica inicia este gatilho automaticamente.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {AUTOMATION_EVENT_OPTIONS.map((opt) => {
              const selected = eventType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEventType(opt.value)}
                  className={`text-left p-3 rounded-xl border transition ${
                    selected
                      ? 'border-sky-600 bg-sky-50/70 ring-1 ring-sky-500'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <p className={`font-bold ${selected ? 'text-sky-950' : 'text-slate-800'}`}>
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{opt.explanation}</p>
                </button>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-[11px] flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
            <span>
              <strong>Quando dispara:</strong> {selectedEventMeta.explanation}
            </span>
          </div>
        </section>

        {/* SEÇÃO 3 — MODELO DA MENSAGEM */}
        <section className="rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                3
              </span>
              <div>
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-sky-600" />
                  <span>Modelo da mensagem</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  Selecione um modelo ativo cadastrado na aba Modelos de Mensagens.
                </p>
              </div>
            </div>

            {selectedTemplate && (
              <button
                type="button"
                onClick={() => onOpenTemplateEditor(selectedTemplate.id)}
                className="px-3 py-1.5 rounded-lg border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold text-[11px] inline-flex items-center gap-1.5 self-start sm:self-auto transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir na edição de modelos</span>
              </button>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Modelo ativo para envio *
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {activeCompatibleTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.category})
                </option>
              ))}
              {isSelectedTemplateInactive && selectedTemplate && (
                <option value={selectedTemplate.id}>
                  [INATIVO] {selectedTemplate.name} — selecione um modelo ativo
                </option>
              )}
            </select>
          </div>

          {isSelectedTemplateInactive && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                O modelo vinculado anteriormente está inativo. Selecione um modelo ativo ou reative-o na aba Modelos.
              </span>
            </div>
          )}

          {selectedTemplate && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{selectedTemplate.name}</span>
                  <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-semibold text-slate-600">
                    {selectedTemplate.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Para editar o texto, emojis ou variáveis, utilize o botão &quot;Abrir na edição de modelos&quot; acima.
                </p>
                <div className="pt-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Variáveis utilizadas neste modelo
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedTemplate.variables || []).length > 0 ? (
                      selectedTemplate.variables.map((v) => (
                        <span
                          key={v}
                          className="px-2 py-0.5 rounded bg-sky-100/80 text-sky-900 font-mono text-[10px] font-semibold"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400">Sem variáveis dinâmicas</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#EFEAE2] border border-slate-300">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Pré-visualização do texto enviado
                </p>
                <div className="bg-[#D9FDD3] border border-[#c6ecc0] rounded-xl rounded-tr-none p-3 text-[11px] text-slate-800 whitespace-pre-line leading-relaxed shadow-2xs">
                  {renderPreview(selectedTemplate.content)}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* SEÇÃO 4 — REPETIÇÃO E PROGRAMAÇÃO */}
        <section className="rounded-xl border border-slate-200 p-5 space-y-5">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
              4
            </span>
            <div>
              <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-sky-600" />
                <span>Repetição e programação</span>
              </h4>
              <p className="text-[11px] text-slate-500">
                Defina quantos envios acontecem, o intervalo, a duração máxima e a janela de horário permitida.
              </p>
            </div>
          </div>

          {/* 4.1 Quantidade total de envios */}
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700">
              Quantidade total de envios *
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {[1, 2, 3, 4, 5].map((qty) => {
                const active = !isCustomSends && totalSends === qty;
                return (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => {
                      setIsCustomSends(false);
                      setTotalSends(qty);
                    }}
                    className={`px-3.5 py-2 rounded-lg font-bold border transition ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {qty} {qty === 1 ? 'envio' : 'envios'}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setIsCustomSends(true);
                  if (totalSends <= 5) setTotalSends(6);
                }}
                className={`px-3.5 py-2 rounded-lg font-bold border transition ${
                  isCustomSends
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Personalizado
              </button>

              {isCustomSends && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={totalSends}
                    onChange={(e) => setTotalSends(Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 px-2.5 py-2 border border-slate-300 rounded-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="text-slate-500">envios</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Esta quantidade já inclui o <strong>primeiro envio</strong> da sequência automática.
            </p>
          </div>

          {/* 4.2 Horário preferencial */}
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-sky-600" />
              <span>Horário preferencial de envio</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {PREFERRED_TIME_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPreferredSendTime(preset)}
                  className={`px-3 py-1.5 rounded-lg font-semibold border transition ${
                    preferredSendTime === preset
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {preset}
                </button>
              ))}
              <div className="flex items-center gap-1.5 ml-1">
                <span className="text-slate-500 text-[11px]">Outro horário:</span>
                <input
                  type="time"
                  value={preferredSendTime}
                  onChange={(e) => setPreferredSendTime(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* 4.3 Duração e frequência independentes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Intervalo entre envios
              </label>
              <input
                type="number"
                min={0}
                value={intervalValue}
                onChange={(e) => setIntervalValue(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Unidade do intervalo</label>
              <select
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value as AutomationIntervalUnit)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {Object.entries(INTERVAL_UNIT_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Duração máxima da campanha (dias)
              </label>
              <input
                type="number"
                min={0}
                value={maxDurationDays}
                onChange={(e) => setMaxDurationDays(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {!compatibilityCheck.valid && (
              <div className="md:col-span-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2 text-[11px]">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{compatibilityCheck.warning}</span>
                </div>
                {compatibilityCheck.requiredDays > 0 && (
                  <button
                    type="button"
                    onClick={() => setMaxDurationDays(compatibilityCheck.requiredDays)}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] shrink-0"
                  >
                    Ajustar para {compatibilityCheck.requiredDays} dia(s)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 4.4 Modalidade de programação */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block font-semibold text-slate-700">Modalidade de programação</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleMode('relative')}
                  className={`p-3 rounded-xl border text-left transition ${
                    scheduleMode === 'relative'
                      ? 'border-sky-600 bg-sky-50 text-sky-950'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <p className="font-bold">Relativa ao evento</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Ex.: 48h antes ou 2h após a consulta
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode('fixed_time')}
                  className={`p-3 rounded-xl border text-left transition ${
                    scheduleMode === 'fixed_time'
                      ? 'border-sky-600 bg-sky-50 text-sky-950'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <p className="font-bold">Horário fixo</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Dispara no horário preferencial escolhido
                  </p>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-semibold text-slate-700">
                Referência / Antecedência inicial
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={0}
                  value={leadTimeValue}
                  onChange={(e) => setLeadTimeValue(Math.max(0, Number(e.target.value) || 0))}
                  className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <select
                  value={leadTimeUnit}
                  onChange={(e) => setLeadTimeUnit(e.target.value as AutomationLeadTimeUnit)}
                  className="px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="minutes">Minutos</option>
                  <option value="hours">Horas</option>
                  <option value="days">Dias</option>
                </select>
              </div>
              <p className="text-[10px] text-slate-500">
                Use 0 para disparo imediato após a ocorrência do evento.
              </p>
            </div>
          </div>

          {/* 4.5 Janela permitida */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="font-bold text-slate-800">Janela de envio permitida</span>
              <span className="text-[11px] text-slate-500">Fuso horário: America/Sao_Paulo</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">Dias da semana</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_OPTIONS.map((d) => {
                  const active = allowedDays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => handleToggleDay(d.value)}
                      className={`px-3 py-1.5 rounded-lg font-semibold border transition ${
                        active
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hora inicial</label>
                <input
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hora final</label>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Se cair fora da janela
                </label>
                <select
                  value={outsideWindowPolicy}
                  onChange={(e) =>
                    setOutsideWindowPolicy(e.target.value as AutomationOutsideWindowPolicy)
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="next_allowed_window">Adiar para próxima janela permitida</option>
                  <option value="skip">Ignorar envio fora do horário</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* SEÇÃO 5 — REGRAS INTELIGENTES DE ENVIO */}
        <section className="rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
              5
            </span>
            <div>
              <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Regras inteligentes de envio</span>
              </h4>
              <p className="text-[11px] text-slate-500">
                Proteções automáticas para evitar excesso de mensagens e envios indevidos.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              {
                key: 'requireValidPhone' as const,
                label: 'Exigir telefone ou WhatsApp válido no cadastro',
              },
              {
                key: 'skipCancelledAppointments' as const,
                label: 'Não enviar para consultas canceladas',
              },
              {
                key: 'stopOnAppointmentCancel' as const,
                label: 'Interromper sequência se a consulta for cancelada',
              },
              {
                key: 'stopOnAppointmentConfirm' as const,
                label: 'Interromper sequência se a consulta já estiver confirmada',
              },
              {
                key: 'respectAppointmentStatus' as const,
                label: 'Respeitar situação atual do agendamento na agenda',
              },
              {
                key: 'respectOriginBranch' as const,
                label: 'Respeitar filial de origem do atendimento',
              },
              {
                key: 'respectOrganizationIsolation' as const,
                label: 'Manter isolamento exclusivo por clínica',
              },
              {
                key: 'preventDuplicates' as const,
                label: 'Bloquear envios duplicados para o mesmo paciente e etapa',
              },
            ].map((rule) => (
              <label
                key={rule.key}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer hover:bg-slate-100/70 transition"
              >
                <span className="text-slate-700 font-medium text-[11px]">{rule.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(smartRules[rule.key])}
                  onChange={(e) =>
                    setSmartRules((prev) => ({ ...prev, [rule.key]: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-emerald-600 shrink-0"
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Intervalo mínimo entre mensagens ao mesmo paciente (min)
              </label>
              <input
                type="number"
                min={0}
                value={smartRules.minIntervalMinutesPerPatient}
                onChange={(e) =>
                  setSmartRules((prev) => ({
                    ...prev,
                    minIntervalMinutesPerPatient: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Limite diário por paciente
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={smartRules.dailyLimitPerPatient}
                onChange={(e) =>
                  setSmartRules((prev) => ({
                    ...prev,
                    dailyLimitPerPatient: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700">Tentar novamente se falhar</label>
                <input
                  type="checkbox"
                  checked={smartRules.retryOnFailure}
                  onChange={(e) =>
                    setSmartRules((prev) => ({ ...prev, retryOnFailure: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-emerald-600"
                />
              </div>
              <input
                type="number"
                min={1}
                max={5}
                disabled={!smartRules.retryOnFailure}
                value={smartRules.maxRetries}
                onChange={(e) =>
                  setSmartRules((prev) => ({
                    ...prev,
                    maxRetries: Math.min(5, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                title="Máximo de tentativas"
              />
              <span className="text-[10px] text-slate-500 block">Máximo de tentativas (1 a 5)</span>
            </div>
          </div>
        </section>

        {/* SEÇÃO 6 — REVISÃO E ATIVAÇÃO */}
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-emerald-200/70">
            <span className="w-6 h-6 rounded-lg bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center">
              6
            </span>
            <div>
              <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-700" />
                <span>Revisão e ativação</span>
              </h4>
              <p className="text-[11px] text-slate-600">
                Confira o resumo legível de como este gatilho funcionará na prática.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white border border-emerald-200 text-slate-800 leading-relaxed text-xs shadow-2xs">
            <p className="font-semibold text-emerald-900 mb-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Resumo da regra configurada</span>
            </p>
            <p>{readableSummary}</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSubmit('draft')}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold transition inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salvar como rascunho</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSubmit('activate')}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold shadow-xs transition inline-flex items-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>{isSubmitting ? 'Salvando...' : 'Salvar e ativar'}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
