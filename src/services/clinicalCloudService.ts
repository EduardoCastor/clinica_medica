import { SupabaseClient } from '@supabase/supabase-js';
import {
  AnthropometricMeasurement,
  AnthropometrySourceType,
  ExamResult,
  LabExamCatalogItem,
  LabOrder,
  LabOrderItem,
  MedicalCertificate,
  MedicalDocument,
  MedicalDocumentType,
  MedicalRecordAddendum,
  MedicalRecordEntry,
  Patient,
  PatientAnamnesisEntry,
  PatientSharingMode,
  Prescription,
  PrescriptionItem,
  StructuredAnamnesis,
} from '../types';
import { getSupabase } from './supabaseClient';
import { StorageService } from './storage';
import {
  buildSoapWeightMeasurementPayload,
  hasAnyAnthropometricMetric,
  mergeLegacyAnamnesisFromRecords,
  normalizeStructuredAnamnesis,
} from './pepClinicalUtils';

export const MEDICAL_DOCUMENTS_BUCKET = 'medical-documents';
const MAX_CLINICAL_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_CLINICAL_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function inferClinicalMimeType(file: File): string {
  const direct = (file.type || '').trim().toLowerCase();
  if (ALLOWED_CLINICAL_MIME_TYPES.has(direct)) return direct;
  const ext = (file.name.split('.').pop() || '').trim().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return direct;
}

export const isUuid = (val?: string | null): val is string =>
  Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()));

const onlyDigits = (val?: string | null): string => (val || '').replace(/\D/g, '');

const nullableText = (val?: string | null): string | null => {
  const t = (val || '').trim();
  return t.length > 0 ? t : null;
};

const nullableDate = (val?: string | null): string | null => {
  const t = (val || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.substring(0, 10) : null;
};

const nullableNumber = (val?: number | string | null): number | null => {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

const sanitizeFileName = (name: string): string => {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `documento_${Date.now()}.pdf`;
};

const formatPgError = (err: unknown, fallback: string): string => {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as { code?: string; message?: string; details?: string; hint?: string };
  if (e.code === '23505') {
    return 'Já existe um registro cadastrado com este CPF nesta clínica (unicidade garantida pelo banco de dados).';
  }
  if (e.code === '42501') {
    return 'Permissão negada para realizar esta operação nesta clínica.';
  }
  if (e.message) {
    return e.details ? `${e.message} (${e.details})` : e.message;
  }
  return fallback;
};

interface ResolvedCloudContext {
  organizationId: string;
  branchId: string;
  professionalId: string;
  professionalName: string;
  professionalCouncil: string;
}

async function resolveCloudOrganizationId(
  supabase: SupabaseClient,
  hintOrgId?: string
): Promise<{ organizationId?: string; error?: string }> {
  let orgId = isUuid(hintOrgId) ? hintOrgId : undefined;
  if (!orgId) {
    const localOrg = StorageService.getOrganization();
    if (isUuid(localOrg.id)) {
      orgId = localOrg.id;
    } else {
      const slug = (localOrg.slug || 'dr-newton-mureb').trim().toLowerCase();
      const { data: orgBySlug, error: slugErr } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', slug)
        .limit(1)
        .maybeSingle();

      if (slugErr) {
        return { error: formatPgError(slugErr, 'Não foi possível localizar a organização no Supabase.') };
      }
      if (orgBySlug?.id) {
        orgId = String(orgBySlug.id);
      } else {
        const { data: firstOrg, error: firstOrgErr } = await supabase
          .from('organizations')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (firstOrgErr) {
          return { error: formatPgError(firstOrgErr, 'Não foi possível consultar organizations no Supabase.') };
        }
        if (firstOrg?.id) orgId = String(firstOrg.id);
      }
    }
  }

  if (!orgId) {
    return { error: 'Nenhuma organização encontrada no Supabase. Execute as migrações e a carga inicial (seed).' };
  }
  return { organizationId: orgId };
}

const mapLabExamCatalogRow = (row: Record<string, unknown>): LabExamCatalogItem => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  name: String(row.name || ''),
  examType:
    row.exam_type === 'imagem' || row.exam_type === 'outros'
      ? row.exam_type
      : 'laboratorial',
  defaultObservations: row.default_observations ? String(row.default_observations) : undefined,
  displayOrder: Number.isFinite(Number(row.display_order)) ? Number(row.display_order) : 1000,
  isActive: row.is_active !== false,
  createdAt: String(row.created_at || new Date().toISOString()),
  updatedAt: row.updated_at ? String(row.updated_at) : undefined,
});

async function resolveCloudContext(
  supabase: SupabaseClient,
  hints?: {
    organizationId?: string;
    branchId?: string;
    professionalId?: string;
    professionalName?: string;
    professionalEmail?: string;
    professionalCouncil?: string;
  }
): Promise<{ context?: ResolvedCloudContext; error?: string }> {
  // 1. Resolve organization UUID
  const orgRes = await resolveCloudOrganizationId(supabase, hints?.organizationId);
  if (!orgRes.organizationId) {
    return { error: orgRes.error };
  }
  const orgId = orgRes.organizationId;

  // 2. Resolve branch UUID
  let branchId = isUuid(hints?.branchId) ? hints!.branchId : undefined;
  if (!branchId) {
    const localBranches = StorageService.getBranches();
    const hintBranch = localBranches.find((b) => b.id === hints?.branchId);

    const { data: branchRows, error: branchErr } = await supabase
      .from('branches')
      .select('id, code, name, is_headquarters')
      .eq('organization_id', orgId)
      .order('is_headquarters', { ascending: false });

    if (branchErr) {
      return { error: formatPgError(branchErr, 'Erro ao resolver filial no Supabase.') };
    }

    const list = (branchRows || []) as Array<{ id: string; code?: string; name?: string; is_headquarters?: boolean }>;
    const matched =
      (hintBranch?.code && list.find((r) => r.code && r.code.toLowerCase() === hintBranch.code.toLowerCase())) ||
      (hintBranch?.name && list.find((r) => r.name && r.name.toLowerCase() === hintBranch.name.toLowerCase())) ||
      list.find((r) => r.is_headquarters) ||
      list[0];

    if (matched?.id) {
      branchId = String(matched.id);
    }
  }

  if (!branchId) {
    return { error: 'Nenhuma filial (branch) cadastrada para esta organização no Supabase.' };
  }

  // 3. Resolve professional UUID
  let professionalId = isUuid(hints?.professionalId) ? hints!.professionalId : undefined;
  let professionalName = hints?.professionalName || 'Dr. Newton Mureb';
  let professionalCouncil = hints?.professionalCouncil || 'CRM/RJ 52-444985';

  if (!professionalId) {
    const { data: profRows, error: profErr } = await supabase
      .from('professionals')
      .select('id, full_name, council_number, email')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (profErr) {
      return { error: formatPgError(profErr, 'Erro ao consultar profissionais no Supabase.') };
    }

    const list = (profRows || []) as Array<{
      id: string;
      full_name: string;
      council_number: string;
      email?: string | null;
    }>;

    const matchedProf =
      (hints?.professionalEmail &&
        list.find((p) => p.email && p.email.toLowerCase() === hints.professionalEmail!.toLowerCase())) ||
      (hints?.professionalName &&
        list.find((p) => p.full_name.toLowerCase() === hints.professionalName!.toLowerCase())) ||
      list[0];

    if (matchedProf?.id) {
      professionalId = String(matchedProf.id);
      professionalName = matchedProf.full_name || professionalName;
      professionalCouncil = matchedProf.council_number || professionalCouncil;
    } else {
      // Create default professional row if DB doesn't have one yet so clinical FKs succeed
      const { data: createdProf, error: insertProfErr } = await supabase
        .from('professionals')
        .insert({
          organization_id: orgId,
          full_name: professionalName,
          council_number: professionalCouncil,
          email: hints?.professionalEmail || 'roseneco1@gmail.com',
          is_active: true,
        })
        .select('id, full_name, council_number')
        .single();

      if (insertProfErr || !createdProf?.id) {
        const pgErr = insertProfErr as { code?: string } | null;
        return {
          error:
            pgErr?.code === '42501'
              ? 'Nenhum profissional cadastrado nesta clínica. Solicite ao administrador que cadastre um profissional em Equipe / Usuários.'
              : formatPgError(
                  insertProfErr,
                  'Nenhum profissional cadastrado no Supabase e não foi possível registrar o profissional responsável.'
                ),
        };
      }
      professionalId = String(createdProf.id);
      professionalName = createdProf.full_name || professionalName;
      professionalCouncil = createdProf.council_number || professionalCouncil;
    }
  }

  return {
    context: {
      organizationId: orgId,
      branchId,
      professionalId,
      professionalName,
      professionalCouncil,
    },
  };
}

async function resolveCloudPatientUuid(
  supabase: SupabaseClient,
  orgId: string,
  patient: Pick<Patient, 'id' | 'documentCpf' | 'fullName'>
): Promise<{ patientUuid?: string; error?: string }> {
  if (isUuid(patient.id)) {
    return { patientUuid: patient.id };
  }

  const cpfDigits = onlyDigits(patient.documentCpf);
  if (cpfDigits.length >= 11) {
    const formatted = `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9, 11)}`;
    const { data, error } = await supabase
      .from('patients')
      .select('id')
      .eq('organization_id', orgId)
      .or(`document_cpf.eq.${formatted},document_cpf.eq.${cpfDigits}`)
      .limit(1)
      .maybeSingle();

    if (error) {
      return { error: formatPgError(error, 'Erro ao localizar paciente por CPF no Supabase.') };
    }
    if (data?.id) {
      return { patientUuid: String(data.id) };
    }
  }

  if (patient.fullName.trim()) {
    const { data } = await supabase
      .from('patients')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('full_name', patient.fullName.trim())
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      return { patientUuid: String(data.id) };
    }
  }

  return {
    error:
      'Este paciente ainda não possui ID persistido no Supabase. Salve o cadastro do paciente antes de vincular documentos médicos.',
  };
}

