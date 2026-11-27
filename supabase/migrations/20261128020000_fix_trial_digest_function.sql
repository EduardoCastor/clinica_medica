-- ====================================================================
-- MIGRAÇÃO CORRETIVA: FUNÇÃO DIGEST() E EXTENSÃO PGCRYPTO NO PROVISIONAMENTO DE TRIAL
-- Corrige o erro: "function digest(text, unknown) does not exist"
--
-- Causas corrigidas:
-- 1. A função digest() da pgcrypto requer conversão explícita de text para bytea via convert_to(..., 'UTF8').
-- 2. Garantia de que o search_path inclua o schema de extensões (public, extensions).
-- 3. Verificação e ativação idempotente da extensão pgcrypto.
-- ====================================================================

-- Garantir extensão pgcrypto disponível
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------
-- CORREÇÃO DA FUNÇÃO medsync_provision_trial_organization
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
SET search_path = public, extensions
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

  -- Correção crítica: convert_to(text, 'UTF8') fornece bytea para digest(bytea, text)
  v_email_hash := encode(digest(convert_to(v_clean_email, 'UTF8'), 'sha256'), 'hex');
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
