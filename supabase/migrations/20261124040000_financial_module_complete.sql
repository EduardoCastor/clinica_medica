-- ============================================================================
-- Migration: 20261124040000_financial_module_complete.sql
-- Objetivo:
--   1) Criar tabela public.financial_categories (receitas & despesas) por
--      organização, com carga inicial idempotente das 15 categorias de despesa e
--      categorias padrão de receita + trigger para novas organizações.
--   2) Evoluir public.financial_transactions com colunas reais para Contas a
--      Receber e Contas a Pagar: categoria, origem (consulta/tratamento/manual/despesa),
--      fornecedor, data de emissão (issue_date), data de pagamento/recebimento
--      (payment_date), observações, chave de idempotência, cancelamento lógico
--      e auditoria de autoria.
--   3) Configurar políticas RLS em public.financial_categories, refinar
--      public.financial_transactions (proteção contra exclusão indevida de
--      títulos pagos ou vinculados clinicamente), habilitar RLS + seed idempotente
--      em public.services, e permitir leitura de patients/appointments pelo papel
--      financial sem expor dados do prontuário eletrônico (medical_records).
-- ============================================================================

-- 1. Tabela de Categorias Financeiras (Receitas e Despesas)
CREATE TABLE IF NOT EXISTS public.financial_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  normalized_name VARCHAR(140) NOT NULL,
  category_type VARCHAR(20) NOT NULL CHECK (category_type IN ('receivable', 'payable')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category_type, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_financial_categories_org_type
  ON public.financial_categories (organization_id, category_type, is_active, name);

DROP TRIGGER IF EXISTS trg_financial_categories_updated_at ON public.financial_categories;
CREATE TRIGGER trg_financial_categories_updated_at
  BEFORE UPDATE ON public.financial_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- 2. Função e Trigger de carga inicial idempotente de categorias por organização
CREATE OR REPLACE FUNCTION public.medsync_seed_default_financial_categories(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.financial_categories (organization_id, name, normalized_name, category_type, is_active)
  VALUES
    -- Receitas (Contas a Receber)
    (p_org_id, 'Consulta Médica', 'consulta medica', 'receivable', true),
    (p_org_id, 'Tratamento / Procedimento', 'tratamento / procedimento', 'receivable', true),
    (p_org_id, 'Exame / Bioimpedância', 'exame / bioimpedancia', 'receivable', true),
    (p_org_id, 'Retorno / Acompanhamento', 'retorno / acompanhamento', 'receivable', true),
    (p_org_id, 'Outras Receitas', 'outras receitas', 'receivable', true),

    -- Despesas (Contas a Pagar - 15 categorias padrão editáveis)
    (p_org_id, 'Aluguel', 'aluguel', 'payable', true),
    (p_org_id, 'Condomínio', 'condominio', 'payable', true),
    (p_org_id, 'Energia elétrica', 'energia eletrica', 'payable', true),
    (p_org_id, 'Água', 'agua', 'payable', true),
    (p_org_id, 'Internet e telefonia', 'internet e telefonia', 'payable', true),
    (p_org_id, 'Insumos médicos', 'insumos medicos', 'payable', true),
    (p_org_id, 'Materiais de escritório', 'materiais de escritorio', 'payable', true),
    (p_org_id, 'Limpeza e higiene', 'limpeza e higiene', 'payable', true),
    (p_org_id, 'Folha de pagamento / pró-labore / repasses', 'folha de pagamento / pro-labore / repasses', 'payable', true),
    (p_org_id, 'Impostos e taxas', 'impostos e taxas', 'payable', true),
    (p_org_id, 'Contabilidade', 'contabilidade', 'payable', true),
    (p_org_id, 'Software e sistemas', 'software e sistemas', 'payable', true),
    (p_org_id, 'Marketing e tráfego', 'marketing e trafego', 'payable', true),
    (p_org_id, 'Manutenção e equipamentos', 'manutencao e equipamentos', 'payable', true),
    (p_org_id, 'Outras despesas', 'outras despesas', 'payable', true)
  ON CONFLICT (organization_id, category_type, normalized_name) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.medsync_trg_seed_financial_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.medsync_seed_default_financial_categories(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_seed_financial_categories ON public.organizations;
CREATE TRIGGER trg_organizations_seed_financial_categories
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_trg_seed_financial_categories();

-- Executar carga idempotente de categorias para todas as organizações já existentes
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    PERFORM public.medsync_seed_default_financial_categories(v_org.id);
  END LOOP;
END;
$$;

-- 3. Evolução da tabela public.financial_transactions
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS origin_type VARCHAR(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS medical_record_id UUID REFERENCES public.medical_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS treatment_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS issue_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

-- Backfill seguro de registros existentes
UPDATE public.financial_transactions
SET
  issue_date = COALESCE(issue_date, (created_at AT TIME ZONE 'America/Sao_Paulo')::date),
  payment_date = COALESCE(
    payment_date,
    CASE
      WHEN status = 'paid' THEN COALESCE((paid_at AT TIME ZONE 'America/Sao_Paulo')::date, due_date)
      ELSE NULL
    END
  ),
  origin_type = CASE
    WHEN appointment_id IS NOT NULL THEN 'appointment'
    WHEN service_id IS NOT NULL AND transaction_type = 'receivable' THEN 'treatment'
    WHEN transaction_type = 'payable' THEN 'expense'
    ELSE COALESCE(NULLIF(origin_type, ''), 'manual')
  END,
  category_name = COALESCE(
    NULLIF(category_name, ''),
    CASE
      WHEN appointment_id IS NOT NULL THEN 'Consulta Médica'
      WHEN service_id IS NOT NULL AND transaction_type = 'receivable' THEN 'Tratamento / Procedimento'
      WHEN transaction_type = 'payable' THEN 'Outras despesas'
      ELSE 'Outras Receitas'
    END
  )
WHERE payment_date IS NULL AND status = 'paid'
   OR category_name IS NULL
   OR origin_type = 'manual';

-- Chave de idempotência para evitar duplicidade de cobranças automáticas por consulta/tratamento ativo
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_tx_org_idempotency
  ON public.financial_transactions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_financial_org_type_status_due
  ON public.financial_transactions (organization_id, transaction_type, status, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_financial_org_type_payment_date
  ON public.financial_transactions (organization_id, transaction_type, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_financial_org_appointment
  ON public.financial_transactions (organization_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

-- 4. RLS para public.financial_categories
ALTER TABLE public.financial_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Financial categories select" ON public.financial_categories;
DROP POLICY IF EXISTS "Financial categories insert" ON public.financial_categories;
DROP POLICY IF EXISTS "Financial categories update" ON public.financial_categories;
DROP POLICY IF EXISTS "Financial categories delete" ON public.financial_categories;

CREATE POLICY "Financial categories select" ON public.financial_categories
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'consult')
      OR public.medsync_has_menu_permission('financial', 'view')
      OR public.medsync_current_role() IN ('super_admin', 'clinic_admin', 'branch_admin', 'financial')
    )
  );

CREATE POLICY "Financial categories insert" ON public.financial_categories
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'create')
      OR public.medsync_has_menu_permission('financial', 'edit')
      OR public.medsync_has_menu_permission('financial', 'admin')
    )
  );

CREATE POLICY "Financial categories update" ON public.financial_categories
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'edit')
      OR public.medsync_has_menu_permission('financial', 'admin')
    )
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'edit')
      OR public.medsync_has_menu_permission('financial', 'admin')
    )
  );