function mapPatientRow(row: Record<string, unknown>, branchIdsFallback?: string[]): Patient {
  const accessRows = Array.isArray(row.patient_branch_access)
    ? (row.patient_branch_access as Array<{ branch_id?: string }>)
    : [];
  const authorizedBranchIds = accessRows
    .map((a) => (a.branch_id ? String(a.branch_id) : ''))
    .filter(Boolean);

  const originBranchId = String(row.origin_branch_id || '');
  const sharingMode = (row.sharing_mode as PatientSharingMode) || 'model_b_shared';

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    originBranchId,
    fullName: String(row.full_name || ''),
    socialName: row.social_name ? String(row.social_name) : undefined,
    documentCpf: String(row.document_cpf || ''),
    documentRg: row.document_rg ? String(row.document_rg) : undefined,
    documentRgIssuer: row.document_rg_issuer ? String(row.document_rg_issuer) : undefined,
    birthDate: row.birth_date ? String(row.birth_date).substring(0, 10) : '',
    gender: row.gender ? String(row.gender) : 'Não informado',
    biologicalSex: row.biological_sex ? (String(row.biological_sex) as Patient['biologicalSex']) : undefined,
    genderIdentity: row.gender_identity ? String(row.gender_identity) : undefined,
    maritalStatus: row.marital_status ? (String(row.marital_status) as Patient['maritalStatus']) : undefined,
    profession: row.profession ? String(row.profession) : undefined,
    nationality: row.nationality ? String(row.nationality) : undefined,
    naturalness: row.naturalness ? String(row.naturalness) : undefined,
    phone: String(row.phone || ''),
    whatsapp: String(row.whatsapp || row.phone || ''),
    email: String(row.email || ''),
    postalCode: row.postal_code ? String(row.postal_code) : undefined,
    address: row.address ? String(row.address) : undefined,
    addressNumber: row.address_number ? String(row.address_number) : undefined,
    complement: row.complement ? String(row.complement) : undefined,
    neighborhood: row.neighborhood ? String(row.neighborhood) : undefined,
    city: row.city ? String(row.city) : undefined,
    state: row.state ? String(row.state) : undefined,
    bloodType: (row.blood_type as Patient['bloodType']) || 'desconhecido',
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : undefined,
    heightCm: row.height_cm != null ? Number(row.height_cm) : undefined,
    calculatedBmi: row.calculated_bmi != null ? Number(row.calculated_bmi) : undefined,
    allergies: Array.isArray(row.allergies) ? (row.allergies as string[]) : [],
    chronicDiseases: Array.isArray(row.chronic_diseases) ? (row.chronic_diseases as string[]) : [],
    continuousMedications: Array.isArray(row.continuous_medications)
      ? (row.continuous_medications as string[])
      : [],
    healthPlanType: row.health_plan_type === 'convenio' ? 'convenio' : 'particular',
    healthPlanOperator: row.health_plan_operator ? String(row.health_plan_operator) : undefined,
    healthPlanNumber: row.health_plan_number ? String(row.health_plan_number) : undefined,
    healthPlanValidity: row.health_plan_validity
      ? String(row.health_plan_validity).substring(0, 10)
      : undefined,
    healthPlanCategory: row.health_plan_category ? String(row.health_plan_category) : undefined,
    cnsNumber: row.cns_number ? String(row.cns_number) : undefined,
    emergencyContactName: row.emergency_contact_name ? String(row.emergency_contact_name) : undefined,
    emergencyContactPhone: row.emergency_contact_phone ? String(row.emergency_contact_phone) : undefined,
    emergencyContactKinship: row.emergency_contact_kinship
      ? String(row.emergency_contact_kinship)
      : undefined,
    legalGuardianName: row.legal_guardian_name ? String(row.legal_guardian_name) : undefined,
    legalGuardianCpf: row.legal_guardian_cpf ? String(row.legal_guardian_cpf) : undefined,
    legalGuardianKinship: row.legal_guardian_kinship ? String(row.legal_guardian_kinship) : undefined,
    legalGuardianPhone: row.legal_guardian_phone ? String(row.legal_guardian_phone) : undefined,
    lgpdConsent: Boolean(row.lgpd_consent),
    lgpdConsentDate: row.lgpd_consent_date ? String(row.lgpd_consent_date) : undefined,
    administrativeNotes: row.administrative_notes ? String(row.administrative_notes) : undefined,
    sharingMode,
    authorizedBranchIds:
      authorizedBranchIds.length > 0
        ? authorizedBranchIds
        : branchIdsFallback || (originBranchId ? [originBranchId] : []),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    isActive: row.is_active !== false,
  };
}

