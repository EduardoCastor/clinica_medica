import {
  AnthropometricMeasurement,
  MedicalRecordEntry,
  PatientAnamnesisEntry,
  StructuredAnamnesis,
  TriStateAnswer,
} from '../types';

export const EMPTY_STRUCTURED_ANAMNESIS: StructuredAnamnesis = {
  internacoes: '',
  historiaPatologicaPregressa: '',
  pressaoArterial: '',
  diabetes: '',
  diabetesDetalhes: '',
  doencasTireoide: '',
  doencasTireoideDetalhes: '',
  doencasTireoideFamilia: '',
  doencasTireoideFamiliaDetalhes: '',
  fumante: '',
  fumanteDetalhes: '',
  etilismo: '',
  etilismoDetalhes: '',
  cancer: '',
  cancerDetalhes: '',
  outrosAntecedentes: '',
  cirurgiasPrevias: '',
  cirurgiaQual: '',
  cirurgiaQuando: '',
  indicacaoCirurgia: '',
  indicacaoCirurgiaDetalhes: '',
  transfusaoSanguinea: '',
  dor: '',
  dorDescricao: '',
  alergiasAlimentares: '',
  atividadeFisica: '',
  sono: '',
  estresse: '',
  ansiedade: '',
  funcaoIntestinal: '',
  ingestaoHidrica: '',
  diurese: '',
  antecedentesAlergicos: '',
  reposicaoHormonal: '',
  reposicaoHormonalDetalhes: '',
  cicloMenstrual: '',
  gestacoes: null,
  nascidos: null,
  abortos: null,
  natimortos: null,
  objetivoConsulta: '',
  antecedentesPatologicosFamiliares: '',
  antecedentesPatologicosPaciente: '',
};

const cleanTriState = (val: unknown): TriStateAnswer => {
  if (val === 'sim' || val === 'nao') return val;
  return '';
};

const cleanText = (val: unknown): string => {
  if (typeof val !== 'string') return '';
  return val.trim();
};

