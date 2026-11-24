-- ============================================================================
-- Migration: 20261124030000_lab_exam_catalog_and_order_items.sql
-- Objetivo:
--   1) Criar o catálogo persistente de exames laboratoriais (public.lab_exam_catalog)
--      com suporte a inclusão e ativação/desativação futura sem alteração de código.
--   2) Inserir de forma estritamente idempotente os 47 exames iniciais solicitados.
--   3) Evoluir public.lab_order_items para distinguir exames do catálogo vs
--      exames personalizados ("Outros Exames") preservando compatibilidade total.
--   4) Aplicar RLS alinhado ao RBAC existente (proibindo acesso de pacientes).
-- ============================================================================

-- 1. Tabela do Catálogo de Exames Laboratoriais
CREATE TABLE IF NOT EXISTS public.lab_exam_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (
    lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
  ) STORED,
  exam_type VARCHAR(50) NOT NULL DEFAULT 'laboratorial',
  default_observations TEXT,
  display_order INT NOT NULL DEFAULT 1000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lab_exam_catalog_org_norm UNIQUE (organization_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_lab_exam_catalog_org_active_order
  ON public.lab_exam_catalog (organization_id, is_active, display_order ASC, name ASC);

DROP TRIGGER IF EXISTS trg_lab_exam_catalog_updated_at ON public.lab_exam_catalog;
CREATE TRIGGER trg_lab_exam_catalog_updated_at
  BEFORE UPDATE ON public.lab_exam_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- 2. Evolução não-destrutiva de public.lab_order_items
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS catalog_exam_id UUID REFERENCES public.lab_exam_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_lab_order_items_catalog_exam
  ON public.lab_order_items (catalog_exam_id);

-- 3. RLS estrito para public.lab_exam_catalog (respeitando RBAC existente)
ALTER TABLE public.lab_exam_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lab exam catalog select strict" ON public.lab_exam_catalog;
DROP POLICY IF EXISTS "Lab exam catalog insert strict" ON public.lab_exam_catalog;
DROP POLICY IF EXISTS "Lab exam catalog update strict" ON public.lab_exam_catalog;

CREATE POLICY "Lab exam catalog select strict" ON public.lab_exam_catalog
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND (
      public.medsync_has_menu_permission('medical_records', 'consult')
      OR public.medsync_has_menu_permission('medical_records', 'view')
      OR public.medsync_has_menu_permission('settings', 'consult')
      OR public.medsync_current_role() IN ('super_admin', 'clinic_admin', 'doctor', 'physiotherapist')
    )
  );

CREATE POLICY "Lab exam catalog insert strict" ON public.lab_exam_catalog
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND (
      public.medsync_has_menu_permission('medical_records', 'create')
      OR public.medsync_has_menu_permission('medical_records', 'edit')
      OR public.medsync_has_menu_permission('medical_records', 'admin')
      OR public.medsync_has_menu_permission('settings', 'create')
      OR public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_has_menu_permission('settings', 'admin')
    )
  );

CREATE POLICY "Lab exam catalog update strict" ON public.lab_exam_catalog
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND (
      public.medsync_has_menu_permission('medical_records', 'edit')
      OR public.medsync_has_menu_permission('medical_records', 'create')
      OR public.medsync_has_menu_permission('medical_records', 'admin')
      OR public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_has_menu_permission('settings', 'admin')
    )
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() <> 'patient'
    AND (
      public.medsync_has_menu_permission('medical_records', 'edit')
      OR public.medsync_has_menu_permission('medical_records', 'create')
      OR public.medsync_has_menu_permission('medical_records', 'admin')
      OR public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_has_menu_permission('settings', 'admin')
    )
  );

-- 4. Reforço de RLS em public.lab_order_items alinhado a public.lab_orders e RBAC
ALTER TABLE public.lab_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for lab_order_items" ON public.lab_order_items;
DROP POLICY IF EXISTS "Lab order items select strict" ON public.lab_order_items;
DROP POLICY IF EXISTS "Lab order items insert strict" ON public.lab_order_items;
DROP POLICY IF EXISTS "Lab order items update strict" ON public.lab_order_items;
DROP POLICY IF EXISTS "Lab order items delete strict" ON public.lab_order_items;

CREATE POLICY "Lab order items select strict" ON public.lab_order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.lab_orders o
      WHERE o.id = order_id
        AND public.medsync_can_access_org(o.organization_id)
        AND public.medsync_has_menu_permission('medical_records', 'consult')
        AND public.medsync_user_has_branch_access(o.organization_id, o.branch_id)
    )
  );

CREATE POLICY "Lab order items insert strict" ON public.lab_order_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.lab_orders o
      WHERE o.id = order_id
        AND public.medsync_can_access_org(o.organization_id)
        AND public.medsync_has_menu_permission('medical_records', 'create')
        AND public.medsync_user_has_branch_access(o.organization_id, o.branch_id)
    )
  );

CREATE POLICY "Lab order items update strict" ON public.lab_order_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.lab_orders o
      WHERE o.id = order_id
        AND public.medsync_can_access_org(o.organization_id)
        AND public.medsync_has_menu_permission('medical_records', 'edit')
        AND public.medsync_user_has_branch_access(o.organization_id, o.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.lab_orders o
      WHERE o.id = order_id
        AND public.medsync_can_access_org(o.organization_id)
        AND public.medsync_has_menu_permission('medical_records', 'edit')
        AND public.medsync_user_has_branch_access(o.organization_id, o.branch_id)
    )
  );

