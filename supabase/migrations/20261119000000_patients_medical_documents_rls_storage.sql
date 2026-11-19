-- ====================================================================
-- MIGRAÇÃO: PERSISTÊNCIA DE PACIENTES, DOCUMENTOS MÉDICOS, STORAGE PRIVADO E RLS
-- Auditoria técnica MedSync SaaS:
-- 1. Pacientes (unicidade de CPF por organização, índices, triggers, RLS)
-- 2. Prontuário e Documentos Médicos (evoluções, adendos, receitas, atestados,
--    pedidos de exames, laudos de exames e anexos/documentos clínicos)
-- 3. Imutabilidade CFM nº 1.821/2007 garantida por trigger + RLS
-- 4. Bucket privado 'medical-documents' com acesso via URLs assinadas e RLS
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. FUNÇÕES AUXILIARES DE CONTEXTO MULTI-TENANT (SEGURAS PARA UUID VAZIO)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.medsync_current_org_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_setting TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT up.organization_id INTO v_org_id
    FROM public.user_profiles up
    WHERE up.user_id = auth.uid() AND up.is_active = true
    LIMIT 1;
    IF v_org_id IS NOT NULL THEN
      RETURN v_org_id;
    END IF;
  END IF;

  v_setting := NULLIF(trim(COALESCE(current_setting('app.current_org_id', true), '')), '');
  IF v_setting IS NOT NULL AND v_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_setting::uuid;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.medsync_can_access_org(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_org_id IS NULL THEN false
    WHEN public.medsync_current_org_id() IS NOT NULL THEN target_org_id = public.medsync_current_org_id()
    ELSE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = target_org_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.medsync_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------
-- 2. AJUSTES NA TABELA PUBLIC.PATIENTS
-- --------------------------------------------------------------------

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_patients_org_name
  ON public.patients (organization_id, full_name);

CREATE INDEX IF NOT EXISTS idx_patients_org_branch
  ON public.patients (organization_id, origin_branch_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_org_cpf_digits
  ON public.patients (organization_id, regexp_replace(document_cpf, '[^0-9]', '', 'g'))
  WHERE length(regexp_replace(document_cpf, '[^0-9]', '', 'g')) >= 11;

DROP TRIGGER IF EXISTS trg_patients_updated_at ON public.patients;
CREATE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- --------------------------------------------------------------------
-- 3. PRONTUÁRIO E DOCUMENTOS MÉDICOS (EVOLUÇÕES, RECEITAS, ATESTADOS, EXAMES)
-- --------------------------------------------------------------------

-- 3.1 Evoluções Clínicas (CFM 1.821/2007)
ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS signed_by_professional_name VARCHAR(150);

CREATE INDEX IF NOT EXISTS idx_medical_records_org_patient_date
  ON public.medical_records (organization_id, patient_id, record_date DESC);

DROP TRIGGER IF EXISTS trg_medical_records_updated_at ON public.medical_records;
CREATE TRIGGER trg_medical_records_updated_at
  BEFORE UPDATE ON public.medical_records
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_signed_medical_record_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_signed = true OR OLD.status = 'signed' THEN
      RAISE EXCEPTION 'Conformidade CFM nº 1.821/2007: Prontuário assinado é imutável e não pode ser excluído.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_signed = true OR OLD.status = 'signed' THEN
      RAISE EXCEPTION 'Conformidade CFM nº 1.821/2007: Prontuário assinado é imutável e não pode ser alterado. Utilize Adendo / Errata.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_medical_records_immutability ON public.medical_records;
CREATE TRIGGER trg_medical_records_immutability
  BEFORE UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_signed_medical_record_immutability();

-- 3.2 Adendos / Erratas (Append-Only)
ALTER TABLE public.medical_record_addendums
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.medical_record_addendums a
SET organization_id = mr.organization_id
FROM public.medical_records mr
WHERE a.record_id = mr.id
  AND a.organization_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_addendum_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT mr.organization_id INTO NEW.organization_id
    FROM public.medical_records mr
    WHERE mr.id = NEW.record_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_addendum_sync_org ON public.medical_record_addendums;
CREATE TRIGGER trg_addendum_sync_org
  BEFORE INSERT ON public.medical_record_addendums
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_addendum_org_id();

CREATE OR REPLACE FUNCTION public.enforce_addendum_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Conformidade CFM nº 1.821/2007: Adendos registrados no prontuário são imutáveis.';
END;
$$;

DROP TRIGGER IF EXISTS trg_addendum_immutability ON public.medical_record_addendums;
CREATE TRIGGER trg_addendum_immutability
  BEFORE UPDATE OR DELETE ON public.medical_record_addendums
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_addendum_immutability();

CREATE INDEX IF NOT EXISTS idx_medical_record_addendums_record
  ON public.medical_record_addendums (record_id, created_at ASC);

-- 3.3 Receituários (Prescriptions)
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS professional_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS professional_council VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_prescriptions_org_patient
  ON public.prescriptions (organization_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prescription_items_rx
  ON public.prescription_items (prescription_id);

-- 3.4 Atestados Médicos (Medical Certificates)
ALTER TABLE public.medical_certificates
  ADD COLUMN IF NOT EXISTS medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS professional_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS professional_council VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_medical_certificates_org_patient
  ON public.medical_certificates (organization_id, patient_id, created_at DESC);

-- 3.5 Pedidos de Exames (Lab Orders)
ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS professional_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS professional_council VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_lab_orders_org_patient
  ON public.lab_orders (organization_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_order
  ON public.lab_order_items (order_id);

-- 3.6 Resultados e Laudos de Exames (Exam Results) com metadados de Storage privado
ALTER TABLE public.exam_results
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS attachment_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS attachment_mime_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS attachment_size_bytes BIGINT;

CREATE INDEX IF NOT EXISTS idx_exam_results_org_patient
  ON public.exam_results (organization_id, patient_id, performed_date DESC);

-- 3.7 Documentos Médicos Anexados / Arquivos Clínicos do Paciente (PDFs, Laudos externos, Termos)
CREATE TABLE IF NOT EXISTS public.medical_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  professional_name VARCHAR(150),
  document_type VARCHAR(60) NOT NULL DEFAULT 'laudo_externo',
  title VARCHAR(200) NOT NULL,
  description TEXT,
  document_date DATE NOT NULL DEFAULT CURRENT_DATE,
  storage_bucket TEXT NOT NULL DEFAULT 'medical-documents',
  storage_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120),
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_documents_org_patient
  ON public.medical_documents (organization_id, patient_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_medical_documents_updated_at ON public.medical_documents;
CREATE TRIGGER trg_medical_documents_updated_at
  BEFORE UPDATE ON public.medical_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- --------------------------------------------------------------------
-- 4. GARANTIA DE PROFISSIONAL PADRÃO NA SEED (PARA FKs DE DOCUMENTOS)
-- --------------------------------------------------------------------

INSERT INTO public.professionals (
  id,
  organization_id,
  full_name,
  council_number,
  specialty_id,
  phone,
  email,
  bio,
  color,
  is_active
)
SELECT
  'f1111111-1111-1111-1111-111111111111'::uuid,
  o.id,
  'Dr. Newton Mureb',
  'CRM/RJ 52-444985',
  (SELECT s.id FROM public.specialties s WHERE s.organization_id = o.id LIMIT 1),
  '(22) 9908-9122',
  'roseneco1@gmail.com',
  'Clínica Médica, Endocrinologia e Metabologia.',
  '#0284c7',
  true
FROM public.organizations o
WHERE o.slug = 'dr-newton-mureb'
  AND NOT EXISTS (
    SELECT 1 FROM public.professionals p WHERE p.organization_id = o.id
  )
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------
-- 5. POLÍTICAS RLS DE ISOLAMENTO POR ORGANIZAÇÃO E PROTEÇÃO CLÍNICA
-- --------------------------------------------------------------------

-- Tabelas auxiliares de tenant (leitura pelo ERP)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Organizations read access" ON public.organizations;
CREATE POLICY "Organizations read access" ON public.organizations
  FOR SELECT
  USING (
    public.medsync_current_org_id() IS NULL
    OR id = public.medsync_current_org_id()
  );

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Branches tenant read" ON public.branches;
CREATE POLICY "Branches tenant read" ON public.branches
  FOR SELECT
  USING (public.medsync_can_access_org(organization_id));

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Professionals tenant read" ON public.professionals;
CREATE POLICY "Professionals tenant read" ON public.professionals
  FOR SELECT
  USING (public.medsync_can_access_org(organization_id));

DROP POLICY IF EXISTS "Professionals tenant insert" ON public.professionals;
CREATE POLICY "Professionals tenant insert" ON public.professionals
  FOR INSERT
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Clinics (corrige cast de UUID vazio caso exista)
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for clinics" ON public.clinics;
CREATE POLICY "Tenant isolation for clinics" ON public.clinics
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Patients & Patient Branch Access
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for patients" ON public.patients;
CREATE POLICY "Tenant isolation for patients" ON public.patients
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

ALTER TABLE public.patient_branch_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for patient_branch_access" ON public.patient_branch_access;
CREATE POLICY "Tenant isolation for patient_branch_access" ON public.patient_branch_access
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Appointments (corrige cast de UUID vazio caso exista)
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for appointments" ON public.appointments;
CREATE POLICY "Tenant isolation for appointments" ON public.appointments
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Medical Records (com proteção estrita para evoluções assinadas)
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for medical_records" ON public.medical_records;
DROP POLICY IF EXISTS "Medical records select" ON public.medical_records;
DROP POLICY IF EXISTS "Medical records insert" ON public.medical_records;
DROP POLICY IF EXISTS "Medical records update draft only" ON public.medical_records;

CREATE POLICY "Medical records select" ON public.medical_records
  FOR SELECT
  USING (public.medsync_can_access_org(organization_id));

CREATE POLICY "Medical records insert" ON public.medical_records
  FOR INSERT
  WITH CHECK (public.medsync_can_access_org(organization_id));

CREATE POLICY "Medical records update draft only" ON public.medical_records
  FOR UPDATE
  USING (public.medsync_can_access_org(organization_id) AND is_signed = false AND status = 'draft')
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Medical Record Addendums (somente leitura e inserção)
ALTER TABLE public.medical_record_addendums ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Medical addendums select" ON public.medical_record_addendums;
DROP POLICY IF EXISTS "Medical addendums insert" ON public.medical_record_addendums;

CREATE POLICY "Medical addendums select" ON public.medical_record_addendums
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id AND public.medsync_can_access_org(mr.organization_id)
    )
  );

CREATE POLICY "Medical addendums insert" ON public.medical_record_addendums
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id AND public.medsync_can_access_org(mr.organization_id)
    )
  );

