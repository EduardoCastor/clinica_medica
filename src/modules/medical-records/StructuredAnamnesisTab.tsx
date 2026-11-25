import React, { useEffect, useState } from 'react';
import {
  ClipboardCheck,
  Copy,
  FileText,
  Lock,
  Plus,
  Printer,
  Save,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Eye,
  Edit3,
} from 'lucide-react';
import {
  Patient,
  PatientAnamnesisEntry,
  StructuredAnamnesis,
  TriStateAnswer,
} from '../../types';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import {
  EMPTY_STRUCTURED_ANAMNESIS,
  hasStructuredAnamnesisContent,
  normalizeStructuredAnamnesis,
  toLocalDateTimeInputValue,
} from '../../services/pepClinicalUtils';

interface StructuredAnamnesisTabProps {
  patient: Patient;
  organizationId: string;
  branchId: string;
  professionalId: string;
  professionalName: string;
  professionalCouncil: string;
  anamnesisRecords: PatientAnamnesisEntry[];
  canCreate: boolean;
  canEdit: boolean;
  onRefreshBundle: () => Promise<void>;
  onPrintAnamnesis: (entry: PatientAnamnesisEntry) => void;
  onEditPatientRegistration?: () => void;
}

const TriStateSelector: React.FC<{
  label: string;
  value: TriStateAnswer | undefined;
  disabled?: boolean;
  onChange: (val: TriStateAnswer) => void;
}> = ({ label, value, disabled, onChange }) => {
  const current = value || '';
  return (
    <div>
      <span className="block text-[11px] font-semibold text-slate-700 mb-1">{label}</span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
        {(
          [
            { key: 'sim', label: 'Sim' },
            { key: 'nao', label: 'Não' },
            { key: '', label: 'Não inf.' },
          ] as Array<{ key: TriStateAnswer; label: string }>
        ).map((opt) => (
          <button
            key={opt.key || 'empty'}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.key)}
            className={`px-2.5 py-1 rounded-md font-semibold transition ${
              current === opt.key
                ? opt.key === 'sim'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : opt.key === 'nao'
                    ? 'bg-slate-700 text-white shadow-xs'
                    : 'bg-white text-slate-800 border border-slate-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            } disabled:opacity-60`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export const StructuredAnamnesisTab: React.FC<StructuredAnamnesisTabProps> = ({
  patient,
  organizationId,
  branchId,
  professionalId,
  professionalName,
  professionalCouncil,
  anamnesisRecords,
  canCreate,
  canEdit,
  onRefreshBundle,
  onPrintAnamnesis,
  onEditPatientRegistration,
}) => {
  const [selectedId, setSelectedId] = useState<string>('new');
  const [formData, setFormData] = useState<StructuredAnamnesis>({
    ...EMPTY_STRUCTURED_ANAMNESIS,
  });
  const [evaluationDate, setEvaluationDate] = useState<string>(
    toLocalDateTimeInputValue()
  );
  const [showMaleReproductiveFields, setShowMaleReproductiveFields] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );

  // Sync selection when patient or loaded list changes
  useEffect(() => {
    setFeedback(null);
    setShowMaleReproductiveFields(false);
    if (anamnesisRecords.length > 0) {
      const latest = anamnesisRecords[0];
      setSelectedId(latest.id);
      setFormData(normalizeStructuredAnamnesis(latest.structuredData));
      setEvaluationDate(toLocalDateTimeInputValue(latest.evaluationDate));
    } else {
      setSelectedId('new');
      setFormData({ ...EMPTY_STRUCTURED_ANAMNESIS });
      setEvaluationDate(toLocalDateTimeInputValue());
    }
  }, [patient.id, anamnesisRecords]);

  const selectedEntry =
    selectedId !== 'new' ? anamnesisRecords.find((r) => r.id === selectedId) || null : null;

  const isSignedReadOnly = Boolean(selectedEntry && (selectedEntry.isSigned || selectedEntry.status === 'signed'));
  const canModifyCurrent =
    !isSignedReadOnly && (selectedId === 'new' ? canCreate : canEdit);

  const hasAnyReproductiveData = Boolean(
    (formData.cicloMenstrual && formData.cicloMenstrual.trim().length > 0) ||
      formData.gestacoes !== null && formData.gestacoes !== undefined ||
      formData.nascidos !== null && formData.nascidos !== undefined ||
      formData.abortos !== null && formData.abortos !== undefined ||
      formData.natimortos !== null && formData.natimortos !== undefined
  );
  const shouldShowReproductiveSection =
    patient.biologicalSex !== 'M' || hasAnyReproductiveData || showMaleReproductiveFields;

  const handleSelectEvaluation = (id: string) => {
    setFeedback(null);
    setSelectedId(id);
    if (id === 'new') {
      setFormData({ ...EMPTY_STRUCTURED_ANAMNESIS });
      setEvaluationDate(toLocalDateTimeInputValue());
      return;
    }
    const found = anamnesisRecords.find((r) => r.id === id);
    if (found) {
      setFormData(normalizeStructuredAnamnesis(found.structuredData));
      setEvaluationDate(toLocalDateTimeInputValue(found.evaluationDate));
    }
  };

  const handleStartNewEvaluation = (copyCurrentOrLatest: boolean) => {
    setFeedback(null);
    setSelectedId('new');
    setEvaluationDate(toLocalDateTimeInputValue());
    const sourceEntry = selectedEntry || anamnesisRecords[0];
    if (copyCurrentOrLatest && sourceEntry) {
      setFormData(normalizeStructuredAnamnesis(sourceEntry.structuredData));
    } else {
      setFormData({ ...EMPTY_STRUCTURED_ANAMNESIS });
    }
  };

  const updateField = <K extends keyof StructuredAnamnesis>(
    field: K,
    value: StructuredAnamnesis[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleIntField = (
    field: 'gestacoes' | 'nascidos' | 'abortos' | 'natimortos',
    raw: string
  ) => {
    if (!raw.trim()) {
      updateField(field, null);
      return;
    }
    const n = Math.max(0, Math.trunc(Number(raw)));
    updateField(field, Number.isFinite(n) ? n : null);
  };

  const handleSave = async (targetStatus: 'draft' | 'signed') => {
    if (isSaving || !canModifyCurrent) return;
    setFeedback(null);

    const normalized = normalizeStructuredAnamnesis(formData);
    if (targetStatus === 'signed' && !hasStructuredAnamnesisContent(normalized)) {
      setFeedback({
        type: 'error',
        text: 'Preencha ao menos um campo clínico da anamnese antes de finalizar e assinar.',
      });
      return;
    }

    const isSigned = targetStatus === 'signed';
    const entryToSave: PatientAnamnesisEntry = {
      id: selectedEntry ? selectedEntry.id : `anam_${Date.now()}`,
      organizationId: patient.organizationId || organizationId,
      branchId: branchId !== 'all' ? branchId : patient.originBranchId,
      patientId: patient.id,
      professionalId,
      professionalName,
      professionalCouncil,
      evaluationDate: evaluationDate
        ? new Date(evaluationDate).toISOString()
        : new Date().toISOString(),
      status: targetStatus,
      structuredData: normalized,
      isSigned,
      signedAt: isSigned ? new Date().toISOString() : undefined,
      signatureHash: isSigned
        ? `sha256_anam_${Math.random().toString(36).substring(2, 12)}`
        : undefined,
      createdAt: selectedEntry?.createdAt || new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      const res = await ClinicalCloudService.saveAnamnesisRecordToCloud(entryToSave, patient);
      if (!res.success || !res.record) {
        setFeedback({
          type: 'error',
          text: res.message || 'Não foi possível salvar a anamnese estruturada.',
        });
        return;
      }

      await onRefreshBundle();
      setSelectedId(res.record.id);
      setFeedback({
        type: 'success',
        text: isSigned
          ? 'Anamnese clínica assinada e arquivada com segurança.'
          : 'Rascunho de anamnese salvo no prontuário.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro inesperado ao salvar anamnese.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const printCurrentEntry: PatientAnamnesisEntry = selectedEntry || {
    id: 'preview',
    organizationId: patient.organizationId || organizationId,
    branchId: branchId !== 'all' ? branchId : patient.originBranchId,
    patientId: patient.id,
    professionalId,
    professionalName,
    professionalCouncil,
    evaluationDate: evaluationDate ? new Date(evaluationDate).toISOString() : new Date().toISOString(),
    status: 'draft',
    structuredData: normalizeStructuredAnamnesis(formData),
    isSigned: false,
    createdAt: new Date().toISOString(),
  };

  return (
    <div className="space-y-4">
      {/* Top Evaluation Selector & Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Avaliações de Anamnese ({anamnesisRecords.length})
            </span>
            <select
              value={selectedId}
              onChange={(e) => handleSelectEvaluation(e.target.value)}
              className="mt-0.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="new">+ Nova Avaliação (Em elaboração)</option>
              {anamnesisRecords.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.evaluationDate).toLocaleDateString('pt-BR')}{' '}
                  {new Date(item.evaluationDate).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {item.professionalName} ({item.status === 'signed' ? 'Assinada' : 'Rascunho'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Data / Hora da Avaliação
            </span>
            <input
              type="datetime-local"
              value={evaluationDate}
              disabled={!canModifyCurrent}
              onChange={(e) => setEvaluationDate(e.target.value)}
              className="mt-0.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-xl disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          {isSignedReadOnly && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg mt-3 lg:mt-4">
              <Lock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Registro Assinado & Imutável</span>
            </span>
          )}
          {!canModifyCurrent && !isSignedReadOnly && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 rounded-lg mt-3 lg:mt-4">
              <Eye className="w-3.5 h-3.5" />
              <span>Somente Leitura</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <>
              <button
                type="button"
                onClick={() => handleStartNewEvaluation(false)}
                className="px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Avaliação</span>
              </button>
              {anamnesisRecords.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleStartNewEvaluation(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition inline-flex items-center gap-1.5"
                  title="Cria uma nova avaliação aproveitando os antecedentes da última ficha"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copiar Anterior</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => onPrintAnamnesis(printCurrentEntry)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition inline-flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir Ficha</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {feedback.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          ) : (
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Allergies & Chronic Diseases from Patient Master Record (Single Source of Truth) */}
      <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">
              Alergias Medicamentosas (Cadastro do Paciente)
            </span>
            {onEditPatientRegistration && (
              <button
                type="button"
                onClick={onEditPatientRegistration}
                className="text-[10px] font-semibold text-sky-700 hover:text-sky-900 inline-flex items-center gap-1"
                title="Atualizar alergias, comorbidades e medicações no cadastro único do paciente"
              >
                <Edit3 className="w-3 h-3" />
                <span>Editar</span>
              </button>
            )}
          </div>
          <p className="font-semibold text-slate-800 mt-0.5">
            {patient.allergies && patient.allergies.length > 0
              ? patient.allergies.join(', ')
              : 'Nenhuma alergia registrada no cadastro base.'}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Comorbidades Prévias (Cadastro Base)
          </span>
          <p className="font-medium text-slate-700 mt-0.5">
            {patient.chronicDiseases && patient.chronicDiseases.length > 0
              ? patient.chronicDiseases.join(', ')
              : 'Não informadas.'}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Medicações Contínuas (Cadastro Base)
          </span>
          <p className="font-medium text-slate-700 mt-0.5">
            {patient.continuousMedications && patient.continuousMedications.length > 0
              ? patient.continuousMedications.join(', ')
              : 'Não informadas.'}
          </p>
        </div>
      </div>

      {/* SECTION 4.1: Histórico patológico e antecedentes pessoais */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-900 border-b border-slate-100 pb-2 flex items-center gap-2">
          <FileText className="w-4 h-4 text-sky-600" />
          <span>1. Histórico Patológico & Antecedentes Pessoais</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Internações Prévias
            </label>
            <textarea
              rows={2}
              disabled={!canModifyCurrent}
              value={formData.internacoes || ''}
              onChange={(e) => updateField('internacoes', e.target.value)}
              placeholder="Motivo, ano e duração de internações..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              História Patológica Pregressa (HPP)
            </label>
            <textarea
              rows={2}
              disabled={!canModifyCurrent}
              value={formData.historiaPatologicaPregressa || ''}
              onChange={(e) => updateField('historiaPatologicaPregressa', e.target.value)}
              placeholder="Doenças prévias relevantes..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Pressão Arterial (Histórico / HAS)
            </label>
            <textarea
              rows={2}
              disabled={!canModifyCurrent}
              value={formData.pressaoArterial || ''}
              onChange={(e) => updateField('pressaoArterial', e.target.value)}
              placeholder="Ex: Normotenso, HAS controlada com medicação..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Diabetes"
              value={formData.diabetes}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('diabetes', v)}
            />
            {formData.diabetes === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.diabetesDetalhes || ''}
                onChange={(e) => updateField('diabetesDetalhes', e.target.value)}
                placeholder="Tipo (DM1/DM2), tempo de diagnóstico, tratamento..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Doenças da Tireoide"
              value={formData.doencasTireoide}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('doencasTireoide', v)}
            />
            {formData.doencasTireoide === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.doencasTireoideDetalhes || ''}
                onChange={(e) => updateField('doencasTireoideDetalhes', e.target.value)}
                placeholder="Hipotireoidismo, hipertireoidismo, nódulos..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Doenças da Tireoide na Família"
              value={formData.doencasTireoideFamilia}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('doencasTireoideFamilia', v)}
            />
            {formData.doencasTireoideFamilia === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.doencasTireoideFamiliaDetalhes || ''}
                onChange={(e) => updateField('doencasTireoideFamiliaDetalhes', e.target.value)}
                placeholder="Grau de parentesco e diagnóstico..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Fumante (Tabagismo)"
              value={formData.fumante}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('fumante', v)}
            />
            {formData.fumante === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.fumanteDetalhes || ''}
                onChange={(e) => updateField('fumanteDetalhes', e.target.value)}
                placeholder="Maços/dia, tempo de uso ou ex-tabagista..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Etilismo"
              value={formData.etilismo}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('etilismo', v)}
            />
            {formData.etilismo === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.etilismoDetalhes || ''}
                onChange={(e) => updateField('etilismoDetalhes', e.target.value)}
                placeholder="Frequência e quantidade semanal..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Histórico de Câncer"
              value={formData.cancer}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('cancer', v)}
            />
            {formData.cancer === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.cancerDetalhes || ''}
                onChange={(e) => updateField('cancerDetalhes', e.target.value)}
                placeholder="Tipo, ano do diagnóstico e tratamento..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
            Outros Antecedentes Relevantes
          </label>
          <textarea
            rows={2}
            disabled={!canModifyCurrent}
            value={formData.outrosAntecedentes || ''}
            onChange={(e) => updateField('outrosAntecedentes', e.target.value)}
            placeholder="Outras condições clínicas, tromboses, patologias renais, hepáticas ou cardiovasculares..."
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
          />
        </div>
      </section>

      {/* SECTION 4.2: Histórico cirúrgico e condições clínicas */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-900 border-b border-slate-100 pb-2">
          2. Histórico Cirúrgico & Condições Clínicas
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Cirurgias Prévias"
              value={formData.cirurgiasPrevias}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('cirurgiasPrevias', v)}
            />
            {formData.cirurgiasPrevias === 'sim' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  disabled={!canModifyCurrent}
                  value={formData.cirurgiaQual || ''}
                  onChange={(e) => updateField('cirurgiaQual', e.target.value)}
                  placeholder="Qual cirurgia?"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <input
                  type="text"
                  disabled={!canModifyCurrent}
                  value={formData.cirurgiaQuando || ''}
                  onChange={(e) => updateField('cirurgiaQuando', e.target.value)}
                  placeholder="Quando? (ano/mês)"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Indicação de Cirurgia"
              value={formData.indicacaoCirurgia}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('indicacaoCirurgia', v)}
            />
            {formData.indicacaoCirurgia === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.indicacaoCirurgiaDetalhes || ''}
                onChange={(e) => updateField('indicacaoCirurgiaDetalhes', e.target.value)}
                placeholder="Procedimento indicado / observações..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Transfusão Sanguínea"
              value={formData.transfusaoSanguinea}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('transfusaoSanguinea', v)}
            />
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Presença de Dor Atual / Crônica"
              value={formData.dor}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('dor', v)}
            />
            {formData.dor === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.dorDescricao || ''}
                onChange={(e) => updateField('dorDescricao', e.target.value)}
                placeholder="Localização, intensidade e fatores de alívio..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
            Alergias Alimentares
          </label>
          <input
            type="text"
            disabled={!canModifyCurrent}
            value={formData.alergiasAlimentares || ''}
            onChange={(e) => updateField('alergiasAlimentares', e.target.value)}
            placeholder="Ex: Lactose, glúten, frutos do mar, corantes, ou Nega alergias alimentares..."
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
          />
        </div>
      </section>

      {/* SECTION 4.3: Hábitos e condições gerais */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-900 border-b border-slate-100 pb-2">
          3. Hábitos & Condições Gerais
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Atividade Física
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.atividadeFisica || ''}
              onChange={(e) => updateField('atividadeFisica', e.target.value)}
              placeholder="Modalidade, frequência semanal..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Qualidade do Sono
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.sono || ''}
              onChange={(e) => updateField('sono', e.target.value)}
              placeholder="Horas/noite, despertares, insônia..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Nível de Estresse
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.estresse || ''}
              onChange={(e) => updateField('estresse', e.target.value)}
              placeholder="Baixo, moderado, elevado..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Ansiedade
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.ansiedade || ''}
              onChange={(e) => updateField('ansiedade', e.target.value)}
              placeholder="Ausente, leve, moderada, em tratamento..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Função Intestinal
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.funcaoIntestinal || ''}
              onChange={(e) => updateField('funcaoIntestinal', e.target.value)}
              placeholder="Regular, constipação, ritmo..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Consumo Hídrico / Ingestão de Água
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.ingestaoHidrica || ''}
              onChange={(e) => updateField('ingestaoHidrica', e.target.value)}
              placeholder="Litros/dia estimados..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Diurese (Volume / Aspecto)
            </label>
            <input
              type="text"
              disabled={!canModifyCurrent}
              value={formData.diurese || ''}
              onChange={(e) => updateField('diurese', e.target.value)}
              placeholder="Normúria, noctúria, coloração, frequência..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>
        </div>
      </section>

      {/* SECTION 4.4 & 4.5: Histórico alérgico, hormonal e reprodutivo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-900 border-b border-slate-100 pb-2">
            4. Histórico Alérgico & Hormonal
          </h3>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Antecedentes Alérgicos (Rinite, Asma, Dermatite, Fármacos)
            </label>
            <textarea
              rows={2}
              disabled={!canModifyCurrent}
              value={formData.antecedentesAlergicos || ''}
              onChange={(e) => updateField('antecedentesAlergicos', e.target.value)}
              placeholder="Detalhamento de reações alérgicas e atopias..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
            />
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <TriStateSelector
              label="Reposição Hormonal"
              value={formData.reposicaoHormonal}
              disabled={!canModifyCurrent}
              onChange={(v) => updateField('reposicaoHormonal', v)}
            />
            {formData.reposicaoHormonal === 'sim' && (
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.reposicaoHormonalDetalhes || ''}
                onChange={(e) => updateField('reposicaoHormonalDetalhes', e.target.value)}
                placeholder="Hormônio, via de administração e tempo de uso..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            )}
          </div>

          {shouldShowReproductiveSection ? (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Ciclo Menstrual (Opcional / Quando aplicável)
                </label>
                {patient.biologicalSex === 'M' && !hasAnyReproductiveData && (
                  <button
                    type="button"
                    onClick={() => setShowMaleReproductiveFields(false)}
                    className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Ocultar campos reprodutivos
                  </button>
                )}
              </div>
              <input
                type="text"
                disabled={!canModifyCurrent}
                value={formData.cicloMenstrual || ''}
                onChange={(e) => updateField('cicloMenstrual', e.target.value)}
                placeholder="Regular, irregular, amenorreia, menopausa, DIU, ACO..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              />
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 text-[11px] text-slate-600">
              <span>Campos ginecológicos/reprodutivos ocultos para sexo biológico masculino.</span>
              <button
                type="button"
                onClick={() => setShowMaleReproductiveFields(true)}
                className="font-semibold text-sky-700 hover:text-sky-900 shrink-0"
              >
                Exibir (opcional)
              </button>
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
          {shouldShowReproductiveSection && (
            <>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-900 border-b border-slate-100 pb-2">
                5. Histórico Reprodutivo (Opcional)
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Gestações
                  </label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canModifyCurrent}
                    value={formData.gestacoes ?? ''}
                    onChange={(e) => handleIntField('gestacoes', e.target.value)}
                    placeholder="—"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center font-bold disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Nascidos
                  </label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canModifyCurrent}
                    value={formData.nascidos ?? ''}
                    onChange={(e) => handleIntField('nascidos', e.target.value)}
                    placeholder="—"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center font-bold disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Abortos
                  </label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canModifyCurrent}
                    value={formData.abortos ?? ''}
                    onChange={(e) => handleIntField('abortos', e.target.value)}
                    placeholder="—"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center font-bold disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Natimortos
                  </label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canModifyCurrent}
                    value={formData.natimortos ?? ''}
                    onChange={(e) => handleIntField('natimortos', e.target.value)}
                    placeholder="—"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center font-bold disabled:bg-slate-50"
                  />
                </div>
              </div>
            </>
          )}

          <div className="pt-2 space-y-2.5">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-sky-900 border-b border-slate-100 pb-1.5">
              6. Objetivo da Consulta & Histórico Familiar
            </h4>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Objetivo da Consulta
              </label>
              <textarea
                rows={2}
                disabled={!canModifyCurrent}
                value={formData.objetivoConsulta || ''}
                onChange={(e) => updateField('objetivoConsulta', e.target.value)}
                placeholder="Queixas centrais, metas clínicas, avaliação metabólica, tratamento de lipedema..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Antecedentes Patológicos Familiares
              </label>
              <textarea
                rows={2}
                disabled={!canModifyCurrent}
                value={formData.antecedentesPatologicosFamiliares || ''}
                onChange={(e) => updateField('antecedentesPatologicosFamiliares', e.target.value)}
                placeholder="Doenças em pais, irmãos e avós (DM, HAS, cardiopatias, neoplasias, obesidade)..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Antecedentes Patológicos do Paciente
              </label>
              <textarea
                rows={2}
                disabled={!canModifyCurrent}
                value={formData.antecedentesPatologicosPaciente || ''}
                onChange={(e) => updateField('antecedentesPatologicosPaciente', e.target.value)}
                placeholder="Síntese diagnóstica de antecedentes patológicos pessoais..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Action Footer */}
      {canModifyCurrent && (
        <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-emerald-950">
            <span className="font-bold flex items-center gap-1.5">
              <ClipboardCheck className="w-4 h-4 text-emerald-700" />
              <span>Persistência de Anamnese Estruturada</span>
            </span>
            <p className="text-[11px] text-emerald-800 mt-0.5">
              Você pode salvar parcialmente como rascunho ou assinar para selar esta avaliação no prontuário.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSave('draft')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Salvar Rascunho</span>
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSave('signed')}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>Finalizar e Assinar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