CREATE POLICY "Lab order items delete strict" ON public.lab_order_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.lab_orders o
      WHERE o.id = order_id
        AND public.medsync_can_access_org(o.organization_id)
        AND (
          public.medsync_has_menu_permission('medical_records', 'delete')
          OR public.medsync_has_menu_permission('medical_records', 'edit')
        )
        AND public.medsync_user_has_branch_access(o.organization_id, o.branch_id)
    )
  );

-- 5. Função de Carga Idempotente dos 47 Exames Iniciais por Organização
CREATE OR REPLACE FUNCTION public.medsync_seed_lab_exam_catalog_for_org(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.lab_exam_catalog (
    organization_id,
    name,
    exam_type,
    display_order,
    is_active
  )
  VALUES
    (p_org_id, 'Hemograma Completo', 'laboratorial', 1, true),
    (p_org_id, 'Glicose', 'laboratorial', 2, true),
    (p_org_id, 'HbA1c', 'laboratorial', 3, true),
    (p_org_id, 'Ureia', 'laboratorial', 4, true),
    (p_org_id, 'Creatinina', 'laboratorial', 5, true),
    (p_org_id, 'Ácido Úrico', 'laboratorial', 6, true),
    (p_org_id, 'Lipidograma', 'laboratorial', 7, true),
    (p_org_id, 'Insulina', 'laboratorial', 8, true),
    (p_org_id, 'Proteínas Totais e Frações', 'laboratorial', 9, true),
    (p_org_id, 'Hepatograma', 'laboratorial', 10, true),
    (p_org_id, 'Coagulograma', 'laboratorial', 11, true),
    (p_org_id, 'Ferritina', 'laboratorial', 12, true),
    (p_org_id, 'Ferro Sérico', 'laboratorial', 13, true),
    (p_org_id, 'Transferrina', 'laboratorial', 14, true),
    (p_org_id, 'Vitamina D3', 'laboratorial', 15, true),
    (p_org_id, 'Vitamina B12', 'laboratorial', 16, true),
    (p_org_id, 'Ácido Fólico', 'laboratorial', 17, true),
    (p_org_id, 'Vitamina C', 'laboratorial', 18, true),
    (p_org_id, 'Cálcio Iônico', 'laboratorial', 19, true),
    (p_org_id, 'Fósforo', 'laboratorial', 20, true),
    (p_org_id, 'PTH', 'laboratorial', 21, true),
    (p_org_id, 'TSH', 'laboratorial', 22, true),
    (p_org_id, 'T4 Livre', 'laboratorial', 23, true),
    (p_org_id, 'T3 Livre', 'laboratorial', 24, true),
    (p_org_id, 'T3 Reverso', 'laboratorial', 25, true),
    (p_org_id, 'Anti-TPO', 'laboratorial', 26, true),
    (p_org_id, 'Anti-Tg', 'laboratorial', 27, true),
    (p_org_id, 'Tireoglobulina', 'laboratorial', 28, true),
    (p_org_id, 'TRAb', 'laboratorial', 29, true),
    (p_org_id, 'Iodo', 'laboratorial', 30, true),
    (p_org_id, 'ACTH', 'laboratorial', 31, true),
    (p_org_id, 'Cortisol', 'laboratorial', 32, true),
    (p_org_id, 'Aldosterona', 'laboratorial', 33, true),
    (p_org_id, 'DHEA', 'laboratorial', 34, true),
    (p_org_id, 'S-DHEA', 'laboratorial', 35, true),
    (p_org_id, '17-OHP', 'laboratorial', 36, true),
    (p_org_id, 'Androstenediona', 'laboratorial', 37, true),
    (p_org_id, 'FSH', 'laboratorial', 38, true),
    (p_org_id, 'LH', 'laboratorial', 39, true),
    (p_org_id, 'Estradiol', 'laboratorial', 40, true),
    (p_org_id, 'Prolactina', 'laboratorial', 41, true),
    (p_org_id, 'Progesterona', 'laboratorial', 42, true),
    (p_org_id, 'SHBG', 'laboratorial', 43, true),
    (p_org_id, 'Testosterona Total', 'laboratorial', 44, true),
    (p_org_id, 'Testosterona Livre', 'laboratorial', 45, true),
    (p_org_id, 'DHT', 'laboratorial', 46, true),
    (p_org_id, 'Testosterona Biodisponível', 'laboratorial', 47, true)
  ON CONFLICT (organization_id, normalized_name) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_seed_lab_exam_catalog_for_org(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_seed_lab_exam_catalog_for_org(UUID) TO service_role;

-- Backfill idempotente para todas as organizações já existentes
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    PERFORM public.medsync_seed_lab_exam_catalog_for_org(v_org.id);
  END LOOP;
END;
$$;

-- Trigger para novas organizações receberem automaticamente o catálogo inicial
CREATE OR REPLACE FUNCTION public.trg_seed_lab_exam_catalog_on_org_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.medsync_seed_lab_exam_catalog_for_org(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_seed_lab_exam_catalog_on_org_fn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seed_lab_exam_catalog_on_org_insert ON public.organizations;
CREATE TRIGGER trg_seed_lab_exam_catalog_on_org_insert
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seed_lab_exam_catalog_on_org_fn();
