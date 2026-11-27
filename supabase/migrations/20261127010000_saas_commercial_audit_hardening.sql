-- ============================================================================
-- MIGRAÇÃO CORRETIVA PRÉ-PUBLICAÇÃO: HARDENING DE SEGURANÇA, RLS, BACKFILL,
-- TRIAL E TRANSAÇÃO DE WEBHOOK DE PAGAMENTOS
-- MedSync SaaS (preserva integralmente a migration 20261127000000)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRESERVAÇÃO DOS ESTADOS LEGADOS DAS ORGANIZAÇÕES (ITEM 2 DA AUDITORIA)
-- ----------------------------------------------------------------------------
-- Corrige classificações que tenham caído no ELSE 'TESTE_ATIVO' na migration
-- anterior (ex.: 'cancelled', 'expired', 'trial' sem trial_ends_at, ou estados
-- antigos não reconhecidos). Preserva clientes ativos, suspensos, inadimplentes
-- e trials válidos existentes sem sobrescrever ajustes manuais (status_reason).

UPDATE public.organizations o
SET
  license_status = CASE
    WHEN lower(trim(COALESCE(o.status, ''))) = 'active' THEN 'ATIVA'
    WHEN lower(trim(COALESCE(o.status, ''))) IN ('cancelled', 'canceled') THEN 'CANCELADA'
    WHEN lower(trim(COALESCE(o.status, ''))) IN ('suspended', 'inactive', 'blocked', 'disabled') THEN 'SUSPENSA'
    WHEN lower(trim(COALESCE(o.status, ''))) IN ('overdue', 'past_due', 'delinquent') THEN 'INADIMPLENTE'
    WHEN lower(trim(COALESCE(o.status, ''))) IN ('pending', 'payment_pending', 'awaiting_payment') THEN 'PAGAMENTO_PENDENTE'
    WHEN lower(trim(COALESCE(o.status, ''))) = 'expired' THEN 'TESTE_EXPIRADO'
    WHEN lower(trim(COALESCE(o.status, ''))) = 'trial' THEN
      CASE
        WHEN o.trial_ends_at IS NOT NULL AND o.trial_ends_at > now() THEN 'TESTE_ATIVO'
        ELSE 'TESTE_EXPIRADO'
      END
    ELSE 'SUSPENSA'
  END,
  status_reason = CASE
    WHEN lower(trim(COALESCE(o.status, ''))) NOT IN (
      'active', 'trial', 'suspended', 'overdue', 'cancelled', 'canceled',
      'inactive', 'blocked', 'disabled', 'pending', 'payment_pending',
      'awaiting_payment', 'expired'
    )
      THEN COALESCE(
        o.status_reason,
        'Estado legado não reconhecido preservado em modo restrito até revisão administrativa.'
      )
    WHEN lower(trim(COALESCE(o.status, ''))) = 'trial' AND o.trial_ends_at IS NULL
      THEN COALESCE(o.status_reason, 'Trial legado sem prazo de expiração definido; mantido em modo leitura.')
    ELSE o.status_reason
  END,
  updated_at = now()
WHERE o.status_reason IS NULL
  AND (
    o.license_status IS NULL
    OR (
      o.license_status = 'TESTE_ATIVO'
      AND (
        lower(trim(COALESCE(o.status, ''))) <> 'trial'
        OR o.trial_ends_at IS NULL
        OR o.trial_ends_at <= now()
      )
    )
  );

-- Sincronizar saas_subscriptions criadas por backfill automático com o estado corrigido
UPDATE public.saas_subscriptions s
SET
  license_status = o.license_status,
  cancelled_at = CASE
    WHEN o.license_status = 'CANCELADA' THEN COALESCE(s.cancelled_at, now())
    ELSE s.cancelled_at
  END,
  updated_at = now()
FROM public.organizations o
WHERE s.organization_id = o.id
  AND s.updated_by IS NULL
  AND s.license_status IS DISTINCT FROM o.license_status;

