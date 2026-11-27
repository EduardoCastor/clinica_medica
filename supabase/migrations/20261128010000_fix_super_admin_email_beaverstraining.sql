-- ====================================================================
-- MIGRAÇÃO CORRETIVA: E-MAIL OFICIAL DO SUPER ADMINISTRADOR SAAS
-- Corrige o endereço de Super Administrador da plataforma de:
--   beaverstraining@gmail.com.br (incorreto)
-- para:
--   beaverstraining@gmail.com (correto)
--
-- Regras obrigatórias:
-- - Não modificar migrations antigas já aplicadas.
-- - Não alterar auth.users diretamente via SQL.
-- - Não excluir contas existentes automaticamente sem auditoria prévia.
-- - Preservar integralmente admin@drnewtonmureb.com.br como clinic_admin.
-- - Nunca conceder privilégio administrativo apenas pelo e-mail.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. ATUALIZAR medsync_get_bootstrap_status() PARA O E-MAIL CORRETO
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.medsync_get_bootstrap_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_has_clinic_admin BOOLEAN := false;
  v_has_platform_super_admin BOOLEAN := false;
  v_has_pending_platform_super_admin BOOLEAN := false;
BEGIN
  v_org_id := public.medsync_resolve_newton_mureb_org_id();

  IF v_org_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.organization_id = v_org_id
        AND up.role_code IN ('clinic_admin', 'super_admin')
        AND up.is_active = true
    ) INTO v_has_clinic_admin;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.saas_platform_admins spa
    JOIN public.user_profiles up ON up.user_id = spa.user_id
    WHERE lower(spa.email) = 'beaverstraining@gmail.com'
      AND spa.is_active = true
      AND spa.status = 'active'
      AND up.is_active = true
      AND up.role_code = 'super_admin'
  ) INTO v_has_platform_super_admin;

  SELECT EXISTS (
    SELECT 1
    FROM public.saas_platform_admins spa
    WHERE lower(spa.email) = 'beaverstraining@gmail.com'
      AND spa.status = 'pending_activation'
  ) INTO v_has_pending_platform_super_admin;

  RETURN jsonb_build_object(
    'organization_found', (v_org_id IS NOT NULL),
    'needs_bootstrap', (v_org_id IS NOT NULL AND NOT v_has_clinic_admin),
    'already_initialized', v_has_clinic_admin,
    'organization_name', 'Clínica Dr Newton Mureb',
    'platform_initialized', v_has_platform_super_admin,
    'platform_needs_activation', (NOT v_has_platform_super_admin AND v_has_pending_platform_super_admin)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_get_bootstrap_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.medsync_get_bootstrap_status() TO anon, authenticated, service_role;

-- --------------------------------------------------------------------
-- 2. GARANTIR AUTORIZAÇÃO SERVER-SIDE ESTRITA POR UUID + PAPEL + STATUS
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.medsync_is_saas_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.is_active = true
        AND up.role_code = 'super_admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.saas_platform_admins spa
      WHERE spa.user_id = auth.uid()
        AND spa.is_active = true
        AND spa.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.medsync_is_saas_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.medsync_is_saas_platform_admin() TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 3. ATUALIZAR RPC DE TRANSFERÊNCIA PARA beaverstraining@gmail.com
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.medsync_finalize_platform_super_admin_transfer(
  p_auth_user_id UUID,
  p_auth_email TEXT,
  p_full_name TEXT DEFAULT 'Beaver Soluções em Tecnologia',
  p_email_confirmed_at TIMESTAMPTZ DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_email CONSTANT TEXT := 'beaverstraining@gmail.com';
  v_legacy_email CONSTANT TEXT := 'admin@drnewtonmureb.com.br';
  v_clean_email TEXT;
  v_clean_name TEXT;
  v_existing_profile RECORD;
  v_existing_email_profile RECORD;
  v_new_profile_id UUID;
  v_platform_admin_id UUID;
  v_demoted_profiles JSONB := '[]'::jsonb;
  v_demoted_rec RECORD;
  v_newton_org_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('medsync_platform_super_admin_transfer'));

  v_clean_email := lower(trim(COALESCE(p_auth_email, '')));
  v_clean_name := trim(COALESCE(p_full_name, ''));
  IF length(v_clean_name) < 3 THEN
    v_clean_name := 'Beaver Soluções em Tecnologia';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_USER: ID do usuário autenticado é obrigatório.';
  END IF;

  IF v_clean_email <> v_target_email THEN
    RAISE EXCEPTION 'TRANSFER_FORBIDDEN_EMAIL: Apenas % é autorizado como Super Administrador SaaS.', v_target_email;
  END IF;

  IF p_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_EMAIL_UNCONFIRMED: A conta % precisa confirmar o e-mail antes de assumir o papel Super Admin.', v_target_email;
  END IF;

  -- 1. Garantir perfil do novo Super Admin (organization_id = NULL, nunca vinculado a clínica cliente)
  SELECT *
  INTO v_existing_profile
  FROM public.user_profiles up
  WHERE up.user_id = p_auth_user_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.user_profiles
    SET
      email = v_target_email,
      full_name = CASE WHEN length(trim(COALESCE(full_name, ''))) >= 3 THEN full_name ELSE v_clean_name END,
      role_code = 'super_admin',
      is_active = true,
      updated_at = now()
    WHERE id = v_existing_profile.id
    RETURNING id INTO v_new_profile_id;
  ELSE
    SELECT *
    INTO v_existing_email_profile
    FROM public.user_profiles up
    WHERE lower(up.email) = v_target_email
      AND up.user_id IS NULL
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.user_profiles
      SET
        user_id = p_auth_user_id,
        full_name = CASE WHEN length(trim(COALESCE(full_name, ''))) >= 3 THEN full_name ELSE v_clean_name END,
        role_code = 'super_admin',
        is_active = true,
        updated_at = now()
      WHERE id = v_existing_email_profile.id
      RETURNING id INTO v_new_profile_id;
    ELSE
      INSERT INTO public.user_profiles (
        user_id, organization_id, default_branch_id, full_name, email, role_code, is_active
      )
      VALUES (
        p_auth_user_id, NULL, NULL, v_clean_name, v_target_email, 'super_admin', true
      )
      RETURNING id INTO v_new_profile_id;
    END IF;
  END IF;

  -- 2. Ativar o registro autoritativo em saas_platform_admins
  INSERT INTO public.saas_platform_admins (
    user_id, user_profile_id, email, full_name, is_active, status,
    promoted_from_email, activated_at, revoked_at
  )
  VALUES (
    p_auth_user_id, v_new_profile_id, v_target_email, v_clean_name, true, 'active',
    v_legacy_email, now(), NULL
  )
  ON CONFLICT (email) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    user_profile_id = EXCLUDED.user_profile_id,
    full_name = EXCLUDED.full_name,
    is_active = true,
    status = 'active',
    activated_at = COALESCE(public.saas_platform_admins.activated_at, now()),
    revoked_at = NULL,
    updated_at = now()
  RETURNING id INTO v_platform_admin_id;

  -- Verificação explícita antes de revogar entradas anteriores
  IF NOT EXISTS (
    SELECT 1
    FROM public.saas_platform_admins spa
    JOIN public.user_profiles up ON up.id = spa.user_profile_id
    WHERE spa.id = v_platform_admin_id
      AND spa.user_id = p_auth_user_id
      AND spa.is_active = true
      AND spa.status = 'active'
      AND up.is_active = true
      AND up.role_code = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'TRANSFER_VALIDATION_FAILED: Falha na validação do novo Super Admin antes da revogação anterior.';
  END IF;

  -- 3. Garantir que admin@drnewtonmureb.com.br permaneça como clinic_admin da Clínica Dr. Newton Mureb
  v_newton_org_id := public.medsync_resolve_newton_mureb_org_id();

  FOR v_demoted_rec IN
    SELECT up.id, up.user_id, up.organization_id, up.email, up.role_code, up.is_active
    FROM public.user_profiles up
    WHERE up.role_code = 'super_admin'
      AND up.user_id IS DISTINCT FROM p_auth_user_id
      AND (
        lower(up.email) = v_legacy_email
        OR (v_newton_org_id IS NOT NULL AND up.organization_id = v_newton_org_id)
      )
  LOOP
    IF v_demoted_rec.organization_id IS NOT NULL THEN
      UPDATE public.user_profiles
      SET
        role_code = 'clinic_admin',
        updated_at = now()
      WHERE id = v_demoted_rec.id;

      v_demoted_profiles := v_demoted_profiles || jsonb_build_array(
        jsonb_build_object(
          'profile_id', v_demoted_rec.id,
          'user_id', v_demoted_rec.user_id,
          'organization_id', v_demoted_rec.organization_id,
          'email', v_demoted_rec.email,
          'previous_role', v_demoted_rec.role_code,
          'new_role', 'clinic_admin'
        )
      );
    END IF;
  END LOOP;

  -- Revogar qualquer outra entrada de plataforma diferente do e-mail oficial corrigido
  UPDATE public.saas_platform_admins
  SET
    is_active = false,
    status = 'revoked',
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
  WHERE lower(email) <> v_target_email
    AND (is_active = true OR status <> 'revoked');

  -- 4. Registrar trilha imutável de auditoria administrativa
  INSERT INTO public.saas_audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    action,
    entity,
    entity_id,
    reason,
    previous_state,
    new_state
  )
  VALUES (
    COALESCE(p_actor_user_id, p_auth_user_id),
    COALESCE((SELECT au.email FROM auth.users au WHERE au.id = COALESCE(p_actor_user_id, p_auth_user_id)), 'system_migration'),
    'super_admin',
    'transfer_platform_super_admin',
    'saas_platform_admins',
    v_platform_admin_id::text,
    'Ativação do Super Administrador oficial beaverstraining@gmail.com preservando admin@drnewtonmureb.com.br na Clínica Dr. Newton Mureb.',
    jsonb_build_object(
      'previous_super_admin_email', v_legacy_email,
      'demoted_clinic_profiles', v_demoted_profiles
    ),
    jsonb_build_object(
      'new_super_admin_email', v_target_email,
      'new_auth_user_id', p_auth_user_id,
      'new_profile_id', v_new_profile_id,
      'clinic_admin_email_preserved', v_legacy_email,
      'executed_at', now(),
      'result', 'transferred'
    )
  );

  IF v_newton_org_id IS NOT NULL AND jsonb_array_length(v_demoted_profiles) > 0 THEN
    INSERT INTO public.audit_logs (
      organization_id, user_id, user_role, action, entity, details
    )
    VALUES (
      v_newton_org_id,
      COALESCE(p_actor_user_id, p_auth_user_id),
      'clinic_admin',
      'identity_separation_clinic_admin_preserved',
      'user_profiles',
      jsonb_build_object(
        'clinic_admin_email', v_legacy_email,
        'platform_super_admin_email', v_target_email,
        'demoted_profiles', v_demoted_profiles,
        'executed_at', now()
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'transferred',
    'platform_admin_id', v_platform_admin_id,
    'new_profile_id', v_new_profile_id,
    'new_auth_user_id', p_auth_user_id,
    'new_email', v_target_email,
    'demoted_profiles', v_demoted_profiles
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_finalize_platform_super_admin_transfer(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_finalize_platform_super_admin_transfer(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID) TO service_role;

-- --------------------------------------------------------------------
-- 4. AUDITORIA NÃO DESTRUTIVA DO ENDEREÇO INCORRETO & PROVISIONAMENTO SEGURO
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_correct_email CONSTANT TEXT := 'beaverstraining@gmail.com';
  v_typo_email CONSTANT TEXT := 'beaverstraining@gmail.com.br';
  v_legacy_email CONSTANT TEXT := 'admin@drnewtonmureb.com.br';
  v_correct_auth RECORD;
  v_typo_auth RECORD;
  v_typo_profile_count INTEGER := 0;
  v_old_super RECORD;
  v_transfer_res JSONB;
BEGIN
  -- Auditar eventuais registros da conta incorreta (sem excluir nem alterar auth.users via SQL)
  SELECT id, email, email_confirmed_at
  INTO v_typo_auth
  FROM auth.users
  WHERE lower(email) = v_typo_email
  LIMIT 1;

  SELECT count(*)
  INTO v_typo_profile_count
  FROM public.user_profiles
  WHERE lower(email) = v_typo_email;

  -- Revogar apenas a permissão de plataforma associada ao e-mail incorreto (preservando histórico)
  UPDATE public.saas_platform_admins
  SET
    is_active = false,
    status = 'revoked',
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
  WHERE lower(email) = v_typo_email
    AND (is_active = true OR status <> 'revoked');

  -- Auditar a conta correta no Supabase Auth
  SELECT id, email, email_confirmed_at, raw_user_meta_data
  INTO v_correct_auth
  FROM auth.users
  WHERE lower(email) = v_correct_email
  LIMIT 1;

  IF FOUND AND v_correct_auth.email_confirmed_at IS NOT NULL THEN
    -- CENÁRIO A: A conta correta beaverstraining@gmail.com já existe e está confirmada
    v_transfer_res := public.medsync_finalize_platform_super_admin_transfer(
      v_correct_auth.id,
      v_correct_email,
      COALESCE(NULLIF(trim(v_correct_auth.raw_user_meta_data->>'full_name'), ''), 'Beaver Soluções em Tecnologia'),
      v_correct_auth.email_confirmed_at,
      v_correct_auth.id
    );
  ELSE
    -- CENÁRIO B: Preparar beaverstraining@gmail.com como pending_activation sem lockout intermediário
    INSERT INTO public.saas_platform_admins (
      user_id, email, full_name, is_active, status, promoted_from_email
    )
    VALUES (
      v_correct_auth.id,
      v_correct_email,
      'Beaver Soluções em Tecnologia',
      false,
      'pending_activation',
      v_legacy_email
    )
    ON CONFLICT (email) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, public.saas_platform_admins.user_id),
      status = CASE
        WHEN public.saas_platform_admins.status = 'active' AND public.saas_platform_admins.is_active = true THEN 'active'
        ELSE 'pending_activation'
      END,
      updated_at = now();

    -- Garantir continuidade caso ainda exista super_admin provisório ativo diferente do e-mail incorreto
    SELECT up.id, up.user_id, up.email, up.full_name
    INTO v_old_super
    FROM public.user_profiles up
    WHERE up.role_code = 'super_admin'
      AND up.is_active = true
      AND lower(up.email) NOT IN (v_correct_email, v_typo_email)
    ORDER BY up.created_at ASC
    LIMIT 1;

    IF FOUND AND v_old_super.user_id IS NOT NULL THEN
      INSERT INTO public.saas_platform_admins (
        user_id, user_profile_id, email, full_name, is_active, status, activated_at
      )
      VALUES (
        v_old_super.user_id,
        v_old_super.id,
        lower(trim(v_old_super.email)),
        v_old_super.full_name,
        true,
        'active',
        now()
      )
      ON CONFLICT (email) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        user_profile_id = EXCLUDED.user_profile_id,
        is_active = true,
        status = 'active',
        updated_at = now();
    END IF;
  END IF;

  INSERT INTO public.saas_audit_logs (
    actor_email, actor_role, action, entity, reason, previous_state, new_state
  )
  VALUES (
    'system_migration',
    'system',
    'super_admin_email_corrected',
    'saas_platform_admins',
    'Correção do e-mail do Super Administrador SaaS para beaverstraining@gmail.com sem exclusão automática de contas nem alteração direta de auth.users.',
    jsonb_build_object(
      'typo_email', v_typo_email,
      'typo_auth_exists', (v_typo_auth.id IS NOT NULL),
      'typo_auth_user_id', v_typo_auth.id,
      'typo_profile_count', v_typo_profile_count
    ),
    jsonb_build_object(
      'correct_email', v_correct_email,
      'correct_auth_exists', (v_correct_auth.id IS NOT NULL),
      'correct_auth_user_id', v_correct_auth.id,
      'correct_email_confirmed', (v_correct_auth.email_confirmed_at IS NOT NULL),
      'clinic_admin_preserved', v_legacy_email
    )
  );
END;
$$;