const cleanOptionalNonNegativeInt = (val: unknown): number | null => {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

export function normalizeStructuredAnamnesis(
  raw?: Partial<StructuredAnamnesis> | null
): StructuredAnamnesis {
  const src = raw || {};
  const cirurgias = cleanTriState(src.cirurgiasPrevias);
  const indicacaoCirurgia = cleanTriState(src.indicacaoCirurgia);
  const dor = cleanTriState(src.dor);
  const diabetes = cleanTriState(src.diabetes);
  const tireoide = cleanTriState(src.doencasTireoide);
  const tireoideFamilia = cleanTriState(src.doencasTireoideFamilia);
  const fumante = cleanTriState(src.fumante);
  const etilismo = cleanTriState(src.etilismo);
  const cancer = cleanTriState(src.cancer);
  const reposicao = cleanTriState(src.reposicaoHormonal);

  return {
    internacoes: cleanText(src.internacoes),
    historiaPatologicaPregressa: cleanText(src.historiaPatologicaPregressa),
    pressaoArterial: cleanText(src.pressaoArterial),
    diabetes,
    diabetesDetalhes: diabetes === 'sim' ? cleanText(src.diabetesDetalhes) : '',
    doencasTireoide: tireoide,
    doencasTireoideDetalhes: tireoide === 'sim' ? cleanText(src.doencasTireoideDetalhes) : '',
    doencasTireoideFamilia: tireoideFamilia,
    doencasTireoideFamiliaDetalhes:
      tireoideFamilia === 'sim' ? cleanText(src.doencasTireoideFamiliaDetalhes) : '',
    fumante,
    fumanteDetalhes: fumante === 'sim' ? cleanText(src.fumanteDetalhes) : '',
    etilismo,
    etilismoDetalhes: etilismo === 'sim' ? cleanText(src.etilismoDetalhes) : '',
    cancer,
    cancerDetalhes: cancer === 'sim' ? cleanText(src.cancerDetalhes) : '',
    outrosAntecedentes: cleanText(src.outrosAntecedentes),
    cirurgiasPrevias: cirurgias,
    cirurgiaQual: cirurgias === 'sim' ? cleanText(src.cirurgiaQual) : '',
    cirurgiaQuando: cirurgias === 'sim' ? cleanText(src.cirurgiaQuando) : '',
    indicacaoCirurgia,
    indicacaoCirurgiaDetalhes:
      indicacaoCirurgia === 'sim' ? cleanText(src.indicacaoCirurgiaDetalhes) : '',
    transfusaoSanguinea: cleanTriState(src.transfusaoSanguinea),
    dor,
    dorDescricao: dor === 'sim' ? cleanText(src.dorDescricao) : '',
    alergiasAlimentares: cleanText(src.alergiasAlimentares),
    atividadeFisica: cleanText(src.atividadeFisica),
    sono: cleanText(src.sono),
    estresse: cleanText(src.estresse),
    ansiedade: cleanText(src.ansiedade),
    funcaoIntestinal: cleanText(src.funcaoIntestinal),
    ingestaoHidrica: cleanText(src.ingestaoHidrica),
    diurese: cleanText(src.diurese),
    antecedentesAlergicos: cleanText(src.antecedentesAlergicos),
    reposicaoHormonal: reposicao,
    reposicaoHormonalDetalhes:
      reposicao === 'sim' ? cleanText(src.reposicaoHormonalDetalhes) : '',
    cicloMenstrual: cleanText(src.cicloMenstrual),
    gestacoes: cleanOptionalNonNegativeInt(src.gestacoes),
    nascidos: cleanOptionalNonNegativeInt(src.nascidos),
    abortos: cleanOptionalNonNegativeInt(src.abortos),
    natimortos: cleanOptionalNonNegativeInt(src.natimortos),
    objetivoConsulta: cleanText(src.objetivoConsulta),
    antecedentesPatologicosFamiliares: cleanText(src.antecedentesPatologicosFamiliares),
    antecedentesPatologicosPaciente: cleanText(src.antecedentesPatologicosPaciente),
  };
}

export function hasStructuredAnamnesisContent(data?: StructuredAnamnesis | null): boolean {
  if (!data) return false;
  return Object.values(data).some((val) => {
    if (typeof val === 'number') return true;
    if (typeof val === 'string') return val.trim().length > 0;
    return false;
  });
}

/**
 * Converte entrada numérica opcional positiva.
 * REGRA CRÍTICA: Campo vazio, nulo ou omitido retorna `null` (NUNCA 0).
 * Aceita separador decimal vírgula ou ponto (ex.: "72,4" -> 72.4).
 */
export function parseOptionalPositiveMetric(
  raw: unknown,
  label: string,
  maxAllowed: number
): { value: number | null; error?: string } {
  if (raw === null || raw === undefined) {
    return { value: null };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { value: null };
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        value: null,
        error: `${label} deve ser um número maior que zero ou permanecer em branco.`,
      };
    }
    if (parsed > maxAllowed) {
      return {
        value: null,
        error: `${label} excede o limite clínico esperado (${maxAllowed}).`,
      };
    }
    return { value: Math.round(parsed * 100) / 100 };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return {
        value: null,
        error: `${label} deve ser maior que zero ou permanecer em branco.`,
      };
    }
    if (raw > maxAllowed) {
      return {
        value: null,
        error: `${label} excede o limite clínico esperado (${maxAllowed}).`,
      };
    }
    return { value: Math.round(raw * 100) / 100 };
  }

  return { value: null, error: `Valor inválido para ${label}.` };
}

export function hasAnyAnthropometricMetric(
  m: Partial<
    Pick<
      AnthropometricMeasurement,
      | 'weightKg'
      | 'abdominalCircumferenceCm'
      | 'rightArmCircumferenceCm'
      | 'leftArmCircumferenceCm'
      | 'rightLegCircumferenceCm'
      | 'leftLegCircumferenceCm'
      | 'thoracicCircumferenceCm'
      | 'hipCircumferenceCm'
    >
  >
): boolean {
  return (
    (m.weightKg != null && m.weightKg > 0) ||
    (m.abdominalCircumferenceCm != null && m.abdominalCircumferenceCm > 0) ||
    (m.rightArmCircumferenceCm != null && m.rightArmCircumferenceCm > 0) ||
    (m.leftArmCircumferenceCm != null && m.leftArmCircumferenceCm > 0) ||
    (m.rightLegCircumferenceCm != null && m.rightLegCircumferenceCm > 0) ||
    (m.leftLegCircumferenceCm != null && m.leftLegCircumferenceCm > 0) ||
    (m.thoracicCircumferenceCm != null && m.thoracicCircumferenceCm > 0) ||
    (m.hipCircumferenceCm != null && m.hipCircumferenceCm > 0)
  );
}

/**
 * Deriva registro de antropometria a partir de evolução SOAP assinada com peso válido.
 * Nunca preenche circunferências ausentes com 0 (todas permanecem null).
 */