-- ----------------------------------------------------------------------------
-- 2. HARDENING DE FUNÇÕES SQL & SECURITY DEFINER (ITEM 1 E ITEM 5 DA AUDITORIA)
-- ----------------------------------------------------------------------------

-- 2.1 Trigger function de auditoria imutável: SECURITY INVOKER + search_path fixo
CREATE OR REPLACE FUNCTION public.medsync_prevent_saas_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Trilha de auditoria SaaS é imutável (append-only).';
END;
$$;

-- 2.2 Cálculo canônico de preços: função matemática pura (sem SECURITY DEFINER) + search_path fixo
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

-- 2.3 Verificação de Super Admin SaaS: SECURITY DEFINER necessário para RLS sem recursão;
--     revogado de PUBLIC e anon, restrito a authenticated e service_role.
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

REVOKE ALL ON FUNCTION public.medsync_is_saas_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.medsync_is_saas_platform_admin() TO authenticated, service_role;

-- Separar política de leitura pública de public.plans para que anon nunca acione medsync_is_saas_platform_admin()
DROP POLICY IF EXISTS "Plans public read" ON public.plans;
DROP POLICY IF EXISTS "Plans super admin read" ON public.plans;

CREATE POLICY "Plans public read" ON public.plans
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Plans super admin read" ON public.plans
  FOR SELECT
  TO authenticated
  USING (public.medsync_is_saas_platform_admin());

