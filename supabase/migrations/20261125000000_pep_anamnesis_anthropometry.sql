-- ====================================================================
-- MIGRAÇÃO: AMPLIAÇÃO DO PEP (ANAMNESE ESTRUTURADA + ANTROPOMETRIA E BIOIMPEDÂNCIA)
-- Cliente: Clínica Dr. Newton Mureb / MedSync SaaS
-- Referência: PRONTUÁRIO CLINICA NEWTON MUREB.docx (9 páginas)
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. BACKWARDS-COMPATIBLE: JSONB DE ANAMNESE ESTRUTURADA EM MEDICAL_RECORDS
-- --------------------------------------------------------------------
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS structured_anamnesis JSONB DEFAULT NULL;

-- --------------------------------------------------------------------
-- 2. TABELA DE AVALIAÇÕES DE ANAMNESE ESTRUTURADA (MULTI-AVALIAÇÕES / DRAFT & SIGNED)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_anamnesis_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  professional_name VARCHAR(150) NOT NULL,
  professional_council VARCHAR(50),
  evaluation_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  structured_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_signed BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMPTZ,
  signature_hash TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_anamnesis_org_patient_date
  ON public.patient_anamnesis_records (organization_id, patient_id, evaluation_date DESC);

DROP TRIGGER IF EXISTS trg_patient_anamnesis_updated_at ON public.patient_anamnesis_records;
CREATE TRIGGER trg_patient_anamnesis_updated_at
  BEFORE UPDATE ON public.patient_anamnesis_records
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

DROP TRIGGER IF EXISTS trg_patient_anamnesis_immutability ON public.patient_anamnesis_records;
CREATE TRIGGER trg_patient_anamnesis_immutability
  BEFORE UPDATE OR DELETE ON public.patient_anamnesis_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_signed_medical_record_immutability();

-- --------------------------------------------------------------------
-- 3. TABELA CRONOLÓGICA DE ANTROPOMETRIA E BIOIMPEDÂNCIA (PÁGINAS 3 E 9)
--    Campos estritamente fiéis ao documento: Data, Peso (kg) + 7 circunferências (cm)
--    Sem UNIQUE por (patient_id, data) para permitir múltiplas aferições no mesmo dia.
--    Índice único parcial em medical_record_id para idempotência do peso vindo de SOAP assinado.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_anthropometric_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  professional_name VARCHAR(150),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  weight_kg NUMERIC(6,2) CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 500)),
  abdominal_circumference_cm NUMERIC(6,2) CHECK (abdominal_circumference_cm IS NULL OR (abdominal_circumference_cm > 0 AND abdominal_circumference_cm <= 350)),
  right_arm_circumference_cm NUMERIC(6,2) CHECK (right_arm_circumference_cm IS NULL OR (right_arm_circumference_cm > 0 AND right_arm_circumference_cm <= 350)),
  left_arm_circumference_cm NUMERIC(6,2) CHECK (left_arm_circumference_cm IS NULL OR (left_arm_circumference_cm > 0 AND left_arm_circumference_cm <= 350)),
  right_leg_circumference_cm NUMERIC(6,2) CHECK (right_leg_circumference_cm IS NULL OR (right_leg_circumference_cm > 0 AND right_leg_circumference_cm <= 350)),
  left_leg_circumference_cm NUMERIC(6,2) CHECK (left_leg_circumference_cm IS NULL OR (left_leg_circumference_cm > 0 AND left_leg_circumference_cm <= 350)),
  thoracic_circumference_cm NUMERIC(6,2) CHECK (thoracic_circumference_cm IS NULL OR (thoracic_circumference_cm > 0 AND thoracic_circumference_cm <= 350)),
  hip_circumference_cm NUMERIC(6,2) CHECK (hip_circumference_cm IS NULL OR (hip_circumference_cm > 0 AND hip_circumference_cm <= 350)),
  source_type VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'soap_evolution', 'bioimpedance')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_anthropometry_at_least_one_metric CHECK (
    weight_kg IS NOT NULL
    OR abdominal_circumference_cm IS NOT NULL
    OR right_arm_circumference_cm IS NOT NULL
    OR left_arm_circumference_cm IS NOT NULL
    OR right_leg_circumference_cm IS NOT NULL
    OR left_leg_circumference_cm IS NOT NULL
    OR thoracic_circumference_cm IS NOT NULL
    OR hip_circumference_cm IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_patient_anthropometry_org_patient_measured
  ON public.patient_anthropometric_measurements (organization_id, patient_id, measured_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_anthropometry_soap_record
  ON public.patient_anthropometric_measurements (medical_record_id)
  WHERE medical_record_id IS NOT NULL AND source_type = 'soap_evolution';

DROP TRIGGER IF EXISTS trg_patient_anthropometry_updated_at ON public.patient_anthropometric_measurements;
CREATE TRIGGER trg_patient_anthropometry_updated_at
  BEFORE UPDATE ON public.patient_anthropometric_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- --------------------------------------------------------------------
-- 4. RLS ESTRITA POR ORGANIZAÇÃO, FILIAL E PERMISSÕES DO MENU 'medical_records'
--    Bloqueia automaticamente financial, receptionist, patient e usuários inativos
-- --------------------------------------------------------------------
ALTER TABLE public.patient_anamnesis_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Patient anamnesis select" ON public.patient_anamnesis_records;
DROP POLICY IF EXISTS "Patient anamnesis insert" ON public.patient_anamnesis_records;
DROP POLICY IF EXISTS "Patient anamnesis update draft only" ON public.patient_anamnesis_records;

CREATE POLICY "Patient anamnesis select" ON public.patient_anamnesis_records
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Patient anamnesis insert" ON public.patient_anamnesis_records
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Patient anamnesis update draft only" ON public.patient_anamnesis_records
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
    AND is_signed = false
    AND status = 'draft'
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

ALTER TABLE public.patient_anthropometric_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Patient anthropometry select" ON public.patient_anthropometric_measurements;
DROP POLICY IF EXISTS "Patient anthropometry insert" ON public.patient_anthropometric_measurements;
DROP POLICY IF EXISTS "Patient anthropometry update" ON public.patient_anthropometric_measurements;

CREATE POLICY "Patient anthropometry select" ON public.patient_anthropometric_measurements
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Patient anthropometry insert" ON public.patient_anthropometric_measurements
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Patient anthropometry update" ON public.patient_anthropometric_measurements
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
    AND source_type <> 'soap_evolution'
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND public.medsync_has_menu_permission('medical_records', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
    AND source_type <> 'soap_evolution'
  );
