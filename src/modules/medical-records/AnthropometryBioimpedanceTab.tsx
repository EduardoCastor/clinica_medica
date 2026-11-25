import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Edit3,
  Loader2,
  Plus,
  Printer,
  Scale,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  AnthropometricMeasurement,
  AnthropometrySourceType,
  Patient,
} from '../../types';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import {
  extractRealWeightSeries,
  formatMetricDisplay,
  hasAnyAnthropometricMetric,
  parseOptionalPositiveMetric,
  sortAnthropometryDesc,
  WeightChartPeriod,
} from '../../services/pepClinicalUtils';

interface AnthropometryBioimpedanceTabProps {
  patient: Patient;
  organizationId: string;
  branchId: string;
  professionalId: string;
  professionalName: string;
  measurements: AnthropometricMeasurement[];
  canCreate: boolean;
  canEdit: boolean;
  onRefreshBundle: () => Promise<void>;
  onPrintHistory: (orderedMeasurements: AnthropometricMeasurement[]) => void;
}

const SOURCE_LABELS: Record<AnthropometrySourceType, { label: string; cls: string }> = {
  manual: {
    label: 'Antropometria',
    cls: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  bioimpedance: {
    label: 'Bioimpedância',
    cls: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  soap_evolution: {
    label: 'Evolução SOAP',
    cls: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
};

export const AnthropometryBioimpedanceTab: React.FC<AnthropometryBioimpedanceTabProps> = ({
  patient,
  organizationId,
  branchId,
  professionalId,
  professionalName,
  measurements,
  canCreate,
  canEdit,
  onRefreshBundle,
  onPrintHistory,
}) => {
  const [period, setPeriod] = useState<WeightChartPeriod>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<AnthropometricMeasurement | null>(null);

  // Modal Form States (string inputs so blank stays blank -> null, NEVER 0)
  const [measuredAt, setMeasuredAt] = useState('');
  const [sourceType, setSourceType] = useState<'manual' | 'bioimpedance'>('manual');
  const [weightInput, setWeightInput] = useState('');
  const [abdominalInput, setAbdominalInput] = useState('');
  const [rightArmInput, setRightArmInput] = useState('');
  const [leftArmInput, setLeftArmInput] = useState('');
  const [rightLegInput, setRightLegInput] = useState('');
  const [leftLegInput, setLeftLegInput] = useState('');
  const [thoracicInput, setThoracicInput] = useState('');
  const [hipInput, setHipInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const orderedMeasurements = useMemo(
    () => sortAnthropometryDesc(measurements),
    [measurements]
  );

  const weightSeries = useMemo(
    () => extractRealWeightSeries(orderedMeasurements, period),
    [orderedMeasurements, period]
  );

  const allWeightRecords = useMemo(
    () => extractRealWeightSeries(orderedMeasurements, 'all'),
    [orderedMeasurements]
  );
  const latestWeightPoint =
    allWeightRecords.length > 0 ? allWeightRecords[allWeightRecords.length - 1] : null;
  const previousWeightPoint =
    allWeightRecords.length > 1 ? allWeightRecords[allWeightRecords.length - 2] : null;
  const weightDelta =
    latestWeightPoint && previousWeightPoint
      ? Math.round((latestWeightPoint.weightKg - previousWeightPoint.weightKg) * 10) / 10
      : null;

  const openNewModal = () => {
    setEditingEntry(null);
    setMeasuredAt(new Date().toISOString().slice(0, 16));
    setSourceType('manual');
    setWeightInput('');
    setAbdominalInput('');
    setRightArmInput('');
    setLeftArmInput('');
    setRightLegInput('');
    setLeftLegInput('');
    setThoracicInput('');
    setHipInput('');
    setNotesInput('');
    setModalError('');
    setIsModalOpen(true);
  };

  const openEditModal = (item: AnthropometricMeasurement) => {
    if (item.sourceType === 'soap_evolution') return;
    setEditingEntry(item);
    setMeasuredAt(new Date(item.measuredAt).toISOString().slice(0, 16));
    setSourceType(item.sourceType === 'bioimpedance' ? 'bioimpedance' : 'manual');
    setWeightInput(item.weightKg != null ? String(item.weightKg) : '');
    setAbdominalInput(
      item.abdominalCircumferenceCm != null ? String(item.abdominalCircumferenceCm) : ''
    );
    setRightArmInput(
      item.rightArmCircumferenceCm != null ? String(item.rightArmCircumferenceCm) : ''
    );
    setLeftArmInput(
      item.leftArmCircumferenceCm != null ? String(item.leftArmCircumferenceCm) : ''
    );
    setRightLegInput(
      item.rightLegCircumferenceCm != null ? String(item.rightLegCircumferenceCm) : ''
    );
    setLeftLegInput(
      item.leftLegCircumferenceCm != null ? String(item.leftLegCircumferenceCm) : ''
    );
    setThoracicInput(
      item.thoracicCircumferenceCm != null ? String(item.thoracicCircumferenceCm) : ''
    );
    setHipInput(item.hipCircumferenceCm != null ? String(item.hipCircumferenceCm) : '');
    setNotesInput(item.notes || '');
    setModalError('');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setModalError('');

    const wRes = parseOptionalPositiveMetric(weightInput, 'Peso (kg)', 500);
    const abdRes = parseOptionalPositiveMetric(abdominalInput, 'Circunferência Abdominal (cm)', 350);
    const rArmRes = parseOptionalPositiveMetric(rightArmInput, 'Braço D (cm)', 350);
    const lArmRes = parseOptionalPositiveMetric(leftArmInput, 'Braço E (cm)', 350);
    const rLegRes = parseOptionalPositiveMetric(rightLegInput, 'Perna D (cm)', 350);
    const lLegRes = parseOptionalPositiveMetric(leftLegInput, 'Perna E (cm)', 350);
    const thoRes = parseOptionalPositiveMetric(thoracicInput, 'Tórax (cm)', 350);
    const hipRes = parseOptionalPositiveMetric(hipInput, 'Quadril (cm)', 350);

    const firstValidationErr =
      wRes.error ||
      abdRes.error ||
      rArmRes.error ||
      lArmRes.error ||
      rLegRes.error ||
      lLegRes.error ||
      thoRes.error ||
      hipRes.error;

    if (firstValidationErr) {
      setModalError(firstValidationErr);
      return;
    }

    const candidate: AnthropometricMeasurement = {
      id: editingEntry ? editingEntry.id : `anth_${Date.now()}`,
      organizationId: patient.organizationId || organizationId,
      branchId: branchId !== 'all' ? branchId : patient.originBranchId,
      patientId: patient.id,
      professionalId,
      professionalName: editingEntry?.professionalName || professionalName,
      measuredAt: measuredAt ? new Date(measuredAt).toISOString() : new Date().toISOString(),
      weightKg: wRes.value,
      abdominalCircumferenceCm: abdRes.value,
      rightArmCircumferenceCm: rArmRes.value,
      leftArmCircumferenceCm: lArmRes.value,
      rightLegCircumferenceCm: rLegRes.value,
      leftLegCircumferenceCm: lLegRes.value,
      thoracicCircumferenceCm: thoRes.value,
      hipCircumferenceCm: hipRes.value,
      sourceType,
      notes: notesInput.trim() || undefined,
      createdAt: editingEntry?.createdAt || new Date().toISOString(),
    };

    if (!hasAnyAnthropometricMetric(candidate)) {
      setModalError(
        'Preencha ao menos o Peso (kg) ou uma circunferência corporal (cm). Campos não aferidos devem permanecer em branco.'
      );
      return;
    }

    setIsSaving(true);
    try {
      const res = await ClinicalCloudService.saveAnthropometricMeasurementToCloud(
        candidate,
        patient
      );
      if (!res.success) {
        setModalError(res.message || 'Erro ao salvar avaliação no banco de dados.');
        return;
      }
      await onRefreshBundle();
      setIsModalOpen(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro inesperado ao salvar avaliação.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
            <Scale className="w-4 h-4 text-sky-600" />
            <span>Histórico de Antropometria e Bioimpedância ({orderedMeasurements.length})</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Registro cronológico unificado: Peso (kg) e 7 circunferências corporais (cm), integrado às evoluções SOAP assinadas.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onPrintHistory(orderedMeasurements)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition inline-flex items-center gap-1.5 shadow-xs"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir Tabela</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={openNewModal}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Avaliação</span>
            </button>
          )}
        </div>
      </div>

      {/* Compact Metrics Strip for 1440x900 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Último Peso Registrado
            </span>
            <span className="text-lg font-extrabold text-slate-900 tabular-nums">
              {latestWeightPoint ? formatMetricDisplay(latestWeightPoint.weightKg, 1, 'kg') : 'Sem registro'}
            </span>
            {latestWeightPoint && (
              <span className="block text-[10px] text-slate-500">
                Em {new Date(latestWeightPoint.measuredAt).toLocaleDateString('pt-BR')}
              </span>
            )}
          </div>
          <div className="p-2.5 rounded-xl bg-sky-50 text-sky-600">
            <Scale className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Variação vs. Aferição Anterior
            </span>
            {weightDelta !== null ? (
              <span
                className={`text-lg font-extrabold tabular-nums inline-flex items-center gap-1 ${
                  weightDelta < 0
                    ? 'text-emerald-700'
                    : weightDelta > 0
                      ? 'text-amber-700'
                      : 'text-slate-700'
                }`}
              >
                {weightDelta > 0 ? '+' : ''}
                {weightDelta.toLocaleString('pt-BR', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{' '}
                kg
              </span>
            ) : (
              <span className="text-sm font-semibold text-slate-400">
                Aguardando 2ª aferição
              </span>
            )}
            {previousWeightPoint && (
              <span className="block text-[10px] text-slate-500">
                Anterior: {formatMetricDisplay(previousWeightPoint.weightKg, 1, 'kg')}
              </span>
            )}
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 text-slate-600">
            {weightDelta !== null && weightDelta < 0 ? (
              <TrendingDown className="w-5 h-5 text-emerald-600" />
            ) : (
              <TrendingUp className="w-5 h-5 text-sky-600" />
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Total de Aferições Clínicas
            </span>
            <span className="text-lg font-extrabold text-slate-900 tabular-nums">
              {orderedMeasurements.length}
            </span>
            <span className="block text-[10px] text-slate-500">
              {allWeightRecords.length} com registro de peso
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-teal-50 text-teal-600">
            <Activity className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Weight Evolution Real Time-Series SVG Chart */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-slate-900">
              Gráfico de Evolução de Peso (Dados Reais)
            </h4>
            <p className="text-[11px] text-slate-500">
              Exibe exclusivamente datas e pesos aferidos no banco de dados (sem pontos sintéticos).
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-semibold">
            {(
              [
                { id: '30d', label: '30 dias' },
                { id: '90d', label: '90 dias' },
                { id: '180d', label: '6 meses' },
                { id: '365d', label: '1 ano' },
                { id: 'all', label: 'Todo histórico' },
              ] as Array<{ id: WeightChartPeriod; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  period === opt.id
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <WeightEvolutionSvgChart series={weightSeries} />
      </div>

      {/* Unified Chronological Table (Pages 3 & 9) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <span className="text-xs font-bold text-slate-800">
            Histórico Cronológico Unificado (Peso e 7 Circunferências)
          </span>
          <span className="text-[11px] text-slate-500">
            Campos não aferidos exibidos como "—"
          </span>
        </div>

        {orderedMeasurements.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Nenhuma avaliação antropométrica ou de bioimpedância registrada para este paciente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3 whitespace-nowrap">Data / Hora</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Peso (kg)</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Abdominal</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Braço D</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Braço E</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Perna D</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Perna E</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Tórax</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Quadril</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Origem</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orderedMeasurements.map((row) => {
                  const srcMeta = SOURCE_LABELS[row.sourceType] || SOURCE_LABELS.manual;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 block">
                          {new Date(row.measuredAt).toLocaleDateString('pt-BR')}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(row.measuredAt).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.weightKg, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.abdominalCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.rightArmCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.leftArmCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.rightLegCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.leftLegCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.thoracicCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {formatMetricDisplay(row.hipCircumferenceCm, 1)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${srcMeta.cls}`}
                        >
                          {srcMeta.label}
                        </span>
                        {row.notes && (
                          <span
                            className="block text-[10px] text-slate-400 max-w-[140px] truncate mt-0.5"
                            title={row.notes}
                          >
                            {row.notes}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {canEdit && row.sourceType !== 'soap_evolution' ? (
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="px-2 py-1 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg inline-flex items-center gap-1 transition"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Editar</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            {row.sourceType === 'soap_evolution' ? 'Via SOAP' : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal optimized for 1440x900 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {editingEntry
                      ? 'Editar Avaliação de Antropometria / Bioimpedância'
                      : 'Nova Avaliação de Antropometria e Bioimpedância'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {patient.fullName} · Deixe em branco as medidas não aferidas (nunca será salvo 0).
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Data e Hora da Avaliação *
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={measuredAt}
                      onChange={(e) => setMeasuredAt(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tipo de Registro
                    </label>
                    <select
                      value={sourceType}
                      onChange={(e) =>
                        setSourceType(e.target.value === 'bioimpedance' ? 'bioimpedance' : 'manual')
                      }
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="manual">Antropometria / Perimetria Clínica</option>
                      <option value="bioimpedance">Bioimpedância & Perimetria</option>
                    </select>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Peso Corporal & 7 Circunferências (cm)
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Peso (kg)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="Ex: 72.5"
                        value={weightInput}
                        onChange={(e) => setWeightInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-bold text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Abdominal (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={abdominalInput}
                        onChange={(e) => setAbdominalInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Braço D (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={rightArmInput}
                        onChange={(e) => setRightArmInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Braço E (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={leftArmInput}
                        onChange={(e) => setLeftArmInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Perna D (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={rightLegInput}
                        onChange={(e) => setRightLegInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Perna E (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={leftLegInput}
                        onChange={(e) => setLeftLegInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Tórax (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={thoracicInput}
                        onChange={(e) => setThoracicInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Quadril (cm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="—"
                        value={hipInput}
                        onChange={(e) => setHipInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-center"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Observações da Aferição (Opcional)
                  </label>
                  <textarea
                    rows={2}
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="Ex: Paciente em jejum, avaliação pós-drenagem, balança clínica..."
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSaving ? 'Salvando...' : editingEntry ? 'Salvar Alterações' : 'Registrar Avaliação'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const WeightEvolutionSvgChart: React.FC<{
  series: Array<{ id: string; measuredAt: string; weightKg: number }>;
}> = ({ series }) => {
  if (series.length === 0) {
    return (
      <div className="h-40 rounded-xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center text-xs text-slate-400">
        Nenhum registro de peso encontrado no período selecionado.
      </div>
    );
  }

  const width = 760;
  const height = 180;
  const padLeft = 46;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const weights = series.map((s) => s.weightKg);
  const rawMin = Math.min(...weights);
  const rawMax = Math.max(...weights);
  const paddingRange = Math.max(1.5, (rawMax - rawMin) * 0.25);
  const minY = Math.max(0, Math.floor((rawMin - paddingRange) * 10) / 10);
  const maxY = Math.ceil((rawMax + paddingRange) * 10) / 10;
  const spanY = Math.max(1, maxY - minY);

  const coords = series.map((pt, idx) => {
    const x =
      series.length === 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (series.length - 1)) * plotW;
    const y = padTop + plotH - ((pt.weightKg - minY) / spanY) * plotH;
    return { ...pt, x, y };
  });

  const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPath =
    coords.length > 1
      ? `M ${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} ` +
        coords.map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') +
        ` L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : '';

  const yTicks = [minY, minY + spanY / 2, maxY];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 min-w-[480px]"
        role="img"
        aria-label="Gráfico de evolução de peso do paciente"
      >
        <defs>
          <linearGradient id="medsyncWeightArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0284c7" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((val, i) => {
          const y = padTop + plotH - ((val - minY) / spanY) * plotH;
          return (
            <g key={i}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#64748b"
              >
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#medsyncWeightArea)" />}

        {coords.length > 1 && (
          <polyline
            fill="none"
            stroke="#0284c7"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={polylinePoints}
          />
        )}

        {coords.map((pt, idx) => {
          const showLabel =
            coords.length <= 10 ||
            idx === 0 ||
            idx === coords.length - 1 ||
            idx % Math.ceil(coords.length / 8) === 0;
          const dateLabel = new Date(pt.measuredAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
          });
          return (
            <g key={pt.id}>
              <circle cx={pt.x} cy={pt.y} r="4.5" fill="#ffffff" stroke="#0284c7" strokeWidth="2.5" />
              <title>
                {new Date(pt.measuredAt).toLocaleDateString('pt-BR')} —{' '}
                {pt.weightKg.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} kg
              </title>
              {showLabel && (
                <>
                  <text
                    x={pt.x}
                    y={Math.max(12, pt.y - 9)}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#0f172a"
                  >
                    {pt.weightKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </text>
                  <text
                    x={pt.x}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill="#64748b"
                  >
                    {dateLabel}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