-- 2.4 Verificação de licença ativa para escrita:
--     Corrige risco de oráculo cross-tenant exigindo vínculo do chamador à target_org_id
--     (exceto backend service_role / SECURITY DEFINER confiável), mantendo compatibility RLS.
CREATE OR REPLACE FUNCTION public.medsync_org_has_active_write_access(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_privileged_backend BOOLEAN;
BEGIN
  IF target_org_id IS NULL THEN
    RETURN false;
  END IF;

  v_is_privileged_backend := (
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin')
  );

  IF NOT v_is_privileged_backend THEN
    IF auth.uid() IS NULL THEN
      RETURN false;
    END IF;
    -- Impede que usuário autenticado de uma organização consulte status de outra
    IF NOT public.medsync_can_access_org(target_org_id) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = target_org_id
      AND (
        (
          COALESCE(
            o.license_status,
            CASE
              WHEN o.status = 'active' THEN 'ATIVA'
              WHEN o.status = 'trial' THEN 'TESTE_ATIVO'
              ELSE 'SUSPENSA'
            END
          ) = 'ATIVA'
          AND COALESCE(o.status, 'active') = 'active'
        )
        OR (
          COALESCE(
            o.license_status,
            CASE WHEN o.status = 'trial' THEN 'TESTE_ATIVO' ELSE '' END
          ) = 'TESTE_ATIVO'
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
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_org_has_active_write_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.medsync_org_has_active_write_access(UUID) TO authenticated, service_role;

-- 2.5 Garantir bloqueio também nas RPCs SECURITY DEFINER operacionais (Painel de Chamada e Agendamento Público)
CREATE OR REPLACE FUNCTION public.medsync_assert_call_panel_actor(
  p_org_id UUID,
  p_branch_id UUID
)
RETURNS public.user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.user_profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Autenticação obrigatória para operar o painel de chamada.';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
    AND up.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_INACTIVE: Perfil de usuário inválido ou inativo.';
  END IF;

  IF v_actor.organization_id <> p_org_id THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN: Operação negada para organização não autorizada.';
  END IF;

  IF NOT public.medsync_org_has_active_write_access(p_org_id) THEN
    RAISE EXCEPTION 'LICENSE_READ_ONLY: Período de avaliação encerrado ou licença bloqueada. Regularize a assinatura para continuar registrando atendimentos.';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT public.medsync_user_has_branch_access(p_org_id, p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_FORBIDDEN: Usuário sem acesso à unidade selecionada.';
  END IF;

  IF NOT (
    public.medsync_has_menu_permission('call_panel', 'create')
    OR public.medsync_has_menu_permission('call_panel', 'edit')
    OR public.medsync_has_menu_permission('call_panel', 'admin')
    OR public.medsync_has_menu_permission('appointments', 'edit')
  ) THEN
    RAISE EXCEPTION 'RBAC_DENIED: Perfil sem permissão para operar chamadas de atendimento.';
  END IF;

  RETURN v_actor;
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_assert_call_panel_actor(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.medsync_assert_call_panel_actor(UUID, UUID) TO authenticated, service_role;

-- Agendamento público também respeita validade da licença/trial da clínica
CREATE OR REPLACE FUNCTION public.medsync_public_book_appointment(
  p_org_slug TEXT,
  p_full_name TEXT,
  p_document_cpf TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_branch_id UUID;
  v_prof_id UUID;
  v_service_id UUID;
  v_patient_id UUID;
  v_appointment_id UUID;
  v_cpf_digits TEXT;
  v_formatted_cpf TEXT;
BEGIN
  v_cpf_digits := regexp_replace(COALESCE(p_document_cpf, ''), '[^0-9]', '', 'g');
  IF length(v_cpf_digits) <> 11 OR length(trim(COALESCE(p_full_name, ''))) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dados inválidos para agendamento.');
  END IF;

  v_formatted_cpf := substring(v_cpf_digits from 1 for 3) || '.' ||
                     substring(v_cpf_digits from 4 for 3) || '.' ||
                     substring(v_cpf_digits from 7 for 3) || '-' ||
                     substring(v_cpf_digits from 10 for 2);

  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.slug = COALESCE(NULLIF(trim(p_org_slug), ''), 'dr-newton-mureb')
    AND o.status IN ('active', 'trial')
  LIMIT 1;

  IF v_org_id IS NULL OR NOT public.medsync_org_has_active_write_access(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clínica indisponível para agendamento online no momento.');
  END IF;

  SELECT b.id INTO v_branch_id
  FROM public.branches b
  WHERE b.organization_id = v_org_id AND b.is_active = true
  ORDER BY b.is_headquarters DESC, b.created_at ASC
  LIMIT 1;

  SELECT pr.id INTO v_prof_id
  FROM public.professionals pr
  WHERE pr.organization_id = v_org_id AND pr.is_active = true
  ORDER BY pr.created_at ASC
  LIMIT 1;

  SELECT s.id INTO v_service_id
  FROM public.services s
  WHERE s.organization_id = v_org_id AND s.is_active = true
  ORDER BY s.created_at ASC
  LIMIT 1;

  IF v_branch_id IS NULL OR v_prof_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unidade ou profissional indisponível.');
  END IF;

  SELECT p.id INTO v_patient_id
  FROM public.patients p
  WHERE p.organization_id = v_org_id
    AND regexp_replace(p.document_cpf, '[^0-9]', '', 'g') = v_cpf_digits
  LIMIT 1;

  IF v_patient_id IS NULL THEN
    INSERT INTO public.patients (
      organization_id, origin_branch_id, full_name, document_cpf,
      phone, whatsapp, email, lgpd_consent, lgpd_consent_date, sharing_mode, administrative_notes
    )
    VALUES (
      v_org_id, v_branch_id, trim(p_full_name), v_formatted_cpf,
      trim(p_phone), trim(p_phone), NULLIF(trim(COALESCE(p_email, '')), ''),
      true, now(), 'model_b_shared', NULLIF(trim(COALESCE(p_notes, '')), '')
    )
    RETURNING id INTO v_patient_id;
  END IF;

  INSERT INTO public.appointments (
    organization_id, branch_id, patient_id, professional_id, service_id,
    start_time, end_time, status, appointment_type, notes
  )
  VALUES (
    v_org_id, v_branch_id, v_patient_id, v_prof_id, v_service_id,
    p_start_time, p_end_time, 'scheduled', 'presencial', p_notes
  )
  RETURNING id INTO v_appointment_id;

  RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
END;
$$;

-- 2.6 Reafirmar privilégio exclusivo de service_role para medsync_sync_expired_trials
REVOKE ALL ON FUNCTION public.medsync_sync_expired_trials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_sync_expired_trials() TO service_role;

-- 2.7 Hardening de medsync_provision_trial_organization (Item 5 da Auditoria):
--     - Remove fallback silencioso para plano pago caso o plano 'trial' não exista ou esteja inativo
--     - Trava concorrente dupla por email_hash E document_digits
--     - Valida duplicidade também em user_profiles dentro da transação
--     - Preserva regra estrita de 10 dias corridos no servidor e acesso exclusivo de service_role
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

  -- Travas transacionais contra chamadas simultâneas (e-mail e CPF/CNPJ)
  PERFORM pg_advisory_xact_lock(hashtext('medsync_trial_' || v_email_hash));
  IF v_doc_digits IS NOT NULL AND length(v_doc_digits) >= 11 THEN
    PERFORM pg_advisory_xact_lock(hashtext('medsync_trial_doc_' || v_doc_digits));
  END IF;

  -- Idempotência para o mesmo auth_user_id já provisionado
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

  -- Impedir reutilização por e-mail já cadastrado ou já contemplado com trial
  IF EXISTS (SELECT 1 FROM public.saas_trial_claims WHERE email_hash = v_email_hash) THEN
    RAISE EXCEPTION 'TRIAL_ALREADY_CLAIMED: Este e-mail já utilizou o período de teste gratuito de 10 dias.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE lower(email) = v_clean_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_REGISTERED: Já existe um cadastro vinculado a este endereço de e-mail.';
  END IF;

  IF v_doc_digits IS NOT NULL AND length(v_doc_digits) >= 11 THEN
    IF EXISTS (SELECT 1 FROM public.saas_trial_claims WHERE document_digits = v_doc_digits) THEN
      RAISE EXCEPTION 'TRIAL_DOCUMENT_ALREADY_CLAIMED: Este CNPJ/CPF já utilizou o período de teste gratuito.';
    END IF;
  END IF;

  -- Exige plano 'trial' ativo explícito (jamais atribui plano pago silenciosamente como fallback)
  SELECT * INTO v_trial_plan
  FROM public.plans
  WHERE code = 'trial' AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIAL_PLAN_UNAVAILABLE: O plano de teste gratuito (trial) não está cadastrado ou ativo no sistema.';
  END IF;

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

  -- 1. Criar Organização com 10 dias corridos calculados no servidor
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

  -- 3. Criar Unidade Matriz e Consultório inicial
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

  -- 4. Perfil inicial sempre restrito à clínica (nunca super_admin)
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

  -- 5. Assinatura trial e registro anti-abuso
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

  -- 6. Auditoria
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

-- ----------------------------------------------------------------------------
-- 3. POLÍTICAS RLS DE BLOQUEIO DE ESCRITA COMPLETO (INCLUINDO ADDENDUMS E FILHAS)
--    Preserva SELECT 100% intacto conforme regras clínicas existentes.
-- ----------------------------------------------------------------------------

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
    'financial_categories',
    'branches',
    'rooms',
    'professionals',
    'services',
    'specialties',
    'attendance_calls',
    'call_panel_settings',
    'lab_exam_catalog',
    'patient_branch_access',
    'professional_branches'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_org_tables LOOP
    -- Confirma explicitamente que a tabela e a coluna organization_id existem antes de aplicar a política
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_tbl
        AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_tbl);
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

-- medical_record_addendums: valida organização proprietária via vínculo com medical_records
-- em INSERT, UPDATE e DELETE (preserva SELECT clínico e trigger de imutabilidade CFM)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'medical_record_addendums' AND column_name = 'record_id'
  ) THEN
    ALTER TABLE public.medical_record_addendums ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "License write guard insert" ON public.medical_record_addendums;
    DROP POLICY IF EXISTS "License write guard update" ON public.medical_record_addendums;
    DROP POLICY IF EXISTS "License write guard delete" ON public.medical_record_addendums;

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

    CREATE POLICY "License write guard update" ON public.medical_record_addendums
      AS RESTRICTIVE
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.medical_records mr
          WHERE mr.id = record_id
            AND public.medsync_org_has_active_write_access(mr.organization_id)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.medical_records mr
          WHERE mr.id = record_id
            AND public.medsync_org_has_active_write_access(mr.organization_id)
        )
      );

    CREATE POLICY "License write guard delete" ON public.medical_record_addendums
      AS RESTRICTIVE
      FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM public.medical_records mr
          WHERE mr.id = record_id
            AND public.medsync_org_has_active_write_access(mr.organization_id)
        )
      );
  END IF;
END;
$$;

-- Tabelas filhas clínicas sem organization_id próprio: vínculo via tabela pai
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescription_items' AND column_name = 'prescription_id'
  ) THEN
    ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "License write guard insert" ON public.prescription_items;
    DROP POLICY IF EXISTS "License write guard update" ON public.prescription_items;
    DROP POLICY IF EXISTS "License write guard delete" ON public.prescription_items;

    CREATE POLICY "License write guard insert" ON public.prescription_items
      AS RESTRICTIVE FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.prescriptions p
          WHERE p.id = prescription_id
            AND public.medsync_org_has_active_write_access(p.organization_id)
        )
      );

    CREATE POLICY "License write guard update" ON public.prescription_items
      AS RESTRICTIVE FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.prescriptions p
          WHERE p.id = prescription_id
            AND public.medsync_org_has_active_write_access(p.organization_id)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.prescriptions p
          WHERE p.id = prescription_id
            AND public.medsync_org_has_active_write_access(p.organization_id)
        )
      );

    CREATE POLICY "License write guard delete" ON public.prescription_items
      AS RESTRICTIVE FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM public.prescriptions p
          WHERE p.id = prescription_id
            AND public.medsync_org_has_active_write_access(p.organization_id)
        )
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lab_order_items' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.lab_order_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "License write guard insert" ON public.lab_order_items;
    DROP POLICY IF EXISTS "License write guard update" ON public.lab_order_items;
    DROP POLICY IF EXISTS "License write guard delete" ON public.lab_order_items;

    CREATE POLICY "License write guard insert" ON public.lab_order_items
      AS RESTRICTIVE FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.lab_orders lo
          WHERE lo.id = order_id
            AND public.medsync_org_has_active_write_access(lo.organization_id)
        )
      );

    CREATE POLICY "License write guard update" ON public.lab_order_items
      AS RESTRICTIVE FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.lab_orders lo
          WHERE lo.id = order_id
            AND public.medsync_org_has_active_write_access(lo.organization_id)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.lab_orders lo
          WHERE lo.id = order_id
            AND public.medsync_org_has_active_write_access(lo.organization_id)
        )
      );

    CREATE POLICY "License write guard delete" ON public.lab_order_items
      AS RESTRICTIVE FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM public.lab_orders lo
          WHERE lo.id = order_id
            AND public.medsync_org_has_active_write_access(lo.organization_id)
        )
      );
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. PROCESSAMENTO TRANSACIONAL ATÔMICO DE WEBHOOK DE PAGAMENTO (ITEM 4)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.medsync_process_payment_webhook_event(
  p_provider TEXT,
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_reference_code TEXT,
  p_external_order_id TEXT,
  p_paid_amount NUMERIC,
  p_currency TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT := lower(trim(COALESCE(p_provider, 'kiwify')));
  v_event_id TEXT := trim(COALESCE(p_provider_event_id, ''));
  v_event_type TEXT := lower(trim(COALESCE(p_event_type, '')));
  v_ref TEXT := trim(COALESCE(p_reference_code, ''));
  v_order_id TEXT := trim(COALESCE(p_external_order_id, ''));
  v_currency TEXT := upper(trim(COALESCE(p_currency, '')));
  v_now TIMESTAMPTZ := now();
  v_existing_event RECORD;
  v_invoice RECORD;
  v_plan RECORD;
  v_org RECORD;
  v_next_renewal TIMESTAMPTZ;
  v_months INT := 1;
  v_expected_final NUMERIC := 0.00;
  v_event_row_id UUID;
BEGIN
  IF v_event_id = '' OR v_event_type = '' THEN
    RAISE EXCEPTION 'WEBHOOK_INVALID_EVENT: Identificador e tipo do evento são obrigatórios.';
  END IF;

  IF v_ref = '' AND v_order_id = '' THEN
    RAISE EXCEPTION 'WEBHOOK_MISSING_REFERENCE: reference_code ou order_id obrigatório.';
  END IF;

  -- Trava concorrente por evento de provedor para evitar condição de corrida
  PERFORM pg_advisory_xact_lock(hashtext('webhook_evt:' || v_provider || ':' || v_event_id));

  SELECT id, processing_status
  INTO v_existing_event
  FROM public.saas_payment_webhook_events
  WHERE provider = v_provider
    AND provider_event_id = v_event_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'event_id', v_existing_event.id,
      'status', v_existing_event.processing_status
    );
  END IF;

  -- Localizar fatura com row lock para atualização atômica
  IF v_ref <> '' THEN
    SELECT * INTO v_invoice
    FROM public.saas_invoices
    WHERE reference_code = v_ref
    FOR UPDATE;
  END IF;

  IF NOT FOUND AND v_order_id <> '' THEN
    SELECT * INTO v_invoice
    FROM public.saas_invoices
    WHERE external_order_id = v_order_id
    FOR UPDATE;
  END IF;

  INSERT INTO public.saas_payment_webhook_events (
    provider, provider_event_id, event_type, signature_valid,
    processing_status, organization_id, invoice_id, payload
  )
  VALUES (
    v_provider,
    v_event_id,
    v_event_type,
    true,
    'received',
    CASE WHEN v_invoice.id IS NOT NULL THEN v_invoice.organization_id ELSE NULL END,
    v_invoice.id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_event_row_id;

  IF v_invoice.id IS NULL THEN
    UPDATE public.saas_payment_webhook_events
    SET
      processing_status = 'ignored',
      error_message = 'Cobrança não localizada para reference_code/order_id informado.',
      processed_at = v_now
    WHERE id = v_event_row_id;

    RETURN jsonb_build_object(
      'success', true,
      'ignored', true,
      'reason', 'invoice_not_found',
      'event_id', v_event_row_id
    );
  END IF;

  -- Bloquear qualquer tentativa se organização, plano ou ciclo estiverem ausentes/inválidos
  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = v_invoice.organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.saas_payment_webhook_events
    SET processing_status = 'rejected', error_message = 'ORG_NOT_FOUND', processed_at = v_now
    WHERE id = v_event_row_id;
    RETURN jsonb_build_object('success', false, 'code', 'ORG_NOT_FOUND', 'error', 'Organização vinculada não encontrada.');
  END IF;

  IF v_invoice.plan_id IS NULL OR v_invoice.billing_cycle NOT IN ('monthly', 'quarterly', 'yearly') THEN
    UPDATE public.saas_payment_webhook_events
    SET processing_status = 'rejected', error_message = 'INVALID_PLAN_OR_CYCLE', processed_at = v_now
    WHERE id = v_event_row_id;
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_PLAN_OR_CYCLE', 'error', 'Plano ou ciclo da cobrança inválido.');
  END IF;

  SELECT * INTO v_plan
  FROM public.plans
  WHERE id = v_invoice.plan_id;

  IF NOT FOUND THEN
    UPDATE public.saas_payment_webhook_events
    SET processing_status = 'rejected', error_message = 'PLAN_NOT_FOUND', processed_at = v_now
    WHERE id = v_event_row_id;
    RETURN jsonb_build_object('success', false, 'code', 'PLAN_NOT_FOUND', 'error', 'Plano da cobrança não localizado.');
  END IF;

  -- Eventos de aprovação de pagamento
  IF v_event_type IN ('order_approved', 'subscription_renewed', 'paid', 'approved') THEN
    IF v_order_id = '' THEN
      UPDATE public.saas_payment_webhook_events
      SET processing_status = 'rejected', error_message = 'MISSING_ORDER_ID', processed_at = v_now
      WHERE id = v_event_row_id;
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ORDER_ID', 'error', 'Identificador do pedido (order_id) obrigatório.');
    END IF;

    IF v_invoice.status NOT IN ('pending', 'overdue') THEN
      UPDATE public.saas_payment_webhook_events
      SET
        processing_status = 'ignored',
        error_message = 'INVOICE_NOT_PAYABLE_STATUS:' || v_invoice.status,
        processed_at = v_now
      WHERE id = v_event_row_id;
      RETURN jsonb_build_object(
        'success', true,
        'ignored', true,
        'reason', 'invoice_not_payable_status',
        'invoice_status', v_invoice.status
      );
    END IF;

    IF v_currency <> upper(COALESCE(v_invoice.currency, 'BRL')) THEN
      UPDATE public.saas_payment_webhook_events
      SET
        processing_status = 'rejected',
        error_message = format('CURRENCY_MISMATCH: esperado %s, recebido %s', COALESCE(v_invoice.currency, 'BRL'), v_currency),
        processed_at = v_now
      WHERE id = v_event_row_id;
      RETURN jsonb_build_object('success', false, 'code', 'CURRENCY_MISMATCH', 'error', 'Moeda divergente da cobrança.');
    END IF;

    SELECT pcalc.final_amount INTO v_expected_final
    FROM public.medsync_compute_plan_pricing(
      v_plan.price_monthly,
      v_plan.quarterly_discount_percent,
      v_plan.yearly_discount_percent,
      v_invoice.billing_cycle
    ) pcalc;

    IF p_paid_amount IS NULL
       OR p_paid_amount <= 0
       OR abs(p_paid_amount - v_invoice.final_amount) > 0.01
       OR abs(v_invoice.final_amount - v_expected_final) > 0.01 THEN
      UPDATE public.saas_payment_webhook_events
      SET
        processing_status = 'rejected',
        error_message = format(
          'AMOUNT_MISMATCH: pago=%s, fatura=%s, tabela_plano=%s',
          COALESCE(p_paid_amount::text, 'null'),
          v_invoice.final_amount::text,
          v_expected_final::text
        ),
        processed_at = v_now
      WHERE id = v_event_row_id;

      INSERT INTO public.saas_audit_logs (
        actor_role, target_organization_id, action, entity, entity_id, reason, new_state
      )
      VALUES (
        'webhook:' || v_provider,
        v_org.id,
        'payment_webhook_amount_mismatch',
        'saas_invoices',
        v_invoice.id::text,
        'Ativação bloqueada por divergência entre valor pago e cobrança.',
        jsonb_build_object('paid_amount', p_paid_amount, 'invoice_amount', v_invoice.final_amount, 'plan_amount', v_expected_final)
      );

      RETURN jsonb_build_object('success', false, 'code', 'AMOUNT_MISMATCH', 'error', 'Valor pago divergente do valor esperado na cobrança.');
    END IF;

    v_months := CASE v_invoice.billing_cycle WHEN 'yearly' THEN 12 WHEN 'quarterly' THEN 3 ELSE 1 END;
    v_next_renewal := v_now + make_interval(months => v_months);

    UPDATE public.saas_invoices
    SET
      status = 'paid',
      payment_provider = v_provider,
      external_order_id = COALESCE(NULLIF(v_order_id, ''), external_order_id),
      paid_at = v_now,
      updated_at = v_now
    WHERE id = v_invoice.id;

    UPDATE public.organizations
    SET
      plan_id = v_invoice.plan_id,
      billing_cycle = v_invoice.billing_cycle,
      license_status = 'ATIVA',
      status = 'active',
      subscription_renews_at = v_next_renewal,
      status_reason = format('Pagamento aprovado via webhook (%s: %s).', v_provider, v_event_id),
      updated_at = v_now
    WHERE id = v_org.id;

    INSERT INTO public.saas_subscriptions (
      organization_id, plan_id, billing_cycle, license_status,
      current_period_start, current_period_end, next_due_date,
      unit_monthly_price, discount_percent, final_cycle_amount,
      payment_provider, updated_at
    )
    VALUES (
      v_org.id, v_invoice.plan_id, v_invoice.billing_cycle, 'ATIVA',
      v_now, v_next_renewal, v_next_renewal,
      v_plan.price_monthly, v_invoice.discount_percent, v_invoice.final_amount,
      v_provider, v_now
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      billing_cycle = EXCLUDED.billing_cycle,
      license_status = 'ATIVA',
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      next_due_date = EXCLUDED.next_due_date,
      unit_monthly_price = EXCLUDED.unit_monthly_price,
      discount_percent = EXCLUDED.discount_percent,
      final_cycle_amount = EXCLUDED.final_cycle_amount,
      payment_provider = EXCLUDED.payment_provider,
      cancelled_at = NULL,
      cancellation_reason = NULL,
      updated_at = v_now;

    INSERT INTO public.saas_audit_logs (
      actor_role, target_organization_id, action, entity, entity_id, reason, new_state
    )
    VALUES (
      'webhook:' || v_provider,
      v_org.id,
      'payment_confirmed_webhook',
      'saas_invoices',
      v_invoice.id::text,
      format('Webhook %s (%s)', v_event_type, v_event_id),
      jsonb_build_object(
        'license_status', 'ATIVA',
        'subscription_renews_at', v_next_renewal,
        'paid_amount', p_paid_amount,
        'currency', v_currency,
        'order_id', v_order_id
      )
    );

  ELSIF v_event_type IN ('subscription_overdue', 'payment_late', 'overdue') THEN
    UPDATE public.saas_invoices
    SET status = 'overdue', updated_at = v_now
    WHERE id = v_invoice.id AND status IN ('pending', 'overdue');

    UPDATE public.organizations
    SET
      license_status = 'INADIMPLENTE',
      status = 'overdue',
      status_reason = format('Inadimplência sinalizada via webhook (%s).', v_provider),
      updated_at = v_now
    WHERE id = v_org.id;

    UPDATE public.saas_subscriptions
    SET license_status = 'INADIMPLENTE', updated_at = v_now
    WHERE organization_id = v_org.id;

  ELSIF v_event_type IN ('subscription_canceled', 'order_refunded', 'chargedback', 'refunded') THEN
    UPDATE public.saas_invoices
    SET
      status = CASE WHEN v_event_type LIKE '%refund%' OR v_event_type LIKE '%chargeback%' THEN 'refunded' ELSE 'cancelled' END,
      updated_at = v_now
    WHERE id = v_invoice.id;

    UPDATE public.organizations
    SET
      license_status = CASE WHEN v_event_type = 'subscription_canceled' THEN 'CANCELADA' ELSE 'SUSPENSA' END,
      status = 'suspended',
      status_reason = format('Evento %s via webhook (%s).', v_event_type, v_provider),
      updated_at = v_now
    WHERE id = v_org.id;

    UPDATE public.saas_subscriptions
    SET
      license_status = CASE WHEN v_event_type = 'subscription_canceled' THEN 'CANCELADA' ELSE 'SUSPENSA' END,
      cancelled_at = v_now,
      updated_at = v_now
    WHERE organization_id = v_org.id;
  ELSE
    UPDATE public.saas_payment_webhook_events
    SET
      processing_status = 'ignored',
      error_message = 'UNHANDLED_EVENT_TYPE:' || v_event_type,
      processed_at = v_now
    WHERE id = v_event_row_id;

    RETURN jsonb_build_object('success', true, 'ignored', true, 'reason', 'unhandled_event_type', 'event_id', v_event_row_id);
  END IF;

  UPDATE public.saas_payment_webhook_events
  SET processing_status = 'processed', processed_at = v_now
  WHERE id = v_event_row_id;

  RETURN jsonb_build_object(
    'success', true,
    'processed', true,
    'event_id', v_event_row_id,
    'invoice_id', v_invoice.id,
    'organization_id', v_org.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_process_payment_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_process_payment_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB) TO service_role;