CREATE POLICY "Financial categories delete" ON public.financial_categories
  FOR DELETE
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'delete')
      OR public.medsync_has_menu_permission('financial', 'admin')
    )
  );

-- 5. Refinamento do RLS de exclusão em public.financial_transactions
-- Bloqueia exclusão física de lançamentos já quitados ou vinculados clinicamente
-- (esses devem usar cancelamento lógico via UPDATE com cancellation_reason).
DROP POLICY IF EXISTS "Financial delete strict" ON public.financial_transactions;
CREATE POLICY "Financial delete strict" ON public.financial_transactions
  FOR DELETE
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'delete')
      OR public.medsync_has_menu_permission('financial', 'admin')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
    AND status <> 'paid'
    AND appointment_id IS NULL
    AND medical_record_id IS NULL
  );

-- 6. RLS para public.services e carga inicial idempotente para organizações sem serviços cadastrados
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Services select org" ON public.services;
DROP POLICY IF EXISTS "Services manage settings" ON public.services;

CREATE POLICY "Services select org" ON public.services
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_is_active_user()
  );

CREATE POLICY "Services manage settings" ON public.services
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_current_role() IN ('super_admin', 'clinic_admin')
    )
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_current_role() IN ('super_admin', 'clinic_admin')
    )
  );