-- Prescriptions & Items
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for prescriptions" ON public.prescriptions;
CREATE POLICY "Tenant isolation for prescriptions" ON public.prescriptions
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for prescription_items" ON public.prescription_items;
CREATE POLICY "Tenant isolation for prescription_items" ON public.prescription_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.prescriptions p
      WHERE p.id = prescription_id AND public.medsync_can_access_org(p.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prescriptions p
      WHERE p.id = prescription_id AND public.medsync_can_access_org(p.organization_id)
    )
  );

-- Medical Certificates
ALTER TABLE public.medical_certificates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for medical_certificates" ON public.medical_certificates;
CREATE POLICY "Tenant isolation for medical_certificates" ON public.medical_certificates
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Lab Orders & Items
ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for lab_orders" ON public.lab_orders;
CREATE POLICY "Tenant isolation for lab_orders" ON public.lab_orders
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

ALTER TABLE public.lab_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for lab_order_items" ON public.lab_order_items;
CREATE POLICY "Tenant isolation for lab_order_items" ON public.lab_order_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.lab_orders o
      WHERE o.id = order_id AND public.medsync_can_access_org(o.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.lab_orders o
      WHERE o.id = order_id AND public.medsync_can_access_org(o.organization_id)
    )
  );

-- Exam Results
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for exam_results" ON public.exam_results;
CREATE POLICY "Tenant isolation for exam_results" ON public.exam_results
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Medical Documents (anexos e documentos clínicos)
ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for medical_documents" ON public.medical_documents;
CREATE POLICY "Tenant isolation for medical_documents" ON public.medical_documents
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- Audit Logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for audit_logs" ON public.audit_logs;
CREATE POLICY "Tenant isolation for audit_logs" ON public.audit_logs
  FOR ALL
  USING (public.medsync_can_access_org(organization_id))
  WITH CHECK (public.medsync_can_access_org(organization_id));

-- --------------------------------------------------------------------
-- 6. SUPABASE STORAGE: BUCKET PRIVADO 'medical-documents' + RLS
-- --------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-documents',
  'medical-documents',
  false,
  15728640, -- 15 MB por arquivo clínico
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "MedSync private medical-documents select" ON storage.objects;
CREATE POLICY "MedSync private medical-documents select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "MedSync private medical-documents insert" ON storage.objects;
CREATE POLICY "MedSync private medical-documents insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "MedSync private medical-documents update" ON storage.objects;
CREATE POLICY "MedSync private medical-documents update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "MedSync private medical-documents delete" ON storage.objects;
CREATE POLICY "MedSync private medical-documents delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
  );