export function buildSoapWeightMeasurementPayload(
  record: Pick<
    MedicalRecordEntry,
    'id' | 'recordDate' | 'status' | 'isSigned' | 'vitalSigns' | 'professionalName'
  >,
  context: {
    organizationId: string;
    branchId: string;
    patientId: string;
    professionalId: string;
    professionalName: string;
  }
): Record<string, unknown> | null {
  const isFinalSigned = record.status === 'signed' || record.isSigned;
  const rawWeight = record.vitalSigns?.weightKg;
  if (!isFinalSigned || rawWeight == null || !Number.isFinite(Number(rawWeight)) || Number(rawWeight) <= 0) {
    return null;
  }

  return {
    organization_id: context.organizationId,
    branch_id: context.branchId,
    patient_id: context.patientId,
    medical_record_id: record.id,
    professional_id: context.professionalId,
    professional_name: record.professionalName || context.professionalName,
    measured_at: record.recordDate || new Date().toISOString(),
    weight_kg: Math.round(Number(rawWeight) * 100) / 100,
    abdominal_circumference_cm: null,
    right_arm_circumference_cm: null,
    left_arm_circumference_cm: null,
    right_leg_circumference_cm: null,
    left_leg_circumference_cm: null,
    thoracic_circumference_cm: null,
    hip_circumference_cm: null,
    source_type: 'soap_evolution',
    notes: 'Peso registrado em evolução clínica (SOAP) assinada.',
  };
}

export function sortAnthropometryDesc(
  list: AnthropometricMeasurement[]
): AnthropometricMeasurement[] {
  return [...list].sort((a, b) => {
    const tA = new Date(a.measuredAt).getTime();
    const tB = new Date(b.measuredAt).getTime();
    if (tB !== tA) return tB - tA;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export type WeightChartPeriod = '30d' | '90d' | '180d' | '365d' | 'all';

export function extractRealWeightSeries(
  measurements: AnthropometricMeasurement[],
  period: WeightChartPeriod,
  referenceNowMs = Date.now()
): Array<{ id: string; measuredAt: string; weightKg: number; sourceType: AnthropometricMeasurement['sourceType'] }> {
  const daysMap: Record<Exclude<WeightChartPeriod, 'all'>, number> = {
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
  };

  const cutoffMs =
    period === 'all' ? Number.NEGATIVE_INFINITY : referenceNowMs - daysMap[period] * 86400_000;

  return measurements
    .filter((m) => m.weightKg != null && Number(m.weightKg) > 0)
    .filter((m) => {
      const ts = new Date(m.measuredAt).getTime();
      return Number.isFinite(ts) && ts >= cutoffMs;
    })
    .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
    .map((m) => ({
      id: m.id,
      measuredAt: m.measuredAt,
      weightKg: Number(m.weightKg),
      sourceType: m.sourceType,
    }));
}

export function formatMetricDisplay(
  value: number | null | undefined,
  decimals = 1,
  unit = ''
): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    return '—';
  }
  const formatted = Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Converte ISO/Date para o formato esperado por <input type="datetime-local">
 * no fuso horário local (evita deslocamento UTC de .toISOString().slice(0, 16)).
 */
export function toLocalDateTimeInputValue(isoOrDate?: string | Date | null): string {
  const parsed = isoOrDate ? new Date(isoOrDate) : new Date();
  const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Reconcilia eventuais registros históricos que gravaram `structured_anamnesis`
 * diretamente em `medical_records` sem entrada correspondente em `patient_anamnesis_records`.
 * Mantém `patient_anamnesis_records` como fonte oficial sem duplicar registros.
 */
export function mergeLegacyAnamnesisFromRecords(
  officialEntries: PatientAnamnesisEntry[],
  medicalRecords: MedicalRecordEntry[]
): PatientAnamnesisEntry[] {
  const linkedRecordIds = new Set(
    officialEntries
      .map((entry) => entry.medicalRecordId)
      .filter((id): id is string => Boolean(id))
  );

  const legacyProjected: PatientAnamnesisEntry[] = [];
  for (const rec of medicalRecords) {
    if (linkedRecordIds.has(rec.id)) continue;
    if (!rec.structuredAnamnesis || !hasStructuredAnamnesisContent(rec.structuredAnamnesis)) {
      continue;
    }
    legacyProjected.push({
      id: `legacy_mr_${rec.id}`,
      organizationId: rec.organizationId,
      branchId: rec.branchId,
      patientId: rec.patientId,
      medicalRecordId: rec.id,
      professionalId: rec.professionalId,
      professionalName: rec.professionalName,
      professionalCouncil: rec.professionalCouncilNumber,
      evaluationDate: rec.recordDate,
      status: rec.status === 'signed' || rec.isSigned ? 'signed' : 'draft',
      structuredData: normalizeStructuredAnamnesis(rec.structuredAnamnesis),
      isSigned: Boolean(rec.isSigned || rec.status === 'signed'),
      signedAt: rec.signedAt,
      signatureHash: rec.signatureHash,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    });
  }

  return [...officialEntries, ...legacyProjected].sort((a, b) => {
    const tA = new Date(a.evaluationDate).getTime() || 0;
    const tB = new Date(b.evaluationDate).getTime() || 0;
    return tB - tA;
  });
}