function mapMedicalRecordRow(
  row: Record<string, unknown>,
  addendums: MedicalRecordAddendum[],
  profMap: Map<string, { fullName: string; councilNumber: string }>
): MedicalRecordEntry {
  const profId = String(row.professional_id || '');
  const profInfo = profMap.get(profId);

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    patientId: String(row.patient_id),
    branchId: String(row.branch_id),
    professionalId: profId,
    professionalName: String(
      row.signed_by_professional_name || profInfo?.fullName || 'Dr. Newton Mureb'
    ),
    professionalCouncilNumber: String(
      row.signed_by_council_number || profInfo?.councilNumber || 'CRM/RJ 52-444985'
    ),
    appointmentId: row.appointment_id ? String(row.appointment_id) : undefined,
    recordDate: String(row.record_date || row.created_at || new Date().toISOString()),
    status: row.status === 'draft' ? 'draft' : 'signed',
    consultationType: row.consultation_type === 'free_text' ? 'free_text' : 'soap',
    chiefComplaint: String(row.chief_complaint || ''),
    clinicalHistory: String(row.clinical_history || ''),
    structuredAnamnesis:
      row.structured_anamnesis && typeof row.structured_anamnesis === 'object'
        ? normalizeStructuredAnamnesis(row.structured_anamnesis as Partial<StructuredAnamnesis>)
        : undefined,
    vitalSigns: (row.vital_signs as MedicalRecordEntry['vitalSigns']) || undefined,
    physicalExam: row.physical_exam ? String(row.physical_exam) : undefined,
    diagnosticHypothesis: row.diagnostic_hypothesis ? String(row.diagnostic_hypothesis) : undefined,
    cid10Codes: Array.isArray(row.cid10_codes)
      ? (row.cid10_codes as Array<{ code: string; description: string }>)
      : [],
    therapeuticPlan: String(row.therapeutic_plan || ''),
    prescriptions: String(row.prescriptions || ''),
    examRequests: row.exam_requests ? String(row.exam_requests) : undefined,
    evolutionNotes: row.evolution_notes ? String(row.evolution_notes) : undefined,
    isSigned: Boolean(row.is_signed),
    signedAt: row.signed_at ? String(row.signed_at) : undefined,
    signatureHash: row.signature_hash ? String(row.signature_hash) : undefined,
    addendums,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapAnamnesisRecordRow(
  row: Record<string, unknown>,
  profMap: Map<string, { fullName: string; councilNumber: string }>
): PatientAnamnesisEntry {
  const profId = String(row.professional_id || '');
  const profInfo = profMap.get(profId);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    branchId: String(row.branch_id),
    patientId: String(row.patient_id),
    medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
    professionalId: profId,
    professionalName: String(row.professional_name || profInfo?.fullName || 'Dr. Newton Mureb'),
    professionalCouncil: String(
      row.professional_council || profInfo?.councilNumber || 'CRM/RJ 52-444985'
    ),
    evaluationDate: String(row.evaluation_date || row.created_at || new Date().toISOString()),
    status: row.status === 'signed' ? 'signed' : 'draft',
    structuredData: normalizeStructuredAnamnesis(
      (row.structured_data as Partial<StructuredAnamnesis>) || {}
    ),
    isSigned: Boolean(row.is_signed),
    signedAt: row.signed_at ? String(row.signed_at) : undefined,
    signatureHash: row.signature_hash ? String(row.signature_hash) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

const mapPositiveDecimalOrNull = (val: unknown): number | null => {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function mapAnthropometricMeasurementRow(
  row: Record<string, unknown>,
  profMap: Map<string, { fullName: string; councilNumber: string }>
): AnthropometricMeasurement {
  const profId = row.professional_id ? String(row.professional_id) : undefined;
  const profInfo = profId ? profMap.get(profId) : undefined;
  const rawSource = String(row.source_type || 'manual');
  const sourceType: AnthropometrySourceType =
    rawSource === 'soap_evolution' || rawSource === 'bioimpedance' ? rawSource : 'manual';

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    branchId: String(row.branch_id),
    patientId: String(row.patient_id),
    medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
    professionalId: profId,
    professionalName: row.professional_name
      ? String(row.professional_name)
      : profInfo?.fullName || undefined,
    measuredAt: String(row.measured_at || row.created_at || new Date().toISOString()),
    weightKg: mapPositiveDecimalOrNull(row.weight_kg),
    abdominalCircumferenceCm: mapPositiveDecimalOrNull(row.abdominal_circumference_cm),
    rightArmCircumferenceCm: mapPositiveDecimalOrNull(row.right_arm_circumference_cm),
    leftArmCircumferenceCm: mapPositiveDecimalOrNull(row.left_arm_circumference_cm),
    rightLegCircumferenceCm: mapPositiveDecimalOrNull(row.right_leg_circumference_cm),
    leftLegCircumferenceCm: mapPositiveDecimalOrNull(row.left_leg_circumference_cm),
    thoracicCircumferenceCm: mapPositiveDecimalOrNull(row.thoracic_circumference_cm),
    hipCircumferenceCm: mapPositiveDecimalOrNull(row.hip_circumference_cm),
    sourceType,
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export interface ClinicalPatientBundle {
  source: 'supabase' | 'local';
  resolvedPatientId: string;
  records: MedicalRecordEntry[];
  prescriptions: Prescription[];
  certificates: MedicalCertificate[];
  labOrders: LabOrder[];
  examResults: ExamResult[];
  documents: MedicalDocument[];
  anamnesisRecords: PatientAnamnesisEntry[];
  anthropometryMeasurements: AnthropometricMeasurement[];
  error?: string;
  warning?: string;
}

export const ClinicalCloudService = {
  // =========================================================================
  // 1. PATIENTS (SUPABASE REAL CRUD + LOCAL FALLBACK WHEN DISCONNECTED)
  // =========================================================================

  fetchPatientsFromCloud: async (
    branchFilterId?: string
  ): Promise<{ patients: Patient[]; source: 'supabase' | 'local'; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        patients: [],
        source: 'local',
        error: 'Conexão com o Supabase não configurada neste ambiente.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, { branchId: branchFilterId });
      if (!ctxRes.context) {
        return { patients: [], source: 'supabase', error: ctxRes.error };
      }

      const { organizationId } = ctxRes.context;
      const { data, error } = await supabase
        .from('patients')
        .select('*, patient_branch_access (branch_id)')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          patients: [],
          source: 'supabase',
          error: formatPgError(error, 'Erro ao carregar pacientes do Supabase.'),
        };
      }

      const mapped = ((data || []) as Array<Record<string, unknown>>).map((row) =>
        mapPatientRow(row)
      );

      StorageService.replacePatientsCache(mapped);

      if (!branchFilterId || branchFilterId === 'all') {
        return { patients: mapped, source: 'supabase' };
      }

      const filtered = mapped.filter((p) => {
        if (p.originBranchId === branchFilterId) return true;
        if (p.sharingMode === 'model_b_shared' && p.authorizedBranchIds?.includes(branchFilterId)) {
          return true;
        }
        if (!isUuid(branchFilterId)) return true;
        return false;
      });

      return { patients: filtered, source: 'supabase' };
    } catch (err) {
      return {
        patients: [],
        source: 'supabase',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  fetchPatientByIdFromCloud: async (
    patientId: string
  ): Promise<{ patient?: Patient; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { error: 'Conexão com o Supabase não configurada neste ambiente.' };
    }
    if (!isUuid(patientId)) {
      return { error: 'ID de paciente inválido para consulta no banco.' };
    }

    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*, patient_branch_access (branch_id)')
        .eq('id', patientId)
        .maybeSingle();

      if (error || !data) {
        return {
          error: formatPgError(error, 'Paciente não localizado no banco de dados.'),
        };
      }

      const mapped = mapPatientRow(data as Record<string, unknown>);
      StorageService.upsertPatientCacheById(mapped);
      return { patient: mapped };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  savePatientToCloud: async (
    patient: Patient
  ): Promise<{ success: boolean; patient?: Patient; source: 'supabase' | 'local'; message?: string }> => {
    const supabase = getSupabase();

    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar cadastro de paciente fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: patient.organizationId,
        branchId: patient.originBranchId,
      });

      if (!ctxRes.context) {
        return {
          success: false,
          source: 'supabase',
          message: ctxRes.error || 'Falha ao resolver organização/filial no Supabase.',
        };
      }

      const { organizationId, branchId: resolvedBranchId } = ctxRes.context;
      const cpfDigits = onlyDigits(patient.documentCpf);

      // Check duplicate CPF inside the same organization before writing
      const { data: existingCpfRows, error: cpfLookupErr } = await supabase
        .from('patients')
        .select('id, full_name, document_cpf')
        .eq('organization_id', organizationId);

      if (cpfLookupErr) {
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(cpfLookupErr, 'Erro ao validar duplicidade de CPF no banco.'),
        };
      }

      const duplicateRow = ((existingCpfRows || []) as Array<{ id: string; full_name: string; document_cpf: string }>).find(
        (r) => r.id !== patient.id && onlyDigits(r.document_cpf) === cpfDigits && cpfDigits.length >= 11
      );

      if (duplicateRow) {
        return {
          success: false,
          source: 'supabase',
          message: `Já existe um paciente cadastrado com este CPF (${duplicateRow.full_name}). Evite duplicidades.`,
        };
      }

      const dbPayload: Record<string, unknown> = {
        organization_id: organizationId,
        origin_branch_id: resolvedBranchId,
        full_name: patient.fullName.trim(),
        social_name: nullableText(patient.socialName),
        document_cpf: patient.documentCpf.trim(),
        document_rg: nullableText(patient.documentRg),
        document_rg_issuer: nullableText(patient.documentRgIssuer),
        birth_date: nullableDate(patient.birthDate),
        gender: nullableText(patient.gender),
        biological_sex: nullableText(patient.biologicalSex),
        gender_identity: nullableText(patient.genderIdentity),
        marital_status: nullableText(patient.maritalStatus),
        profession: nullableText(patient.profession),
        nationality: nullableText(patient.nationality) || 'Brasileira',
        naturalness: nullableText(patient.naturalness),
        phone: patient.phone.trim(),
        whatsapp: nullableText(patient.whatsapp) || patient.phone.trim(),
        email: nullableText(patient.email),
        postal_code: nullableText(patient.postalCode),
        address: nullableText(patient.address),
        address_number: nullableText(patient.addressNumber),
        complement: nullableText(patient.complement),
        neighborhood: nullableText(patient.neighborhood),
        city: nullableText(patient.city),
        state: nullableText(patient.state),
        blood_type: nullableText(patient.bloodType) || 'desconhecido',
        weight_kg: nullableNumber(patient.weightKg),
        height_cm: nullableNumber(patient.heightCm),
        calculated_bmi: nullableNumber(patient.calculatedBmi),
        allergies: patient.allergies || [],
        chronic_diseases: patient.chronicDiseases || [],
        continuous_medications: patient.continuousMedications || [],
        health_plan_type: patient.healthPlanType || 'particular',
        health_plan_operator:
          patient.healthPlanType === 'convenio' ? nullableText(patient.healthPlanOperator) : null,
        health_plan_number:
          patient.healthPlanType === 'convenio' ? nullableText(patient.healthPlanNumber) : null,
        health_plan_validity:
          patient.healthPlanType === 'convenio' ? nullableDate(patient.healthPlanValidity) : null,
        health_plan_category:
          patient.healthPlanType === 'convenio' ? nullableText(patient.healthPlanCategory) : null,
        cns_number: nullableText(patient.cnsNumber),
        emergency_contact_name: nullableText(patient.emergencyContactName),
        emergency_contact_phone: nullableText(patient.emergencyContactPhone),
        emergency_contact_kinship: nullableText(patient.emergencyContactKinship),
        legal_guardian_name: nullableText(patient.legalGuardianName),
        legal_guardian_cpf: nullableText(patient.legalGuardianCpf),
        legal_guardian_kinship: nullableText(patient.legalGuardianKinship),
        legal_guardian_phone: nullableText(patient.legalGuardianPhone),
        lgpd_consent: Boolean(patient.lgpdConsent),
        lgpd_consent_date: patient.lgpdConsent
          ? patient.lgpdConsentDate || new Date().toISOString()
          : null,
        administrative_notes: nullableText(patient.administrativeNotes),
        sharing_mode: patient.sharingMode || 'model_b_shared',
        is_active: patient.isActive !== false,
      };

      const isUpdate = isUuid(patient.id);
      let savedRow: Record<string, unknown> | null = null;

      if (isUpdate) {
        const { data, error } = await supabase
          .from('patients')
          .update(dbPayload)
          .eq('id', patient.id)
          .eq('organization_id', organizationId)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Falha ao atualizar dados do paciente no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      } else {
        const { data, error } = await supabase
          .from('patients')
          .insert(dbPayload)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Falha ao cadastrar novo paciente no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      }

      const savedPatientId = String(savedRow.id);

      // Sync patient_branch_access for UUID branches
      const targetBranchIds = Array.from(
        new Set(
          (patient.sharingMode === 'model_b_shared'
            ? (patient.authorizedBranchIds || []).filter(isUuid)
            : [resolvedBranchId]
          ).concat([resolvedBranchId])
        )
      );

      const { error: deleteAccessErr } = await supabase
        .from('patient_branch_access')
        .delete()
        .eq('patient_id', savedPatientId);
      if (deleteAccessErr) {
        console.warn('Aviso ao limpar patient_branch_access:', deleteAccessErr.message);
      }
      if (targetBranchIds.length > 0) {
        const accessInserts = targetBranchIds.map((bId) => ({
          organization_id: organizationId,
          patient_id: savedPatientId,
          branch_id: bId,
          can_view_records: true,
          can_edit_records: true,
          can_schedule: true,
        }));
        const { error: accessErr } = await supabase
          .from('patient_branch_access')
          .insert(accessInserts);
        if (accessErr) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(
              accessErr,
              'Paciente salvo parcialmente, mas falhou ao atualizar compartilhamento entre filiais.'
            ),
          };
        }
      }

      const mappedPatient = mapPatientRow(savedRow, targetBranchIds);
      StorageService.upsertPatientCacheById(mappedPatient, !isUpdate ? patient.id : undefined);

      StorageService.addAuditLog({
        action: isUpdate ? 'Atualizou Paciente (Supabase)' : 'Cadastrou Novo Paciente (Supabase)',
        entity: 'Paciente',
        entityId: mappedPatient.id,
        details: `${mappedPatient.fullName} (${mappedPatient.documentCpf})`,
      });

      return { success: true, patient: mappedPatient, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro inesperado ao salvar paciente no banco.',
      };
    }
  },

  // =========================================================================
  // 2. MEDICAL RECORDS & DOCUMENTS BUNDLE FETCH
  // =========================================================================

  fetchPatientClinicalBundleFromCloud: async (
    patient: Patient
  ): Promise<ClinicalPatientBundle> => {
    const emptyCloudBundle = (errorMsg?: string): ClinicalPatientBundle => ({
      source: 'supabase',
      resolvedPatientId: patient.id,
      records: [],
      prescriptions: [],
      certificates: [],
      labOrders: [],
      examResults: [],
      documents: [],
      anamnesisRecords: [],
      anthropometryMeasurements: [],
      error: errorMsg,
    });

    const supabase = getSupabase();
    if (!supabase) {
      return emptyCloudBundle('Conexão com o Supabase não configurada neste ambiente.');
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, { organizationId: patient.organizationId });
      if (!ctxRes.context) {
        return emptyCloudBundle(ctxRes.error);
      }

      const { organizationId } = ctxRes.context;
      const patRes = await resolveCloudPatientUuid(supabase, organizationId, patient);
      if (!patRes.patientUuid) {
        return emptyCloudBundle(patRes.error);
      }

      const patientUuid = patRes.patientUuid;

      const [
        profRes,
        recRes,
        rxRes,
        certRes,
        orderRes,
        examRes,
        docRes,
        anamnesisRes,
        anthropometryRes,
      ] = await Promise.all([
        supabase
          .from('professionals')
          .select('id, full_name, council_number')
          .eq('organization_id', organizationId),
        supabase
          .from('medical_records')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('record_date', { ascending: false }),
        supabase
          .from('prescriptions')
          .select('*, prescription_items (*)')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('created_at', { ascending: false }),
        supabase
          .from('medical_certificates')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('created_at', { ascending: false }),
        supabase
          .from('lab_orders')
          .select('*, lab_order_items (*)')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('created_at', { ascending: false }),
        supabase
          .from('exam_results')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('performed_date', { ascending: false }),
        supabase
          .from('medical_documents')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('document_date', { ascending: false }),
        supabase
          .from('patient_anamnesis_records')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('evaluation_date', { ascending: false }),
        supabase
          .from('patient_anthropometric_measurements')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('patient_id', patientUuid)
          .order('measured_at', { ascending: false }),
      ]);

      const firstError =
        recRes.error ||
        rxRes.error ||
        certRes.error ||
        orderRes.error ||
        examRes.error ||
        docRes.error;

      if (firstError) {
        return emptyCloudBundle(
          formatPgError(firstError, 'Erro ao carregar documentos médicos do paciente.')
        );
      }

      const profMap = new Map<string, { fullName: string; councilNumber: string }>();
      for (const p of (profRes.data || []) as Array<Record<string, unknown>>) {
        profMap.set(String(p.id), {
          fullName: String(p.full_name || 'Dr. Newton Mureb'),
          councilNumber: String(p.council_number || 'CRM/RJ 52-444985'),
        });
      }

      const recordRows = (recRes.data || []) as Array<Record<string, unknown>>;
      const recordIds = recordRows.map((r) => String(r.id));
      const addendumsByRecord = new Map<string, MedicalRecordAddendum[]>();

      if (recordIds.length > 0) {
        const { data: addendumRows } = await supabase
          .from('medical_record_addendums')
          .select('*')
          .in('record_id', recordIds)
          .order('created_at', { ascending: true });

        for (const ad of (addendumRows || []) as Array<Record<string, unknown>>) {
          const recId = String(ad.record_id);
          const list = addendumsByRecord.get(recId) || [];
          list.push({
            id: String(ad.id),
            recordId: recId,
            authorId: String(ad.author_id),
            authorName: String(ad.author_name),
            authorCouncilNumber: String(ad.author_council_number),
            note: String(ad.note),
            createdAt: String(ad.created_at),
            signatureHash: String(ad.signature_hash),
          });
          addendumsByRecord.set(recId, list);
        }
      }

      const records = recordRows.map((row) =>
        mapMedicalRecordRow(row, addendumsByRecord.get(String(row.id)) || [], profMap)
      );

      const prescriptions: Prescription[] = ((rxRes.data || []) as Array<Record<string, unknown>>).map(
        (row) => {
          const prof = profMap.get(String(row.professional_id || ''));
          const rawItems = Array.isArray(row.prescription_items)
            ? (row.prescription_items as Array<Record<string, unknown>>)
            : [];
          return {
            id: String(row.id),
            organizationId: String(row.organization_id),
            branchId: String(row.branch_id),
            patientId: String(row.patient_id),
            medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
            patientName: patient.fullName,
            patientCpf: patient.documentCpf,
            patientAddress: patient.address
              ? `${patient.address}, ${patient.addressNumber || ''} - ${patient.city || ''}/${patient.state || ''}`
              : undefined,
            professionalId: String(row.professional_id),
            professionalName: String(
              row.professional_name || prof?.fullName || 'Dr. Newton Mureb'
            ),
            professionalCouncil: String(
              row.professional_council || prof?.councilNumber || 'CRM/RJ 52-444985'
            ),
            type: row.type === 'controle_especial' ? 'controle_especial' : 'simples',
            specialControlNotificationType: row.special_control_notification_type
              ? (String(row.special_control_notification_type) as Prescription['specialControlNotificationType'])
              : undefined,
            prescriptionDate: String(row.prescription_date).substring(0, 10),
            validityDays: Number(row.validity_days || 30),
            items: rawItems.map(
              (it): PrescriptionItem => ({
                id: String(it.id),
                medicineName: String(it.medicine_name || ''),
                concentration: String(it.concentration || ''),
                pharmaceuticalForm: String(it.pharmaceutical_form || ''),
                dosageInstruction: String(it.dosage_instruction || ''),
                treatmentDuration: String(it.treatment_duration || ''),
                quantity: String(it.quantity || ''),
                administrationRoute: String(it.administration_route || 'Oral'),
              })
            ),
            generalInstructions: row.general_instructions ? String(row.general_instructions) : undefined,
            isSigned: Boolean(row.is_signed),
            signatureHash: row.signature_hash ? String(row.signature_hash) : undefined,
            buyerIdentification: (row.buyer_identification as Prescription['buyerIdentification']) || undefined,
            createdAt: String(row.created_at),
          };
        }
      );

      const certificates: MedicalCertificate[] = (
        (certRes.data || []) as Array<Record<string, unknown>>
      ).map((row) => {
        const prof = profMap.get(String(row.professional_id || ''));
        return {
          id: String(row.id),
          organizationId: String(row.organization_id),
          branchId: String(row.branch_id),
          patientId: String(row.patient_id),
          medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
          patientName: patient.fullName,
          patientCpf: patient.documentCpf,
          patientSocialName: patient.socialName,
          professionalId: String(row.professional_id),
          professionalName: String(
            row.professional_name || prof?.fullName || 'Dr. Newton Mureb'
          ),
          professionalCouncil: String(
            row.professional_council || prof?.councilNumber || 'CRM/RJ 52-444985'
          ),
          type: (row.type as MedicalCertificate['type']) || 'afastamento',
          issueDate: String(row.issue_date).substring(0, 10),
          startDate: row.start_date ? String(row.start_date).substring(0, 10) : undefined,
          daysOff: row.days_off != null ? Number(row.days_off) : undefined,
          hoursOff: row.hours_off ? String(row.hours_off) : undefined,
          periodDescription: row.period_description ? String(row.period_description) : undefined,
          activityPermitted: row.activity_permitted ? String(row.activity_permitted) : undefined,
          companionName: row.companion_name ? String(row.companion_name) : undefined,
          companionKinship: row.companion_kinship ? String(row.companion_kinship) : undefined,
          cid10Code: row.cid10_code ? String(row.cid10_code) : undefined,
          cid10Description: row.cid10_description ? String(row.cid10_description) : undefined,
          showCidOnPrint: Boolean(row.show_cid_on_print),
          purpose: row.purpose ? String(row.purpose) : undefined,
          notes: row.notes ? String(row.notes) : undefined,
          isSigned: Boolean(row.is_signed),
          signatureHash: row.signature_hash ? String(row.signature_hash) : undefined,
          createdAt: String(row.created_at),
        };
      });

      const labOrders: LabOrder[] = ((orderRes.data || []) as Array<Record<string, unknown>>).map(
        (row) => {
          const prof = profMap.get(String(row.professional_id || ''));
          const rawItems = Array.isArray(row.lab_order_items)
            ? (row.lab_order_items as Array<Record<string, unknown>>)
            : [];
          return {
            id: String(row.id),
            organizationId: String(row.organization_id),
            branchId: String(row.branch_id),
            patientId: String(row.patient_id),
            medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
            patientName: patient.fullName,
            patientCpf: patient.documentCpf,
            professionalId: String(row.professional_id),
            professionalName: String(
              row.professional_name || prof?.fullName || 'Dr. Newton Mureb'
            ),
            professionalCouncil: String(
              row.professional_council || prof?.councilNumber || 'CRM/RJ 52-444985'
            ),
            orderDate: String(row.order_date).substring(0, 10),
            clinicalIndication: String(row.clinical_indication || ''),
            items: [...rawItems]
              .sort((a, b) => {
                const ta = String(a.created_at || '');
                const tb = String(b.created_at || '');
                return ta.localeCompare(tb);
              })
              .map(
                (it): LabOrderItem => ({
                  id: String(it.id),
                  examName: String(it.exam_name || ''),
                  examType: (it.exam_type as LabOrderItem['examType']) || 'laboratorial',
                  urgency: it.urgency === 'urgente' ? 'urgente' : 'rotina',
                  observations: it.observations ? String(it.observations) : undefined,
                  catalogExamId: it.catalog_exam_id ? String(it.catalog_exam_id) : undefined,
                  isCustom: Boolean(it.is_custom),
                })
              ),
            notes: row.notes ? String(row.notes) : undefined,
            isSigned: Boolean(row.is_signed),
            signatureHash: row.signature_hash ? String(row.signature_hash) : undefined,
            status: (row.status as LabOrder['status']) || 'requested',
            createdAt: String(row.created_at),
          };
        }
      );

      const examResults: ExamResult[] = ((examRes.data || []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          organizationId: String(row.organization_id),
          branchId: row.branch_id ? String(row.branch_id) : undefined,
          patientId: String(row.patient_id),
          orderId: row.order_id ? String(row.order_id) : undefined,
          medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
          professionalId: row.professional_id ? String(row.professional_id) : undefined,
          examName: String(row.exam_name || ''),
          examCategory: (row.exam_category as ExamResult['examCategory']) || 'laboratorial',
          performedDate: String(row.performed_date).substring(0, 10),
          laboratoryName: String(row.laboratory_name || ''),
          reportSummary: String(row.report_summary || ''),
          referenceValues: row.reference_values ? String(row.reference_values) : undefined,
          status: (row.status as ExamResult['status']) || 'evaluated',
          attachmentUrl: row.attachment_url ? String(row.attachment_url) : undefined,
          storageBucket: row.storage_bucket ? String(row.storage_bucket) : undefined,
          storagePath: row.storage_path ? String(row.storage_path) : undefined,
          attachmentFilename: row.attachment_filename ? String(row.attachment_filename) : undefined,
          attachmentMimeType: row.attachment_mime_type ? String(row.attachment_mime_type) : undefined,
          attachmentSizeBytes:
            row.attachment_size_bytes != null ? Number(row.attachment_size_bytes) : undefined,
          evaluatedByProfessionalName: row.evaluated_by_professional_name
            ? String(row.evaluated_by_professional_name)
            : undefined,
          evaluatedAt: row.evaluated_at ? String(row.evaluated_at) : undefined,
          notes: row.notes ? String(row.notes) : undefined,
          createdAt: String(row.created_at),
        })
      );

      const documents: MedicalDocument[] = ((docRes.data || []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          organizationId: String(row.organization_id),
          branchId: row.branch_id ? String(row.branch_id) : undefined,
          patientId: String(row.patient_id),
          medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
          professionalId: row.professional_id ? String(row.professional_id) : undefined,
          professionalName: row.professional_name ? String(row.professional_name) : undefined,
          documentType: (row.document_type as MedicalDocumentType) || 'laudo_externo',
          title: String(row.title || ''),
          description: row.description ? String(row.description) : undefined,
          documentDate: String(row.document_date).substring(0, 10),
          storageBucket: String(row.storage_bucket || MEDICAL_DOCUMENTS_BUCKET),
          storagePath: String(row.storage_path || ''),
          fileName: String(row.file_name || ''),
          mimeType: row.mime_type ? String(row.mime_type) : undefined,
          fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,
          createdAt: String(row.created_at),
          updatedAt: row.updated_at ? String(row.updated_at) : undefined,
        })
      );

      const officialAnamnesisRecords: PatientAnamnesisEntry[] = anamnesisRes.error
        ? []
        : ((anamnesisRes.data || []) as Array<Record<string, unknown>>).map((row) =>
            mapAnamnesisRecordRow(row, profMap)
          );

      const anamnesisRecords = mergeLegacyAnamnesisFromRecords(
        officialAnamnesisRecords,
        records
      );

      const anthropometryMeasurements: AnthropometricMeasurement[] = anthropometryRes.error
        ? []
        : ((anthropometryRes.data || []) as Array<Record<string, unknown>>).map((row) =>
            mapAnthropometricMeasurementRow(row, profMap)
          );

      const subErrors = [
        anamnesisRes.error
          ? `Anamnese estruturada: ${formatPgError(anamnesisRes.error, 'erro ao consultar patient_anamnesis_records.')}`
          : null,
        anthropometryRes.error
          ? `Antropometria: ${formatPgError(anthropometryRes.error, 'erro ao consultar patient_anthropometric_measurements.')}`
          : null,
      ].filter((msg): msg is string => Boolean(msg));

      // Update local caches per patient cleanly
      StorageService.replacePatientClinicalCache(patientUuid, {
        records,
        prescriptions,
        certificates,
        labOrders,
        examResults,
        documents,
        anamnesisRecords,
        anthropometryMeasurements,
      });

      return {
        source: 'supabase',
        resolvedPatientId: patientUuid,
        records,
        prescriptions,
        certificates,
        labOrders,
        examResults,
        documents,
        anamnesisRecords,
        anthropometryMeasurements,
        warning: subErrors.length > 0 ? subErrors.join(' | ') : undefined,
      };
    } catch (err) {
      return {
        source: 'supabase',
        resolvedPatientId: patient.id,
        records: [],
        prescriptions: [],
        certificates: [],
        labOrders: [],
        examResults: [],
        documents: [],
        anamnesisRecords: [],
        anthropometryMeasurements: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  // =========================================================================
  // 3. INDIVIDUAL DOCUMENT WRITES (STRICT ERROR HANDLING, NO FAKE SUCCESS)
  // =========================================================================

  saveMedicalRecordToCloud: async (
    record: MedicalRecordEntry,
    patient: Patient
  ): Promise<{ success: boolean; record?: MedicalRecordEntry; source: 'supabase' | 'local'; message?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar evoluções clínicas fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: record.organizationId,
        branchId: record.branchId,
        professionalId: record.professionalId,
        professionalName: record.professionalName,
        professionalCouncil: record.professionalCouncilNumber,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      const payload: Record<string, unknown> = {
        organization_id: ctxRes.context.organizationId,
        patient_id: patRes.patientUuid,
        branch_id: ctxRes.context.branchId,
        professional_id: ctxRes.context.professionalId,
        appointment_id: isUuid(record.appointmentId) ? record.appointmentId : null,
        record_date: record.recordDate || new Date().toISOString(),
        status: record.status,
        consultation_type: record.consultationType || 'soap',
        chief_complaint: record.chiefComplaint.trim(),
        clinical_history: nullableText(record.clinicalHistory),
        structured_anamnesis: record.structuredAnamnesis
          ? normalizeStructuredAnamnesis(record.structuredAnamnesis)
          : null,
        vital_signs: record.vitalSigns || null,
        physical_exam: nullableText(record.physicalExam),
        diagnostic_hypothesis: nullableText(record.diagnosticHypothesis),
        cid10_codes: record.cid10Codes || [],
        therapeutic_plan: record.therapeuticPlan.trim(),
        prescriptions: nullableText(record.prescriptions),
        exam_requests: nullableText(record.examRequests),
        evolution_notes: nullableText(record.evolutionNotes),
        is_signed: record.status === 'signed',
        signed_at: record.status === 'signed' ? record.signedAt || new Date().toISOString() : null,
        signed_by_professional_name:
          record.professionalName || ctxRes.context.professionalName,
        signed_by_council_number:
          record.professionalCouncilNumber || ctxRes.context.professionalCouncil,
        signature_hash: record.status === 'signed' ? record.signatureHash || null : null,
      };

      const isUpdate = isUuid(record.id);
      let savedRow: Record<string, unknown> | null = null;

      if (isUpdate) {
        const { data: existing, error: fetchErr } = await supabase
          .from('medical_records')
          .select('id, is_signed, status')
          .eq('id', record.id)
          .single();

        if (fetchErr || !existing) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(fetchErr, 'Evolução original não encontrada para atualização.'),
          };
        }

        if (existing.is_signed || existing.status === 'signed') {
          return {
            success: false,
            source: 'supabase',
            message:
              'Conformidade CFM nº 1.821/2007: Uma evolução médica assinada é imutável e não pode ser editada. Utilize Adendo / Errata.',
          };
        }

        const { data, error } = await supabase
          .from('medical_records')
          .update(payload)
          .eq('id', record.id)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Erro ao atualizar rascunho de evolução no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      } else {
        const { data, error } = await supabase
          .from('medical_records')
          .insert(payload)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Erro ao gravar evolução clínica no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      }

      const profMap = new Map([
        [
          ctxRes.context.professionalId,
          {
            fullName: record.professionalName || ctxRes.context.professionalName,
            councilNumber: record.professionalCouncilNumber || ctxRes.context.professionalCouncil,
          },
        ],
      ]);

      const mapped = mapMedicalRecordRow(savedRow, record.addendums || [], profMap);
      StorageService.saveMedicalRecord(mapped);

      // Idempotent SOAP Weight -> Anthropometry synchronization ONLY when finalized/signed
      const soapWeightPayload = buildSoapWeightMeasurementPayload(mapped, {
        organizationId: ctxRes.context.organizationId,
        branchId: ctxRes.context.branchId,
        patientId: patRes.patientUuid,
        professionalId: ctxRes.context.professionalId,
        professionalName: mapped.professionalName || ctxRes.context.professionalName,
      });

      if (soapWeightPayload) {
        const { data: existingSoapWeight } = await supabase
          .from('patient_anthropometric_measurements')
          .select('id')
          .eq('medical_record_id', mapped.id)
          .eq('source_type', 'soap_evolution')
          .maybeSingle();

        if (!existingSoapWeight?.id) {
          const { data: insertedMeasure, error: measureErr } = await supabase
            .from('patient_anthropometric_measurements')
            .insert(soapWeightPayload)
            .select('*')
            .maybeSingle();

          // Ignore 23505 (partial unique index guarantees idempotency across concurrent calls)
          if (measureErr && (measureErr as { code?: string }).code !== '23505') {
            console.warn('Aviso ao sincronizar peso do SOAP para Antropometria:', measureErr.message);
          } else if (insertedMeasure) {
            StorageService.saveAnthropometryMeasurement(
              mapAnthropometricMeasurementRow(insertedMeasure as Record<string, unknown>, profMap)
            );
          }
        }
      }

      return { success: true, record: mapped, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao persistir evolução clínica.',
      };
    }
  },

  saveAnamnesisRecordToCloud: async (
    entry: PatientAnamnesisEntry,
    patient: Patient
  ): Promise<{
    success: boolean;
    record?: PatientAnamnesisEntry;
    source: 'supabase' | 'local';
    message?: string;
  }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar anamnese fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: entry.organizationId,
        branchId: entry.branchId,
        professionalId: entry.professionalId,
        professionalName: entry.professionalName,
        professionalCouncil: entry.professionalCouncil,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      const normalizedData = normalizeStructuredAnamnesis(entry.structuredData);
      const isSigned = entry.status === 'signed';

      const payload: Record<string, unknown> = {
        organization_id: ctxRes.context.organizationId,
        branch_id: ctxRes.context.branchId,
        patient_id: patRes.patientUuid,
        medical_record_id: isUuid(entry.medicalRecordId) ? entry.medicalRecordId : null,
        professional_id: ctxRes.context.professionalId,
        professional_name: entry.professionalName || ctxRes.context.professionalName,
        professional_council: entry.professionalCouncil || ctxRes.context.professionalCouncil,
        evaluation_date: entry.evaluationDate || new Date().toISOString(),
        status: isSigned ? 'signed' : 'draft',
        structured_data: normalizedData,
        is_signed: isSigned,
        signed_at: isSigned ? entry.signedAt || new Date().toISOString() : null,
        signature_hash: isSigned ? entry.signatureHash || null : null,
      };

      const isUpdate = isUuid(entry.id);
      let savedRow: Record<string, unknown> | null = null;

      if (isUpdate) {
        const { data: existing, error: fetchErr } = await supabase
          .from('patient_anamnesis_records')
          .select('id, is_signed, status')
          .eq('id', entry.id)
          .single();

        if (fetchErr || !existing) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(fetchErr, 'Avaliação de anamnese não encontrada para atualização.'),
          };
        }

        if (existing.is_signed || existing.status === 'signed') {
          return {
            success: false,
            source: 'supabase',
            message:
              'Anamnese finalizada e assinada é imutável. Inicie uma "Nova Avaliação" para registrar atualizações.',
          };
        }

        const { data, error } = await supabase
          .from('patient_anamnesis_records')
          .update(payload)
          .eq('id', entry.id)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Erro ao atualizar rascunho de anamnese no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      } else {
        const { data, error } = await supabase
          .from('patient_anamnesis_records')
          .insert(payload)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Erro ao gravar anamnese estruturada no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      }

      const profMap = new Map([
        [
          ctxRes.context.professionalId,
          {
            fullName: entry.professionalName || ctxRes.context.professionalName,
            councilNumber: entry.professionalCouncil || ctxRes.context.professionalCouncil,
          },
        ],
      ]);

      const mapped = mapAnamnesisRecordRow(savedRow, profMap);
      StorageService.saveAnamnesisRecord(mapped);
      void StorageService.addAuditLogToCloud({
        organizationId: ctxRes.context.organizationId,
        action: isSigned ? 'Assinou Anamnese Estruturada' : 'Salvou Rascunho Anamnese',
        entity: 'Anamnese',
        entityId: mapped.id,
        details: `Paciente ${patient.fullName} · Avaliação ${mapped.evaluationDate.substring(0, 10)}`,
      });

      return { success: true, record: mapped, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao persistir anamnese estruturada.',
      };
    }
  },

  saveAnthropometricMeasurementToCloud: async (
    measurement: AnthropometricMeasurement,
    patient: Patient
  ): Promise<{
    success: boolean;
    measurement?: AnthropometricMeasurement;
    source: 'supabase' | 'local';
    message?: string;
  }> => {
    if (!hasAnyAnthropometricMetric(measurement)) {
      return {
        success: false,
        source: 'supabase',
        message: 'Informe ao menos o Peso (kg) ou uma das circunferências corporais (cm).',
      };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message:
          'Conexão com o Supabase não configurada. Não é possível gravar antropometria fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: measurement.organizationId,
        branchId: measurement.branchId,
        professionalId: measurement.professionalId,
        professionalName: measurement.professionalName,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      if (measurement.sourceType === 'soap_evolution') {
        return {
          success: false,
          source: 'supabase',
          message:
            'Aferições geradas automaticamente por evolução SOAP assinada são imutáveis. Crie uma nova aferição se necessário.',
        };
      }

      const positiveOrNull = (v?: number | null): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
      };

      const payload: Record<string, unknown> = {
        organization_id: ctxRes.context.organizationId,
        branch_id: ctxRes.context.branchId,
        patient_id: patRes.patientUuid,
        medical_record_id: isUuid(measurement.medicalRecordId) ? measurement.medicalRecordId : null,
        professional_id: ctxRes.context.professionalId,
        professional_name: measurement.professionalName || ctxRes.context.professionalName,
        measured_at: measurement.measuredAt || new Date().toISOString(),
        weight_kg: positiveOrNull(measurement.weightKg),
        abdominal_circumference_cm: positiveOrNull(measurement.abdominalCircumferenceCm),
        right_arm_circumference_cm: positiveOrNull(measurement.rightArmCircumferenceCm),
        left_arm_circumference_cm: positiveOrNull(measurement.leftArmCircumferenceCm),
        right_leg_circumference_cm: positiveOrNull(measurement.rightLegCircumferenceCm),
        left_leg_circumference_cm: positiveOrNull(measurement.leftLegCircumferenceCm),
        thoracic_circumference_cm: positiveOrNull(measurement.thoracicCircumferenceCm),
        hip_circumference_cm: positiveOrNull(measurement.hipCircumferenceCm),
        source_type: measurement.sourceType === 'bioimpedance' ? 'bioimpedance' : 'manual',
        notes: nullableText(measurement.notes),
      };

      const isUpdate = isUuid(measurement.id);
      let savedRow: Record<string, unknown> | null = null;

      if (isUpdate) {
        const { data, error } = await supabase
          .from('patient_anthropometric_measurements')
          .update(payload)
          .eq('id', measurement.id)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Erro ao atualizar avaliação antropométrica no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      } else {
        const { data, error } = await supabase
          .from('patient_anthropometric_measurements')
          .insert(payload)
          .select('*')
          .single();

        if (error || !data) {
          return {
            success: false,
            source: 'supabase',
            message: formatPgError(error, 'Erro ao registrar avaliação antropométrica no Supabase.'),
          };
        }
        savedRow = data as Record<string, unknown>;
      }

      const profMap = new Map([
        [
          ctxRes.context.professionalId,
          {
            fullName: measurement.professionalName || ctxRes.context.professionalName,
            councilNumber: ctxRes.context.professionalCouncil,
          },
        ],
      ]);

      const mapped = mapAnthropometricMeasurementRow(savedRow, profMap);
      StorageService.saveAnthropometryMeasurement(mapped);
      void StorageService.addAuditLogToCloud({
        organizationId: ctxRes.context.organizationId,
        action: isUpdate ? 'Atualizou Antropometria' : 'Registrou Antropometria',
        entity: 'Antropometria',
        entityId: mapped.id,
        details: `Paciente ${patient.fullName} · Data ${mapped.measuredAt.substring(0, 10)}`,
      });

      return { success: true, measurement: mapped, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao salvar aferição antropométrica.',
      };
    }
  },

  addMedicalRecordAddendumToCloud: async (
    record: MedicalRecordEntry,
    addendum: MedicalRecordAddendum
  ): Promise<{ success: boolean; addendum?: MedicalRecordAddendum; source: 'supabase' | 'local'; message?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar adendos fora do banco.',
      };
    }

    if (!isUuid(record.id)) {
      return {
        success: false,
        source: 'supabase',
        message: 'A evolução selecionada não possui identificador válido no Supabase.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: record.organizationId,
        professionalId: addendum.authorId,
        professionalName: addendum.authorName,
        professionalCouncil: addendum.authorCouncilNumber,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const { data, error } = await supabase
        .from('medical_record_addendums')
        .insert({
          record_id: record.id,
          organization_id: ctxRes.context.organizationId,
          author_id: ctxRes.context.professionalId,
          author_name: addendum.authorName,
          author_council_number: addendum.authorCouncilNumber || ctxRes.context.professionalCouncil,
          note: addendum.note.trim(),
          signature_hash: addendum.signatureHash,
        })
        .select('*')
        .single();

      if (error || !data) {
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(error, 'Erro ao gravar adendo/errata no Supabase.'),
        };
      }

      const mapped: MedicalRecordAddendum = {
        id: String(data.id),
        recordId: String(data.record_id),
        authorId: String(data.author_id),
        authorName: String(data.author_name),
        authorCouncilNumber: String(data.author_council_number),
        note: String(data.note),
        createdAt: String(data.created_at),
        signatureHash: String(data.signature_hash),
      };

      StorageService.addMedicalRecordAddendum(record.id, mapped);
      return { success: true, addendum: mapped, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro inesperado ao registrar adendo.',
      };
    }
  },

  savePrescriptionToCloud: async (
    prescription: Prescription,
    patient: Patient
  ): Promise<{ success: boolean; prescription?: Prescription; source: 'supabase' | 'local'; message?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar receituários fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: prescription.organizationId,
        branchId: prescription.branchId,
        professionalId: prescription.professionalId,
        professionalName: prescription.professionalName,
        professionalCouncil: prescription.professionalCouncil,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      const { data: headerRow, error: headerErr } = await supabase
        .from('prescriptions')
        .insert({
          organization_id: ctxRes.context.organizationId,
          branch_id: ctxRes.context.branchId,
          patient_id: patRes.patientUuid,
          medical_record_id: isUuid(prescription.medicalRecordId)
            ? prescription.medicalRecordId
            : null,
          professional_id: ctxRes.context.professionalId,
          professional_name: prescription.professionalName || ctxRes.context.professionalName,
          professional_council:
            prescription.professionalCouncil || ctxRes.context.professionalCouncil,
          type: prescription.type,
          special_control_notification_type:
            prescription.type === 'controle_especial'
              ? prescription.specialControlNotificationType || 'C1'
              : null,
          prescription_date: prescription.prescriptionDate,
          validity_days: prescription.validityDays || 30,
          general_instructions: nullableText(prescription.generalInstructions),
          buyer_identification: prescription.buyerIdentification || null,
          is_signed: true,
          signature_hash: prescription.signatureHash || null,
        })
        .select('*')
        .single();

      if (headerErr || !headerRow?.id) {
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(headerErr, 'Erro ao gravar prescrição no Supabase.'),
        };
      }

      const itemsPayload = prescription.items.map((it) => ({
        prescription_id: headerRow.id,
        medicine_name: it.medicineName.trim(),
        concentration: nullableText(it.concentration),
        pharmaceutical_form: nullableText(it.pharmaceuticalForm),
        dosage_instruction: it.dosageInstruction.trim(),
        treatment_duration: nullableText(it.treatmentDuration),
        quantity: nullableText(it.quantity),
        administration_route: nullableText(it.administrationRoute) || 'Oral',
      }));

      const { data: insertedItems, error: itemsErr } = await supabase
        .from('prescription_items')
        .insert(itemsPayload)
        .select('*');

      if (itemsErr) {
        // Compensating rollback so header isn't saved without items
        await supabase.from('prescriptions').delete().eq('id', headerRow.id);
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(itemsErr, 'Erro ao gravar os itens da prescrição no Supabase.'),
        };
      }

      const savedPrescription: Prescription = {
        ...prescription,
        id: String(headerRow.id),
        organizationId: String(headerRow.organization_id),
        branchId: String(headerRow.branch_id),
        patientId: String(headerRow.patient_id),
        professionalId: String(headerRow.professional_id),
        professionalName: String(
          headerRow.professional_name || prescription.professionalName
        ),
        professionalCouncil: String(
          headerRow.professional_council || prescription.professionalCouncil
        ),
        items: ((insertedItems || []) as Array<Record<string, unknown>>).map((it) => ({
          id: String(it.id),
          medicineName: String(it.medicine_name),
          concentration: String(it.concentration || ''),
          pharmaceuticalForm: String(it.pharmaceutical_form || ''),
          dosageInstruction: String(it.dosage_instruction),
          treatmentDuration: String(it.treatment_duration || ''),
          quantity: String(it.quantity || ''),
          administrationRoute: String(it.administration_route || 'Oral'),
        })),
        createdAt: String(headerRow.created_at),
      };

      StorageService.savePrescription(savedPrescription);
      return { success: true, prescription: savedPrescription, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao salvar receituário no Supabase.',
      };
    }
  },

  saveCertificateToCloud: async (
    certificate: MedicalCertificate,
    patient: Patient
  ): Promise<{ success: boolean; certificate?: MedicalCertificate; source: 'supabase' | 'local'; message?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar atestados fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: certificate.organizationId,
        branchId: certificate.branchId,
        professionalId: certificate.professionalId,
        professionalName: certificate.professionalName,
        professionalCouncil: certificate.professionalCouncil,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      const { data, error } = await supabase
        .from('medical_certificates')
        .insert({
          organization_id: ctxRes.context.organizationId,
          branch_id: ctxRes.context.branchId,
          patient_id: patRes.patientUuid,
          medical_record_id: isUuid(certificate.medicalRecordId)
            ? certificate.medicalRecordId
            : null,
          professional_id: ctxRes.context.professionalId,
          professional_name: certificate.professionalName || ctxRes.context.professionalName,
          professional_council:
            certificate.professionalCouncil || ctxRes.context.professionalCouncil,
          type: certificate.type,
          issue_date: certificate.issueDate,
          start_date: nullableDate(certificate.startDate),
          days_off: certificate.daysOff ?? null,
          hours_off: nullableText(certificate.hoursOff),
          period_description: nullableText(certificate.periodDescription),
          activity_permitted: nullableText(certificate.activityPermitted),
          companion_name: nullableText(certificate.companionName),
          companion_kinship: nullableText(certificate.companionKinship),
          cid10_code: nullableText(certificate.cid10Code),
          cid10_description: nullableText(certificate.cid10Description),
          show_cid_on_print: Boolean(certificate.showCidOnPrint),
          purpose: nullableText(certificate.purpose),
          notes: nullableText(certificate.notes),
          is_signed: true,
          signature_hash: certificate.signatureHash || null,
        })
        .select('*')
        .single();

      if (error || !data) {
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(error, 'Erro ao gravar atestado médico no Supabase.'),
        };
      }

      const savedCert: MedicalCertificate = {
        ...certificate,
        id: String(data.id),
        organizationId: String(data.organization_id),
        branchId: String(data.branch_id),
        patientId: String(data.patient_id),
        professionalId: String(data.professional_id),
        professionalName: String(data.professional_name || certificate.professionalName),
        professionalCouncil: String(data.professional_council || certificate.professionalCouncil),
        createdAt: String(data.created_at),
      };

      StorageService.saveCertificate(savedCert);
      return { success: true, certificate: savedCert, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao salvar atestado médico.',
      };
    }
  },

  saveLabOrderToCloud: async (
    order: LabOrder,
    patient: Patient
  ): Promise<{ success: boolean; order?: LabOrder; source: 'supabase' | 'local'; message?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar pedidos de exames fora do banco.',
      };
    }

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: order.organizationId,
        branchId: order.branchId,
        professionalId: order.professionalId,
        professionalName: order.professionalName,
        professionalCouncil: order.professionalCouncil,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      const { data: orderRow, error: orderErr } = await supabase
        .from('lab_orders')
        .insert({
          organization_id: ctxRes.context.organizationId,
          branch_id: ctxRes.context.branchId,
          patient_id: patRes.patientUuid,
          medical_record_id: isUuid(order.medicalRecordId) ? order.medicalRecordId : null,
          professional_id: ctxRes.context.professionalId,
          professional_name: order.professionalName || ctxRes.context.professionalName,
          professional_council: order.professionalCouncil || ctxRes.context.professionalCouncil,
          order_date: order.orderDate,
          clinical_indication: order.clinicalIndication.trim(),
          notes: nullableText(order.notes),
          status: order.status || 'requested',
          is_signed: true,
          signature_hash: order.signatureHash || null,
        })
        .select('*')
        .single();

      if (orderErr || !orderRow?.id) {
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(orderErr, 'Erro ao gravar solicitação de exames no Supabase.'),
        };
      }

      const itemsPayload = order.items.map((it) => ({
        order_id: orderRow.id,
        exam_name: it.examName.trim(),
        exam_type: it.examType || 'laboratorial',
        urgency: it.urgency || 'rotina',
        observations: nullableText(it.observations),
        catalog_exam_id: !it.isCustom && isUuid(it.catalogExamId) ? it.catalogExamId : null,
        is_custom: Boolean(it.isCustom),
      }));

      const { data: insertedItems, error: itemsErr } = await supabase
        .from('lab_order_items')
        .insert(itemsPayload)
        .select('*');

      if (itemsErr) {
        await supabase.from('lab_orders').delete().eq('id', orderRow.id);
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(itemsErr, 'Erro ao gravar os itens do pedido de exames.'),
        };
      }

      const savedOrder: LabOrder = {
        ...order,
        id: String(orderRow.id),
        organizationId: String(orderRow.organization_id),
        branchId: String(orderRow.branch_id),
        patientId: String(orderRow.patient_id),
        professionalId: String(orderRow.professional_id),
        professionalName: String(orderRow.professional_name || order.professionalName),
        professionalCouncil: String(orderRow.professional_council || order.professionalCouncil),
        items: ((insertedItems || []) as Array<Record<string, unknown>>).map((it) => ({
          id: String(it.id),
          examName: String(it.exam_name),
          examType: (it.exam_type as LabOrderItem['examType']) || 'laboratorial',
          urgency: it.urgency === 'urgente' ? 'urgente' : 'rotina',
          observations: it.observations ? String(it.observations) : undefined,
          catalogExamId: it.catalog_exam_id ? String(it.catalog_exam_id) : undefined,
          isCustom: Boolean(it.is_custom),
        })),
        createdAt: String(orderRow.created_at),
      };

      StorageService.saveLabOrder(savedOrder);
      return { success: true, order: savedOrder, source: 'supabase' };
    } catch (err) {
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao salvar pedido de exames.',
      };
    }
  },

  saveExamResultToCloud: async (
    result: ExamResult,
    patient: Patient,
    attachmentFile?: File | null
  ): Promise<{ success: boolean; result?: ExamResult; source: 'supabase' | 'local'; message?: string }> => {
    const resolvedExamMimeType = attachmentFile ? inferClinicalMimeType(attachmentFile) : '';
    if (attachmentFile) {
      if (attachmentFile.size > MAX_CLINICAL_FILE_BYTES) {
        return {
          success: false,
          source: getSupabase() ? 'supabase' : 'local',
          message: 'O arquivo anexo excede o limite máximo de 15 MB.',
        };
      }
      if (!ALLOWED_CLINICAL_MIME_TYPES.has(resolvedExamMimeType)) {
        return {
          success: false,
          source: getSupabase() ? 'supabase' : 'local',
          message: 'Formato de arquivo não suportado. Envie PDF, JPG, PNG ou WEBP.',
        };
      }
    }

    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível gravar resultados fora do banco.',
      };
    }

    let uploadedStoragePath: string | null = null;

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: result.organizationId,
        branchId: result.branchId,
        professionalId: result.professionalId,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      let storageBucket: string | null = result.storageBucket || null;
      let storagePath: string | null = result.storagePath || null;
      let attachmentFilename: string | null = result.attachmentFilename || null;
      let attachmentMimeType: string | null = result.attachmentMimeType || null;
      let attachmentSizeBytes: number | null = result.attachmentSizeBytes ?? null;

      if (attachmentFile) {
        const safeName = sanitizeFileName(attachmentFile.name);
        const path = `${ctxRes.context.organizationId}/${patRes.patientUuid}/exams/${Date.now()}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from(MEDICAL_DOCUMENTS_BUCKET)
          .upload(path, attachmentFile, {
            cacheControl: '3600',
            contentType: resolvedExamMimeType,
            upsert: false,
          });

        if (uploadErr) {
          return {
            success: false,
            source: 'supabase',
            message: `Erro ao enviar anexo para o Storage privado (${MEDICAL_DOCUMENTS_BUCKET}): ${uploadErr.message}`,
          };
        }

        uploadedStoragePath = path;
        storageBucket = MEDICAL_DOCUMENTS_BUCKET;
        storagePath = path;
        attachmentFilename = attachmentFile.name;
        attachmentMimeType = resolvedExamMimeType;
        attachmentSizeBytes = attachmentFile.size;
      }

      const { data, error } = await supabase
        .from('exam_results')
        .insert({
          organization_id: ctxRes.context.organizationId,
          branch_id: ctxRes.context.branchId,
          patient_id: patRes.patientUuid,
          order_id: isUuid(result.orderId) ? result.orderId : null,
          medical_record_id: isUuid(result.medicalRecordId) ? result.medicalRecordId : null,
          professional_id: ctxRes.context.professionalId,
          exam_name: result.examName.trim(),
          exam_category: result.examCategory,
          performed_date: result.performedDate,
          laboratory_name: result.laboratoryName.trim(),
          report_summary: result.reportSummary.trim(),
          reference_values: nullableText(result.referenceValues),
          status: result.status,
          attachment_url: nullableText(result.attachmentUrl),
          storage_bucket: storageBucket,
          storage_path: storagePath,
          attachment_filename: attachmentFilename,
          attachment_mime_type: attachmentMimeType,
          attachment_size_bytes: attachmentSizeBytes,
          evaluated_by_professional_name: nullableText(result.evaluatedByProfessionalName),
          evaluated_at: result.evaluatedAt || null,
          notes: nullableText(result.notes),
        })
        .select('*')
        .single();

      if (error || !data) {
        if (uploadedStoragePath) {
          await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).remove([uploadedStoragePath]);
        }
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(error, 'Erro ao gravar resultado de exame no Supabase.'),
        };
      }

      const savedResult: ExamResult = {
        ...result,
        id: String(data.id),
        organizationId: String(data.organization_id),
        branchId: data.branch_id ? String(data.branch_id) : undefined,
        patientId: String(data.patient_id),
        storageBucket: data.storage_bucket ? String(data.storage_bucket) : undefined,
        storagePath: data.storage_path ? String(data.storage_path) : undefined,
        attachmentFilename: data.attachment_filename ? String(data.attachment_filename) : undefined,
        attachmentMimeType: data.attachment_mime_type ? String(data.attachment_mime_type) : undefined,
        attachmentSizeBytes:
          data.attachment_size_bytes != null ? Number(data.attachment_size_bytes) : undefined,
        createdAt: String(data.created_at),
      };

      StorageService.saveExamResult(savedResult);
      return { success: true, result: savedResult, source: 'supabase' };
    } catch (err) {
      if (uploadedStoragePath && supabase) {
        await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).remove([uploadedStoragePath]);
      }
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao salvar resultado de exame.',
      };
    }
  },

  // =========================================================================
  // 4. PRIVATE MEDICAL DOCUMENTS STORAGE (UPLOAD + SIGNED URLs + METADATA)
  // =========================================================================

  uploadMedicalDocumentToCloud: async (params: {
    patient: Patient;
    file: File;
    title: string;
    documentType: MedicalDocumentType;
    documentDate: string;
    description?: string;
    branchId?: string;
    medicalRecordId?: string;
    professionalId?: string;
    professionalName?: string;
  }): Promise<{ success: boolean; document?: MedicalDocument; source: 'supabase' | 'local'; message?: string }> => {
    const { file, patient } = params;
    const resolvedDocMimeType = inferClinicalMimeType(file);
    if (file.size > MAX_CLINICAL_FILE_BYTES) {
      return {
        success: false,
        source: getSupabase() ? 'supabase' : 'local',
        message: 'O arquivo excede o tamanho máximo permitido de 15 MB.',
      };
    }
    if (!ALLOWED_CLINICAL_MIME_TYPES.has(resolvedDocMimeType)) {
      return {
        success: false,
        source: getSupabase() ? 'supabase' : 'local',
        message: 'Formato inválido. Apenas arquivos PDF, JPG, PNG ou WEBP são aceitos.',
      };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        source: 'local',
        message: 'Conexão com o Supabase não configurada. Não é possível enviar documentos fora do banco.',
      };
    }

    let uploadedPath: string | null = null;

    try {
      const ctxRes = await resolveCloudContext(supabase, {
        organizationId: patient.organizationId,
        branchId: params.branchId || patient.originBranchId,
        professionalId: params.professionalId,
        professionalName: params.professionalName,
      });
      if (!ctxRes.context) {
        return { success: false, source: 'supabase', message: ctxRes.error };
      }

      const patRes = await resolveCloudPatientUuid(supabase, ctxRes.context.organizationId, patient);
      if (!patRes.patientUuid) {
        return { success: false, source: 'supabase', message: patRes.error };
      }

      const safeName = sanitizeFileName(file.name);
      const path = `${ctxRes.context.organizationId}/${patRes.patientUuid}/documents/${Date.now()}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from(MEDICAL_DOCUMENTS_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          contentType: resolvedDocMimeType,
          upsert: false,
        });

      if (uploadErr) {
        return {
          success: false,
          source: 'supabase',
          message: `Falha ao enviar arquivo para o Storage privado (${MEDICAL_DOCUMENTS_BUCKET}): ${uploadErr.message}`,
        };
      }

      uploadedPath = path;

      const { data, error: dbErr } = await supabase
        .from('medical_documents')
        .insert({
          organization_id: ctxRes.context.organizationId,
          branch_id: ctxRes.context.branchId,
          patient_id: patRes.patientUuid,
          medical_record_id: isUuid(params.medicalRecordId) ? params.medicalRecordId : null,
          professional_id: ctxRes.context.professionalId,
          professional_name: params.professionalName || ctxRes.context.professionalName,
          document_type: params.documentType,
          title: params.title.trim(),
          description: nullableText(params.description),
          document_date: params.documentDate,
          storage_bucket: MEDICAL_DOCUMENTS_BUCKET,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          file_size_bytes: file.size,
        })
        .select('*')
        .single();

      if (dbErr || !data) {
        await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).remove([path]);
        return {
          success: false,
          source: 'supabase',
          message: formatPgError(dbErr, 'Erro ao gravar metadados do documento médico no banco.'),
        };
      }

      const savedDoc: MedicalDocument = {
        id: String(data.id),
        organizationId: String(data.organization_id),
        branchId: data.branch_id ? String(data.branch_id) : undefined,
        patientId: String(data.patient_id),
        medicalRecordId: data.medical_record_id ? String(data.medical_record_id) : undefined,
        professionalId: data.professional_id ? String(data.professional_id) : undefined,
        professionalName: data.professional_name ? String(data.professional_name) : undefined,
        documentType: (data.document_type as MedicalDocumentType) || params.documentType,
        title: String(data.title),
        description: data.description ? String(data.description) : undefined,
        documentDate: String(data.document_date).substring(0, 10),
        storageBucket: String(data.storage_bucket),
        storagePath: String(data.storage_path),
        fileName: String(data.file_name),
        mimeType: data.mime_type ? String(data.mime_type) : undefined,
        fileSizeBytes: data.file_size_bytes != null ? Number(data.file_size_bytes) : undefined,
        createdAt: String(data.created_at),
        updatedAt: data.updated_at ? String(data.updated_at) : undefined,
      };

      StorageService.saveMedicalDocument(savedDoc);
      return { success: true, document: savedDoc, source: 'supabase' };
    } catch (err) {
      if (uploadedPath && supabase) {
        await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).remove([uploadedPath]);
      }
      return {
        success: false,
        source: 'supabase',
        message: err instanceof Error ? err.message : 'Erro ao enviar documento médico.',
      };
    }
  },

  getSignedDocumentUrl: async (
    bucket: string,
    storagePath: string,
    expiresInSeconds = 300
  ): Promise<{ url?: string; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        error:
          'Este anexo foi registrado em modo offline e não está disponível no armazenamento em nuvem.',
      };
    }

    try {
      const { data, error } = await supabase.storage
        .from(bucket || MEDICAL_DOCUMENTS_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);

      if (error || !data?.signedUrl) {
        return {
          error: error?.message || 'Não foi possível gerar a URL assinada segura para este arquivo.',
        };
      }
      return { url: data.signedUrl };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Erro ao gerar acesso temporário ao documento.',
      };
    }
  },

  deleteMedicalDocumentFromCloud: async (
    doc: MedicalDocument
  ): Promise<{ success: boolean; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase || !isUuid(doc.id)) {
      StorageService.deleteMedicalDocument(doc.id);
      return { success: true };
    }

    try {
      const { error: dbErr } = await supabase
        .from('medical_documents')
        .delete()
        .eq('id', doc.id);

      if (dbErr) {
        return { success: false, error: formatPgError(dbErr, 'Erro ao excluir documento no banco.') };
      }

      if (doc.storagePath) {
        await supabase.storage
          .from(doc.storageBucket || MEDICAL_DOCUMENTS_BUCKET)
          .remove([doc.storagePath]);
      }

      StorageService.deleteMedicalDocument(doc.id);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao excluir documento.',
      };
    }
  },

  fetchLabExamCatalogFromCloud: async (
    organizationId?: string,
    includeInactive = false
  ): Promise<{ items: LabExamCatalogItem[]; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        items: [],
        error: 'Conexão com o Supabase não configurada. Não foi possível carregar o catálogo de exames.',
      };
    }

    try {
      const orgRes = await resolveCloudOrganizationId(supabase, organizationId);
      if (!orgRes.organizationId) {
        return { items: [], error: orgRes.error || 'Organização não localizada.' };
      }

      let query = supabase
        .from('lab_exam_catalog')
        .select('*')
        .eq('organization_id', orgRes.organizationId)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;
      if (error) {
        return {
          items: [],
          error: formatPgError(error, 'Erro ao carregar catálogo de exames laboratoriais no Supabase.'),
        };
      }

      return {
        items: ((data || []) as Array<Record<string, unknown>>).map(mapLabExamCatalogRow),
      };
    } catch (err) {
      return {
        items: [],
        error: err instanceof Error ? err.message : 'Erro inesperado ao carregar catálogo de exames.',
      };
    }
  },

  createLabExamCatalogItemInCloud: async (payload: {
    organizationId?: string;
    name: string;
    examType?: 'laboratorial' | 'imagem' | 'outros';
    defaultObservations?: string;
  }): Promise<{ success: boolean; item?: LabExamCatalogItem; error?: string }> => {
    const cleanName = payload.name.trim();
    if (!cleanName) {
      return { success: false, error: 'Informe o nome do exame para cadastrar no catálogo.' };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        error: 'Conexão com o Supabase não configurada.',
      };
    }

    try {
      const orgRes = await resolveCloudOrganizationId(supabase, payload.organizationId);
      if (!orgRes.organizationId) {
        return { success: false, error: orgRes.error || 'Organização não localizada.' };
      }

      const { data, error } = await supabase
        .from('lab_exam_catalog')
        .insert({
          organization_id: orgRes.organizationId,
          name: cleanName,
          exam_type: payload.examType || 'laboratorial',
          default_observations: nullableText(payload.defaultObservations),
          display_order: 1000,
          is_active: true,
        })
        .select('*')
        .single();

      if (error || !data) {
        const pgErr = error as { code?: string } | null;
        if (pgErr?.code === '23505') {
          return { success: false, error: 'Este exame já está cadastrado no catálogo desta clínica.' };
        }
        if (pgErr?.code === '42501') {
          return {
            success: false,
            error: 'Permissão negada: apenas usuários autorizados podem incluir exames no catálogo.',
          };
        }
        return {
          success: false,
          error: formatPgError(error, 'Erro ao cadastrar exame no catálogo do Supabase.'),
        };
      }

      return { success: true, item: mapLabExamCatalogRow(data as Record<string, unknown>) };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado ao cadastrar exame no catálogo.',
      };
    }
  },

  toggleLabExamCatalogItemActiveInCloud: async (
    catalogId: string,
    isActive: boolean
  ): Promise<{ success: boolean; item?: LabExamCatalogItem; error?: string }> => {
    if (!isUuid(catalogId)) {
      return { success: false, error: 'Identificador de exame inválido.' };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o Supabase não configurada.' };
    }

    try {
      const { data, error } = await supabase
        .from('lab_exam_catalog')
        .update({ is_active: isActive })
        .eq('id', catalogId)
        .select('*')
        .single();

      if (error || !data) {
        const pgErr = error as { code?: string } | null;
        if (pgErr?.code === '42501') {
          return {
            success: false,
            error: 'Permissão negada: seu perfil não possui autorização para alterar o catálogo.',
          };
        }
        return {
          success: false,
          error: formatPgError(error, 'Erro ao atualizar status do exame no catálogo.'),
        };
      }

      return { success: true, item: mapLabExamCatalogRow(data as Record<string, unknown>) };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado ao atualizar o catálogo.',
      };
    }
  },
};
