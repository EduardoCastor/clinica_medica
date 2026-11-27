-- ============================================================================
-- MIGRAÇÃO: REORGANIZAÇÃO OFICIAL DE PLANOS COMERCIAIS (GRÁTIS / BÁSICO /
-- AVANÇADO), ARQUIVAMENTO SEGURO E PROTEÇÃO CONTRA EXCLUSÃO COM VÍNCULOS
-- MedSync SaaS (preserva integralmente migrações anteriores aplicadas)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CAMPOS DE AUDITORIA E ARQUIVAMENTO NA TABELA PUBLIC.PLANS
-- ----------------------------------------------------------------------------

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- ----------------------------------------------------------------------------
-- 2. GARANTIR CÁLCULO CANÔNICO DE PREÇOS NO BANCO (SEM SECURITY DEFINER)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.medsync_compute_plan_pricing(
  p_price_monthly NUMERIC,
  p_quarterly_discount NUMERIC,
  p_yearly_discount NUMERIC,
  p_cycle TEXT
)
RETURNS TABLE (
  gross_amount NUMERIC,
  discount_percent NUMERIC,
  final_amount NUMERIC,
  months INT
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_monthly NUMERIC := ROUND(GREATEST(COALESCE(p_price_monthly, 0), 0)::numeric, 2);
  v_q_disc NUMERIC := ROUND(LEAST(95, GREATEST(0, COALESCE(p_quarterly_discount, 10)))::numeric, 2);
  v_y_disc NUMERIC := ROUND(LEAST(95, GREATEST(0, COALESCE(p_yearly_discount, 20)))::numeric, 2);
BEGIN
  IF p_cycle = 'trial' OR v_monthly <= 0 THEN
    RETURN QUERY SELECT 0.00::numeric, 0.00::numeric, 0.00::numeric, 0;
  ELSIF p_cycle = 'quarterly' THEN
    RETURN QUERY SELECT
      ROUND((v_monthly * 3.0)::numeric, 2),
      v_q_disc,
      ROUND((v_monthly * 3.0 * (1.0 - v_q_disc / 100.0))::numeric, 2),
      3;
  ELSIF p_cycle = 'yearly' THEN
    RETURN QUERY SELECT
      ROUND((v_monthly * 12.0)::numeric, 2),
      v_y_disc,
      ROUND((v_monthly * 12.0 * (1.0 - v_y_disc / 100.0))::numeric, 2),
      12;
  ELSE
    RETURN QUERY SELECT
      v_monthly,
      0.00::numeric,
      v_monthly,
      1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_compute_plan_pricing(NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.medsync_compute_plan_pricing(NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. CONSOLIDAÇÃO IDEMPOTENTE DOS 3 PLANOS OFICIAIS E LIMPEZA SEGURA DE LEGADOS
-- ----------------------------------------------------------------------------
-- Planos oficiais obrigatórios:
--   1. trial    -> Grátis   (R$ 0,00 | 10 dias corridos | ativo para novos cadastros)
--   2. basic    -> Básico   (Mensal R$ 399,00 | Trimestral 10% = R$ 1.077,30 | Anual 20% = R$ 3.830,40)
--   3. advanced -> Avançado (Mensal R$ 799,00 | Trimestral 10% = R$ 2.157,30 | Anual 20% = R$ 7.670,40)
-- Planos fora desses 3 códigos:
--   - Excluídos se não possuírem referências em organizations, saas_subscriptions ou saas_invoices.
--   - Arquivados (is_active = false) se possuírem vínculos históricos ou ativos.

DO $$
DECLARE
  v_trial_id UUID;
  v_basic_id UUID;
  v_advanced_id UUID;
  v_legacy RECORD;
  v_ref_count BIGINT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 3.1 Plano Grátis (trial)
  INSERT INTO public.plans (
    code, name, description,
    price_monthly, price_quarterly, price_yearly,
    quarterly_discount_percent, yearly_discount_percent,
    display_order, trial_days,
    max_branches, max_users, max_patients,
    has_patient_sharing, has_whatsapp_automation, has_custom_website,
    has_financial_module, has_advanced_reports,
    is_popular, is_active, archived_at, archived_reason, updated_at
  )
  VALUES (
    'trial',
    'Grátis',
    'Experimente todos os recursos essenciais do MedSync por 10 dias corridos sem cartão de crédito.',
    0.00, 0.00, 0.00,
    0.00, 0.00,
    1, 10,
    2, 5, 150,
    true, true, true,
    true, false,
    false, true, NULL, NULL, v_now
  )
  ON CONFLICT (code) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = 0.00,
    price_quarterly = 0.00,
    price_yearly = 0.00,
    quarterly_discount_percent = 0.00,
    yearly_discount_percent = 0.00,
    display_order = 1,
    trial_days = 10,
    is_popular = false,
    is_active = true,
    archived_at = NULL,
    archived_reason = NULL,
    updated_at = v_now
  RETURNING id INTO v_trial_id;

  -- 3.2 Plano Básico (basic)
  INSERT INTO public.plans (
    code, name, description,
    price_monthly, price_quarterly, price_yearly,
    quarterly_discount_percent, yearly_discount_percent,
    display_order, trial_days,
    max_branches, max_users, max_patients,
    has_patient_sharing, has_whatsapp_automation, has_custom_website,
    has_financial_module, has_advanced_reports,
    is_popular, is_active, archived_at, archived_reason, updated_at
  )
  VALUES (
    'basic',
    'Básico',
    'Ideal para consultórios e clínicas com operação focada em agenda, prontuário eletrônico CFM e financeiro.',
    399.00, 1077.30, 3830.40,
    10.00, 20.00,
    2, 0,
    1, 5, 1000,
    false, false, true,
    true, false,
    false, true, NULL, NULL, v_now
  )
  ON CONFLICT (code) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = 399.00,
    quarterly_discount_percent = 10.00,
    yearly_discount_percent = 20.00,
    price_quarterly = 1077.30,
    price_yearly = 3830.40,
    display_order = 2,
    trial_days = 0,
    is_popular = false,
    is_active = true,
    archived_at = NULL,
    archived_reason = NULL,
    updated_at = v_now
  RETURNING id INTO v_basic_id;

  -- 3.3 Plano Avançado (advanced)
  INSERT INTO public.plans (
    code, name, description,
    price_monthly, price_quarterly, price_yearly,
    quarterly_discount_percent, yearly_discount_percent,
    display_order, trial_days,
    max_branches, max_users, max_patients,
    has_patient_sharing, has_whatsapp_automation, has_custom_website,
    has_financial_module, has_advanced_reports,
    is_popular, is_active, archived_at, archived_reason, updated_at
  )
  VALUES (
    'advanced',
    'Avançado',
    'Para clínicas multiunidade com compartilhamento seguro de pacientes (Modelos A e B), WhatsApp API e BI gerencial.',
    799.00, 2157.30, 7670.40,
    10.00, 20.00,
    3, 0,
    10, 30, 15000,
    true, true, true,
    true, true,
    true, true, NULL, NULL, v_now
  )
  ON CONFLICT (code) DO UPDATE
  SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = 799.00,
    quarterly_discount_percent = 10.00,
    yearly_discount_percent = 20.00,
    price_quarterly = 2157.30,
    price_yearly = 7670.40,
    display_order = 3,
    trial_days = 0,
    is_popular = true,
    is_active = true,
    archived_at = NULL,
    archived_reason = NULL,
    updated_at = v_now
  RETURNING id INTO v_advanced_id;

  -- 3.4 Garantir que nenhuma organização ou assinatura ativa fique sem plan_id
  UPDATE public.organizations o
  SET
    plan_id = CASE
      WHEN COALESCE(o.license_status, '') IN ('TESTE_ATIVO', 'TESTE_EXPIRADO') OR o.status = 'trial'
        THEN v_trial_id
      ELSE v_advanced_id
    END,
    updated_at = v_now
  WHERE o.plan_id IS NULL;

  UPDATE public.saas_subscriptions s
  SET
    plan_id = COALESCE(o.plan_id, v_trial_id),
    updated_at = v_now
  FROM public.organizations o
  WHERE s.organization_id = o.id
    AND s.plan_id IS NULL;

  -- 3.5 Tratar planos fora dos 3 oficiais preservando referências
  FOR v_legacy IN
    SELECT id, code, name
    FROM public.plans
    WHERE id NOT IN (v_trial_id, v_basic_id, v_advanced_id)
  LOOP
    SELECT
      (SELECT COUNT(*) FROM public.organizations WHERE plan_id = v_legacy.id) +
      (SELECT COUNT(*) FROM public.saas_subscriptions WHERE plan_id = v_legacy.id) +
      (SELECT COUNT(*) FROM public.saas_invoices WHERE plan_id = v_legacy.id)
    INTO v_ref_count;

    IF v_ref_count = 0 THEN
      DELETE FROM public.plans WHERE id = v_legacy.id;
    ELSE
      UPDATE public.plans
      SET
        is_active = false,
        is_popular = false,
        display_order = GREATEST(COALESCE(display_order, 99), 99),
        archived_at = COALESCE(archived_at, v_now),
        archived_reason = COALESCE(
          archived_reason,
          'Plano legado arquivado na reorganização oficial (Grátis / Básico / Avançado); preservado por possuir vínculos históricos.'
        ),
        updated_at = v_now
      WHERE id = v_legacy.id;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. GATILHO NO BANCO CONTRA EXCLUSÃO INDEVIDA DE PLANOS VINCULADOS OU DE SISTEMA
-- ----------------------------------------------------------------------------
-- Impede que exclusões em public.plans quebrem referências históricas ou removam
-- o plano 'trial' necessário ao onboarding gratuito de 10 dias.

CREATE OR REPLACE FUNCTION public.medsync_prevent_referenced_plan_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org_refs BIGINT := 0;
  v_sub_refs BIGINT := 0;
  v_inv_refs BIGINT := 0;
BEGIN
  IF OLD.code = 'trial' THEN
    RAISE EXCEPTION 'PLAN_SYSTEM_PROTECTED: O plano Grátis (trial) é obrigatório para o fluxo de avaliação gratuita e não pode ser excluído.';
  END IF;

  SELECT COUNT(*) INTO v_org_refs FROM public.organizations WHERE plan_id = OLD.id;
  SELECT COUNT(*) INTO v_sub_refs FROM public.saas_subscriptions WHERE plan_id = OLD.id;
  SELECT COUNT(*) INTO v_inv_refs FROM public.saas_invoices WHERE plan_id = OLD.id;

  IF (v_org_refs + v_sub_refs + v_inv_refs) > 0 THEN
    RAISE EXCEPTION 'PLAN_IN_USE: Não é possível excluir o plano "%" porque existem vínculos ativos ou históricos (% organizações, % assinaturas, % faturas). Arquive/desative este plano.',
      OLD.name, v_org_refs, v_sub_refs, v_inv_refs;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_plans_prevent_referenced_delete ON public.plans;
CREATE TRIGGER trg_plans_prevent_referenced_delete
  BEFORE DELETE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_prevent_referenced_plan_delete();

-- ----------------------------------------------------------------------------
-- 5. REAFIRMAÇÃO DE RLS PARA SUPER ADMIN EM PUBLIC.PLANS
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Plans super admin write" ON public.plans;
CREATE POLICY "Plans super admin write" ON public.plans
  FOR ALL TO authenticated
  USING (public.medsync_is_saas_platform_admin())
  WITH CHECK (public.medsync_is_saas_platform_admin());