-- Carga inicial de serviços/tratamentos reais para organizações que ainda não possuem serviços no banco
DO $$
DECLARE
  v_org RECORD;
  v_spec_id UUID;
BEGIN
  FOR v_org IN
    SELECT o.id
    FROM public.organizations o
    WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.organization_id = o.id)
  LOOP
    SELECT id INTO v_spec_id
    FROM public.specialties
    WHERE organization_id = v_org.id
    ORDER BY created_at ASC
    LIMIT 1;

    INSERT INTO public.services (organization_id, name, duration_minutes, price, description, specialty_id, is_active)
    VALUES
      (v_org.id, 'Consulta Médica / Avaliação Clínica', 50, 650.00, 'Consulta médica ambulatorial em Clínica Médica, Endocrinologia e Metabologia.', v_spec_id, true),
      (v_org.id, 'Modulação Hormonal Bioidêntica', 60, 850.00, 'Avaliação hormonal completa e reposição individualizada com hormônios bioidênticos.', v_spec_id, true),
      (v_org.id, 'Emagrecimento Saudável', 60, 750.00, 'Protocolo médico personalizado para redução de gordura corporal e acompanhamento metabólico.', v_spec_id, true),
      (v_org.id, 'Tratamentos Injetáveis (Análogos de GLP-1 e GIP)', 40, 900.00, 'Terapia médica assistida com análogos de GLP-1 e GIP e monitoramento metabólico.', v_spec_id, true),
      (v_org.id, 'Tratamento de Lipedema', 50, 780.00, 'Diagnóstico clínico, controle inflamatório e abordagem metabólica integral para lipedema.', v_spec_id, true),
      (v_org.id, 'Soroterapia', 45, 550.00, 'Reposição endovenosa individualizada de micronutrientes, vitaminas e antioxidantes.', v_spec_id, true),
      (v_org.id, 'Implantes Hormonais Bioidênticos', 60, 1800.00, 'Procedimento ambulatorial de implante hormonal subcutâneo com acompanhamento médico.', v_spec_id, true),
      (v_org.id, 'Hipertrofia e Preparação de Atletas', 50, 800.00, 'Otimização metabólica e monitoramento endócrino para performance.', v_spec_id, true),
      (v_org.id, 'Acompanhamento Pós-Bariátrica', 50, 680.00, 'Vigilância nutricional e metabólica contínua no pós-operatório bariátrico.', v_spec_id, true),
      (v_org.id, 'Distúrbios da Tireoide (Hipo/Hipertireoidismo)', 50, 650.00, 'Investigação e ajuste fino da função tireoidiana.', v_spec_id, true),
      (v_org.id, 'Síndrome do Ovário Policístico (SOP)', 50, 650.00, 'Manejo endócrino e metabólico da SOP e resistência insulínica.', v_spec_id, true),
      (v_org.id, 'Fibromialgia', 50, 650.00, 'Abordagem médica multimodal para controle da dor crônica e qualidade de vida.', v_spec_id, true),
      (v_org.id, 'Bioimpedância', 30, 250.00, 'Análise segmentada de composição corporal.', v_spec_id, true);
  END LOOP;
END;
$$;

-- 7. Permitir ao módulo financeiro consultar nomes de pacientes e agendamentos faturáveis
-- IMPORTANTE: mantém medical_records, prescriptions, medical_certificates, lab_orders,
-- exam_results e medical_documents 100% bloqueados para perfis sem permissão em medical_records.
DROP POLICY IF EXISTS "Patients select strict" ON public.patients;
CREATE POLICY "Patients select strict" ON public.patients
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('patients', 'consult')
      OR public.medsync_has_menu_permission('medical_records', 'consult')
      OR public.medsync_has_menu_permission('appointments', 'consult')
      OR public.medsync_has_menu_permission('financial', 'consult')
    )
    AND (
      public.medsync_user_has_branch_access(organization_id, origin_branch_id)
      OR (
        sharing_mode = 'model_b_shared'
        AND EXISTS (
          SELECT 1 FROM public.patient_branch_access pba
          WHERE pba.patient_id = id
            AND public.medsync_user_has_branch_access(organization_id, pba.branch_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "Appointments select strict" ON public.appointments;
CREATE POLICY "Appointments select strict" ON public.appointments
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('appointments', 'consult')
      OR public.medsync_has_menu_permission('financial', 'consult')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );
