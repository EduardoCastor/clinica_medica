-- ====================================================================
-- MIGRAÇÃO: CONSOLIDAÇÃO COMERCIAL, TESTE GRATUITO 10 DIAS, LICENÇAS,
-- COBRANÇAS / GATEWAY E AUDITORIA SAAS
-- MedSync SaaS
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. APRIMORAMENTO DA TABELA PUBLIC.PLANS (PREÇOS ÚNICOS NO SUPABASE)
-- --------------------------------------------------------------------

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS quarterly_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS yearly_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN IF NOT EXISTS price_quarterly DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill seguro de display_order, descontos e preço trimestral preservando preços já editados
UPDATE public.plans
SET
  display_order = CASE
    WHEN code = 'trial' THEN 1
    WHEN code = 'basic' THEN 2
    WHEN code = 'advanced' THEN 3
    ELSE COALESCE(display_order, 10)
  END,
  is_popular = CASE
    WHEN code = 'advanced' THEN true
    ELSE COALESCE(is_popular, false)
  END,
  quarterly_discount_percent = CASE
    WHEN code = 'trial' OR price_monthly <= 0 THEN 0.00
    ELSE COALESCE(quarterly_discount_percent, 10.00)
  END,
  yearly_discount_percent = CASE
    WHEN code = 'trial' OR price_monthly <= 0 THEN 0.00
    WHEN price_yearly > 0 AND price_monthly > 0 THEN
      GREATEST(0.00, LEAST(95.00, ROUND(((1.0 - (price_yearly / (price_monthly * 12.0))) * 100.0)::numeric, 2)))
    ELSE COALESCE(yearly_discount_percent, 20.00)
  END,
  price_quarterly = CASE
    WHEN code = 'trial' OR price_monthly <= 0 THEN 0.00
    WHEN price_quarterly > 0 THEN price_quarterly
    ELSE ROUND((price_monthly * 3.0 * (1.0 - (COALESCE(quarterly_discount_percent, 10.00) / 100.0)))::numeric, 2)
  END;

-- Garantir planos base somente se não existirem (nunca sobrescreve valores reais já salvos)
INSERT INTO public.plans (
  code, name, description, price_monthly, price_quarterly, price_yearly,
  quarterly_discount_percent, yearly_discount_percent, display_order,
  trial_days, max_branches, max_users, max_patients,
  has_patient_sharing, has_whatsapp_automation, has_custom_website,
  has_financial_module, has_advanced_reports, is_popular, is_active
)
VALUES
  (
    'trial',
    'Teste Grátis (Trial)',
    'Experimente todas as funcionalidades da plataforma por 10 dias sem compromisso.',
    0.00, 0.00, 0.00, 0.00, 0.00, 1,
    10, 2, 5, 150,
    true, true, true, true, false, false, true
  ),
  (
    'basic',
    'Plano Básico',
    'Ideal para consultórios e clínicas em fase inicial com operação concentrada.',
    249.00, 672.30, 2390.00, 10.00, 20.02, 2,
    0, 1, 3, 600,
    false, false, true, true, false, false, true
  ),
  (
    'advanced',
    'Plano Avançado Multiunidade',
    'Para clínicas estruturadas com múltiplas filiais, compartilhamento seguro de pacientes e automações.',
    589.00, 1590.30, 5650.00, 10.00, 20.06, 3,
    0, 10, 25, 10000,
    true, true, true, true, true, true, true
  )
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------------
-- 2. EXPANSÃO DE PUBLIC.ORGANIZATIONS PARA LICENÇAS, TRIAL E ONBOARDING
-- --------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS license_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(150),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB NOT NULL DEFAULT '{"completedSteps":[],"skipped":false,"currentStep":1}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

-- Backfill coerente das organizações existentes preservando status atual
UPDATE public.organizations o
SET
  license_status = COALESCE(
    o.license_status,
    CASE
      WHEN o.status = 'active' THEN 'ATIVA'
      WHEN o.status = 'suspended' THEN 'SUSPENSA'
      WHEN o.status = 'overdue' THEN 'INADIMPLENTE'
      WHEN o.status = 'trial' AND o.trial_ends_at IS NOT NULL AND o.trial_ends_at <= now() THEN 'TESTE_EXPIRADO'
      ELSE 'TESTE_ATIVO'
    END
  ),
  billing_cycle = CASE
    WHEN o.status = 'active' AND o.billing_cycle = 'trial' THEN 'monthly'
    ELSE o.billing_cycle
  END,
  responsible_name = COALESCE(
    o.responsible_name,
    (SELECT c.trade_name FROM public.clinics c WHERE c.organization_id = o.id ORDER BY c.created_at ASC LIMIT 1),
    o.name
  ),
  contact_email = COALESCE(
    o.contact_email,
    (SELECT c.email FROM public.clinics c WHERE c.organization_id = o.id ORDER BY c.created_at ASC LIMIT 1)
  ),
  contact_phone = COALESCE(
    o.contact_phone,
    (SELECT COALESCE(NULLIF(c.whatsapp, ''), c.phone) FROM public.clinics c WHERE c.organization_id = o.id ORDER BY c.created_at ASC LIMIT 1)
  ),
  trial_started_at = COALESCE(o.trial_started_at, CASE WHEN o.status = 'trial' THEN o.created_at ELSE NULL END),
  onboarding_completed = CASE
    WHEN o.slug = 'dr-newton-mureb' OR o.status = 'active' THEN true
    ELSE o.onboarding_completed
  END;

-- --------------------------------------------------------------------
-- 3. TABELAS DEDICADAS DE LICENÇAS, COBRANÇAS, WEBHOOKS, ANTI-ABUSO E AUDITORIA SAAS
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.saas_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'trial',
  license_status VARCHAR(40) NOT NULL DEFAULT 'TESTE_ATIVO',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  next_due_date TIMESTAMPTZ,
  unit_monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  final_cycle_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  payment_provider VARCHAR(40) DEFAULT 'none',
  external_subscription_id VARCHAR(150),
  external_customer_id VARCHAR(150),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_status
  ON public.saas_subscriptions (license_status, next_due_date);

CREATE TABLE IF NOT EXISTS public.saas_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.saas_subscriptions(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
  reference_code VARCHAR(80) UNIQUE NOT NULL,
  gross_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  final_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'BRL',
  status VARCHAR(30) NOT NULL DEFAULT 'pending', -- pending, paid, overdue, cancelled, refunded
  payment_method VARCHAR(40),
  payment_provider VARCHAR(40) NOT NULL DEFAULT 'pending_gateway',
  external_order_id VARCHAR(150),
  external_checkout_url TEXT,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  manual_confirmation_reason TEXT,
  confirmed_by_profile_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  confirmed_by_email VARCHAR(150),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_invoices_org_status
  ON public.saas_invoices (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.saas_payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(40) NOT NULL,
  provider_event_id VARCHAR(180) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'received', -- received, processed, ignored, rejected, error
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.saas_invoices(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.saas_trial_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash VARCHAR(64) NOT NULL UNIQUE,
  document_digits VARCHAR(30),
  clinic_slug_norm VARCHAR(100),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_trial_claims_doc
  ON public.saas_trial_claims (document_digits)
  WHERE document_digits IS NOT NULL AND length(document_digits) >= 11;

CREATE TABLE IF NOT EXISTS public.saas_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  actor_profile_id UUID,
  actor_email VARCHAR(150),
  actor_role VARCHAR(50),
  target_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id TEXT,
  reason TEXT,
  previous_state JSONB,
  new_state JSONB,
  ip_address VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_audit_logs_created
  ON public.saas_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saas_audit_logs_org
  ON public.saas_audit_logs (target_organization_id, created_at DESC);

-- Proteção de imutabilidade em saas_audit_logs
CREATE OR REPLACE FUNCTION public.medsync_prevent_saas_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Trilha de auditoria SaaS é imutável (append-only).';
END;
$$;

DROP TRIGGER IF EXISTS trg_saas_audit_logs_immutable ON public.saas_audit_logs;
CREATE TRIGGER trg_saas_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.saas_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_prevent_saas_audit_mutation();

-- Backfill de saas_subscriptions para organizações existentes
INSERT INTO public.saas_subscriptions (
  organization_id, plan_id, billing_cycle, license_status, started_at,
  trial_ends_at, current_period_start, current_period_end, next_due_date,
  unit_monthly_price, discount_percent, final_cycle_amount, payment_provider
)
SELECT
  o.id,
  o.plan_id,
  COALESCE(o.billing_cycle, CASE WHEN o.status = 'active' THEN 'monthly' ELSE 'trial' END),
  COALESCE(o.license_status, 'TESTE_ATIVO'),
  COALESCE(o.trial_started_at, o.created_at),
  o.trial_ends_at,
  o.created_at,
  COALESCE(o.subscription_renews_at, o.trial_ends_at),
  COALESCE(o.subscription_renews_at, o.trial_ends_at),
  COALESCE(p.price_monthly, 0.00),
  0.00,
  COALESCE(p.price_monthly, 0.00),
  CASE WHEN o.status = 'active' THEN 'manual' ELSE 'none' END
FROM public.organizations o
LEFT JOIN public.plans p ON p.id = o.plan_id
ON CONFLICT (organization_id) DO NOTHING;

-- --------------------------------------------------------------------
-- 4. FUNÇÕES CENTRALIZADAS DE SEGURANÇA, PREÇOS E BLOQUEIO DE TRIAL EXPIRADO
-- --------------------------------------------------------------------

-- Verificação autoritativa exclusivamente no servidor (BD) de Super Admin SaaS
CREATE OR REPLACE FUNCTION public.medsync_is_saas_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.user_id = auth.uid()
      AND up.is_active = true
      AND up.role_code = 'super_admin'
  );
$$;

-- Cálculo canônico de preço (idêntico ao frontend saasCommercialUtils.ts)
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

-- Verifica se a organização possui licença ativa (ou trial válido dentro dos 10 dias) para escrita operacional/clínica
CREATE OR REPLACE FUNCTION public.medsync_org_has_active_write_access(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_org_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = target_org_id
        AND (
          COALESCE(o.license_status, CASE WHEN o.status = 'active' THEN 'ATIVA' WHEN o.status = 'trial' THEN 'TESTE_ATIVO' ELSE 'SUSPENSA' END) = 'ATIVA'
          OR (
            COALESCE(o.license_status, CASE WHEN o.status = 'trial' THEN 'TESTE_ATIVO' ELSE '' END) = 'TESTE_ATIVO'
            AND o.trial_ends_at IS NOT NULL
            AND o.trial_ends_at > now()
          )
          OR (
            o.license_status = 'PAGAMENTO_PENDENTE'
            AND (
              (o.subscription_renews_at IS NOT NULL AND o.subscription_renews_at > now())
              OR (o.trial_ends_at IS NOT NULL AND o.trial_ends_at > now())
            )
          )
        )
    )
  END;
$$;

-- Sincronização automática de testes expirados (idempotente)
CREATE OR REPLACE FUNCTION public.medsync_sync_expired_trials()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_org RECORD;
BEGIN
  FOR v_org IN
    SELECT id, name, trial_ends_at, license_status
    FROM public.organizations
    WHERE COALESCE(license_status, CASE WHEN status = 'trial' THEN 'TESTE_ATIVO' ELSE '' END) = 'TESTE_ATIVO'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at <= now()
  LOOP
    UPDATE public.organizations
    SET
      license_status = 'TESTE_EXPIRADO',
      status = 'overdue',
      status_reason = COALESCE(status_reason, 'Período de teste gratuito de 10 dias expirado.'),
      updated_at = now()
    WHERE id = v_org.id;

    UPDATE public.saas_subscriptions
    SET
      license_status = 'TESTE_EXPIRADO',
      updated_at = now()
    WHERE organization_id = v_org.id;

    INSERT INTO public.saas_audit_logs (
      actor_role, target_organization_id, action, entity, entity_id,
      reason, previous_state, new_state
    )
    VALUES (
      'system',
      v_org.id,
      'trial_expired_auto',
      'organizations',
      v_org.id::text,
      'Expiração automática ao atingir trial_ends_at.',
      jsonb_build_object('license_status', v_org.license_status, 'trial_ends_at', v_org.trial_ends_at),
      jsonb_build_object('license_status', 'TESTE_EXPIRADO', 'status', 'overdue')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_sync_expired_trials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_sync_expired_trials() TO service_role;

-- --------------------------------------------------------------------
-- 5. RLS DE PLANS + NOVAS TABELAS SAAS + BLOQUEIO DE ESCRITA EM TRIAL EXPIRADO
-- --------------------------------------------------------------------

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Plans public read" ON public.plans;
DROP POLICY IF EXISTS "Plans super admin write" ON public.plans;

CREATE POLICY "Plans public read" ON public.plans
  FOR SELECT
  USING (is_active = true OR public.medsync_is_saas_platform_admin());

CREATE POLICY "Plans super admin write" ON public.plans
  FOR ALL
  USING (public.medsync_is_saas_platform_admin())
  WITH CHECK (public.medsync_is_saas_platform_admin());

-- Tabelas SaaS administrativas: somente super_admin (leitura do próprio org apenas para faturas/assinatura)
ALTER TABLE public.saas_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Saas subscriptions select" ON public.saas_subscriptions;
CREATE POLICY "Saas subscriptions select" ON public.saas_subscriptions
  FOR SELECT
  USING (
    public.medsync_is_saas_platform_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_current_role() IN ('clinic_admin', 'super_admin')
    )
  );

ALTER TABLE public.saas_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Saas invoices select" ON public.saas_invoices;
CREATE POLICY "Saas invoices select" ON public.saas_invoices
  FOR SELECT
  USING (
    public.medsync_is_saas_platform_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_current_role() IN ('clinic_admin', 'financial', 'super_admin')
    )
  );

ALTER TABLE public.saas_payment_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Saas webhook events super admin only" ON public.saas_payment_webhook_events;
CREATE POLICY "Saas webhook events super admin only" ON public.saas_payment_webhook_events
  FOR SELECT
  USING (public.medsync_is_saas_platform_admin());

ALTER TABLE public.saas_trial_claims ENABLE ROW LEVEL SECURITY;
-- Sem policy para anon/authenticated: acesso exclusivo via service_role / SECURITY DEFINER

ALTER TABLE public.saas_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Saas audit logs super admin select" ON public.saas_audit_logs;
CREATE POLICY "Saas audit logs super admin select" ON public.saas_audit_logs
  FOR SELECT
  USING (public.medsync_is_saas_platform_admin());

-- Políticas RESTRICTIVE de escrita nas tabelas operacionais e clínicas:
-- Quando trial expirar ou conta estiver suspensa/inadimplente/cancelada,
-- SELECT permanece íntegro (dados preservados) e INSERT/UPDATE/DELETE são bloqueados no PostgreSQL!

DO $$
DECLARE
  v_tbl TEXT;
  v_org_tables TEXT[] := ARRAY[
    'patients',
    'appointments',
    'waitlist',
    'medical_records',
    'prescriptions',
    'medical_certificates',
    'lab_orders',
    'exam_results',
    'medical_documents',
    'patient_anamnesis_records',
    'patient_anthropometric_measurements',
    'financial_transactions',
    'branches',
    'rooms',
    'professionals',
    'services',
    'attendance_calls'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_org_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS "License write guard insert" ON public.%I;', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS "License write guard update" ON public.%I;', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS "License write guard delete" ON public.%I;', v_tbl);

      EXECUTE format(
        'CREATE POLICY "License write guard insert" ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.medsync_org_has_active_write_access(organization_id));',
        v_tbl
      );
      EXECUTE format(
        'CREATE POLICY "License write guard update" ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.medsync_org_has_active_write_access(organization_id)) WITH CHECK (public.medsync_org_has_active_write_access(organization_id));',
        v_tbl
      );
      EXECUTE format(
        'CREATE POLICY "License write guard delete" ON public.%I AS RESTRICTIVE FOR DELETE USING (public.medsync_org_has_active_write_access(organization_id));',
        v_tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- Adendos também respeitam licença ativa via registro pai
DROP POLICY IF EXISTS "License write guard insert" ON public.medical_record_addendums;
CREATE POLICY "License write guard insert" ON public.medical_record_addendums
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
        AND public.medsync_org_has_active_write_access(mr.organization_id)
    )
  );

-- --------------------------------------------------------------------
-- 6. PROVISIONAMENTO ATÔMICO NO SERVIDOR: TESTE GRATUITO DE 10 DIAS
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.medsync_provision_trial_organization(
  p_auth_user_id UUID,
  p_clinic_name TEXT,
  p_responsible_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_document_number TEXT DEFAULT NULL,
  p_requested_plan_code TEXT DEFAULT 'trial'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_email_hash TEXT;
  v_doc_digits TEXT;
  v_clean_clinic TEXT := trim(COALESCE(p_clinic_name, ''));
  v_clean_resp TEXT := trim(COALESCE(p_responsible_name, ''));
  v_clean_phone TEXT := trim(COALESCE(p_phone, ''));
  v_base_slug TEXT;
  v_final_slug TEXT;
  v_suffix INT := 0;
  v_trial_plan RECORD;
  v_org_id UUID;
  v_clinic_id UUID;
  v_branch_id UUID;
  v_profile_id UUID;
  v_now TIMESTAMPTZ := now();
  v_trial_ends_at TIMESTAMPTZ := now() + interval '10 days';
  v_existing_profile RECORD;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'TRIAL_AUTH_REQUIRED: Identificador de usuário obrigatório.';
  END IF;

  IF length(v_clean_clinic) < 2 OR length(v_clean_resp) < 2 OR length(v_clean_email) < 5 THEN
    RAISE EXCEPTION 'TRIAL_INVALID_INPUT: Informe nome da clínica, responsável e e-mail válido.';
  END IF;

  v_email_hash := encode(digest(v_clean_email, 'sha256'), 'hex');
  v_doc_digits := NULLIF(regexp_replace(COALESCE(p_document_number, ''), '\D', '', 'g'), '');

  -- Trava concorrente para garantir idempotência e evitar duplo trial
  PERFORM pg_advisory_xact_lock(hashtext('medsync_trial_' || v_email_hash));

  -- Se o usuário já possui perfil vinculado (idempotência / já existente)
  SELECT * INTO v_existing_profile
  FROM public.user_profiles
  WHERE user_id = p_auth_user_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'organization_id', v_existing_profile.organization_id,
      'profile_id', v_existing_profile.id
    );
  END IF;

  -- Impedir reinício de teste gratuito com o mesmo e-mail ou CNPJ/CPF
  IF EXISTS (SELECT 1 FROM public.saas_trial_claims WHERE email_hash = v_email_hash) THEN
    RAISE EXCEPTION 'TRIAL_ALREADY_CLAIMED: Este e-mail já utilizou o período de teste gratuito de 10 dias.';
  END IF;

  IF v_doc_digits IS NOT NULL AND length(v_doc_digits) >= 11 THEN
    IF EXISTS (SELECT 1 FROM public.saas_trial_claims WHERE document_digits = v_doc_digits) THEN
      RAISE EXCEPTION 'TRIAL_DOCUMENT_ALREADY_CLAIMED: Este CNPJ/CPF já utilizou o período de teste gratuito.';
    END IF;
  END IF;

  -- Buscar plano de teste ou fallback para plano inicial ativo
  SELECT * INTO v_trial_plan
  FROM public.plans
  WHERE code = 'trial' AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_trial_plan
    FROM public.plans
    WHERE is_active = true
    ORDER BY display_order ASC, price_monthly ASC
    LIMIT 1;
  END IF;

  -- Slug único sanitizado
  v_base_slug := regexp_replace(lower(v_clean_clinic), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' FROM v_base_slug);
  IF length(v_base_slug) < 3 THEN
    v_base_slug := 'clinica-medsync';
  END IF;
  v_base_slug := left(v_base_slug, 60);
  v_final_slug := v_base_slug;

  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_final_slug) LOOP
    v_suffix := v_suffix + 1;
    v_final_slug := left(v_base_slug, 52) || '-' || v_suffix::text;
  END LOOP;

  -- 1. Criar Organização com prazo calculado estritamente no servidor (10 dias corridos)
  INSERT INTO public.organizations (
    name, slug, plan_id, status, license_status, billing_cycle,
    responsible_name, contact_email, contact_phone,
    onboarding_completed, onboarding_progress,
    trial_started_at, trial_ends_at, subscription_renews_at, last_accessed_at
  )
  VALUES (
    v_clean_clinic,
    v_final_slug,
    v_trial_plan.id,
    'trial',
    'TESTE_ATIVO',
    'trial',
    v_clean_resp,
    v_clean_email,
    v_clean_phone,
    false,
    jsonb_build_object('completedSteps', jsonb_build_array(), 'skipped', false, 'currentStep', 1),
    v_now,
    v_trial_ends_at,
    v_trial_ends_at,
    v_now
  )
  RETURNING id INTO v_org_id;

  -- 2. Criar Clínica vinculada
  INSERT INTO public.clinics (
    organization_id, legal_name, trade_name, document_number,
    email, phone, whatsapp, institutional_bio
  )
  VALUES (
    v_org_id,
    v_clean_clinic,
    v_clean_clinic,
    COALESCE(NULLIF(trim(COALESCE(p_document_number, '')), ''), 'A informar'),
    v_clean_email,
    COALESCE(NULLIF(v_clean_phone, ''), 'A informar'),
    v_clean_phone,
    'Clínica configurada em período de avaliação gratuita no MedSync.'
  )
  RETURNING id INTO v_clinic_id;

  -- 3. Criar Unidade Matriz e Consultório padrão inicial
  INSERT INTO public.branches (
    organization_id, clinic_id, name, code, is_headquarters,
    phone, whatsapp, email, city, state, patient_sharing_mode, is_active
  )
  VALUES (
    v_org_id,
    v_clinic_id,
    'Unidade Matriz',
    'MATRIZ',
    true,
    COALESCE(NULLIF(v_clean_phone, ''), 'A informar'),
    v_clean_phone,
    v_clean_email,
    'A definir',
    'BR',
    'model_b',
    true
  )
  RETURNING id INTO v_branch_id;

  INSERT INTO public.rooms (organization_id, branch_id, name, description, color, is_active)
  VALUES (
    v_org_id,
    v_branch_id,
    'Consultório 01',
    'Sala inicial para atendimentos e agenda',
    '#0284c7',
    true
  );

  -- 4. Criar Perfil de Administrador da Clínica vinculado ao Auth UUID (nunca super_admin)
  INSERT INTO public.user_profiles (
    user_id, organization_id, default_branch_id, full_name, email, phone, role_code, is_active
  )
  VALUES (
    p_auth_user_id,
    v_org_id,
    v_branch_id,
    v_clean_resp,
    v_clean_email,
    v_clean_phone,
    'clinic_admin',
    true
  )
  RETURNING id INTO v_profile_id;

  INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
  VALUES (v_org_id, v_profile_id, v_branch_id, true)
  ON CONFLICT (user_profile_id, branch_id) DO NOTHING;

  -- 5. Registrar Assinatura Trial e Registro Anti-Abuso
  INSERT INTO public.saas_subscriptions (
    organization_id, plan_id, billing_cycle, license_status,
    started_at, trial_ends_at, current_period_start, current_period_end,
    next_due_date, unit_monthly_price, discount_percent, final_cycle_amount, payment_provider
  )
  VALUES (
    v_org_id,
    v_trial_plan.id,
    'trial',
    'TESTE_ATIVO',
    v_now,
    v_trial_ends_at,
    v_now,
    v_trial_ends_at,
    v_trial_ends_at,
    0.00,
    0.00,
    0.00,
    'none'
  );

  INSERT INTO public.saas_trial_claims (
    email_hash, document_digits, clinic_slug_norm, organization_id, claimed_at
  )
  VALUES (
    v_email_hash, v_doc_digits, v_final_slug, v_org_id, v_now
  );

  -- 6. Auditoria SaaS & Clínica
  INSERT INTO public.saas_audit_logs (
    actor_user_id, actor_profile_id, actor_email, actor_role,
    target_organization_id, action, entity, entity_id,
    reason, new_state
  )
  VALUES (
    p_auth_user_id,
    v_profile_id,
    v_clean_email,
    'clinic_admin',
    v_org_id,
    'activate_trial_10_days',
    'organizations',
    v_org_id::text,
    'Ativação automática de teste gratuito de 10 dias no servidor.',
    jsonb_build_object(
      'license_status', 'TESTE_ATIVO',
      'trial_started_at', v_now,
      'trial_ends_at', v_trial_ends_at,
      'requested_plan_code', p_requested_plan_code
    )
  );

  INSERT INTO public.audit_logs (
    organization_id, user_id, user_role, action, entity, entity_id, details
  )
  VALUES (
    v_org_id,
    p_auth_user_id,
    'clinic_admin',
    'trial_activated',
    'organizations',
    v_org_id,
    jsonb_build_object(
      'trial_ends_at', v_trial_ends_at,
      'clinic_name', v_clean_clinic,
      'responsible', v_clean_resp
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'organization_id', v_org_id,
    'clinic_id', v_clinic_id,
    'branch_id', v_branch_id,
    'profile_id', v_profile_id,
    'license_status', 'TESTE_ATIVO',
    'trial_started_at', v_now,
    'trial_ends_at', v_trial_ends_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_provision_trial_organization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_provision_trial_organization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
