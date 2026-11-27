-- ====================================================================
-- MIGRAÇÃO: SEPARAÇÃO DE IDENTIDADES E TRANSFERÊNCIA DO SUPER ADMIN SAAS
-- MedSync SaaS:
--   - Plataforma SaaS (Super Admin): beaverstraining@gmail.com
--   - Clínica Dr. Newton Mureb (Clinic Admin): admin@drnewtonmureb.com.br
-- Regra: idempotente, zero estado sem Super Admin ativo, zero perda clínica.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. TABELA AUTORITATIVA DE SUPER ADMINISTRADORES DA PLATAFORMA SAAS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  user_profile_id UUID UNIQUE REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL DEFAULT 'Beaver Soluções em Tecnologia',
  is_active BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_activation', -- pending_activation, active, revoked
  promoted_from_email VARCHAR(150),
  activated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_saas_platform_admins_email_lower CHECK (email = lower(trim(email))),
  CONSTRAINT chk_saas_platform_admins_status CHECK (status IN ('pending_activation', 'active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_saas_platform_admins_active_uid
  ON public.saas_platform_admins (user_id, is_active, status);

DROP TRIGGER IF EXISTS trg_saas_platform_admins_updated_at ON public.saas_platform_admins;
CREATE TRIGGER trg_saas_platform_admins_updated_at
  BEFORE UPDATE ON public.saas_platform_admins
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

ALTER TABLE public.saas_platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Saas platform admins self or super read" ON public.saas_platform_admins;
CREATE POLICY "Saas platform admins self or super read" ON public.saas_platform_admins
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid()
          AND up.is_active = true
          AND up.role_code = 'super_admin'
      )
    )
  );

-- Nenhuma policy INSERT/UPDATE/DELETE para anon ou authenticated:
-- mutações exclusivamente via service_role / funções SECURITY DEFINER autorizadas.

-- --------------------------------------------------------------------
-- 2. DESACOPLAR ORGANIZATION_ID DE SUPER_ADMIN EM USER_PROFILES
-- --------------------------------------------------------------------
-- Permite que o Super Administrador da plataforma SaaS exista sem estar
-- vinculado como dono/membro operacional de nenhuma clínica cliente.
ALTER TABLE public.user_profiles
  ALTER COLUMN organization_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_user_profiles_org_required_for_clinic_roles'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT chk_user_profiles_org_required_for_clinic_roles
      CHECK (role_code = 'super_admin' OR organization_id IS NOT NULL);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_platform_super_admin_email
  ON public.user_profiles (lower(email))
  WHERE organization_id IS NULL;

-- --------------------------------------------------------------------
-- 3. AUTORIZAÇÃO SERVER-SIDE ESTRITA DE SUPER ADMIN DA PLATAFORMA
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

-- Atualizar medsync_get_my_session_context para expor flag autoritativa de plataforma
CREATE OR REPLACE FUNCTION public.medsync_get_my_session_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_org JSONB;
  v_branches JSONB;
  v_auth_branches JSONB;
  v_role_perms JSONB;
  v_user_perms JSONB;
  v_is_platform_super_admin BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'error', 'Sessão não autenticada.');
  END IF;

  SELECT *
  INTO v_profile
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('authenticated', true, 'profile_found', false, 'error', 'Perfil de usuário não encontrado.');
  END IF;

  IF v_profile.organization_id IS NOT NULL THEN
    SELECT to_jsonb(o.*) INTO v_org
    FROM public.organizations o
    WHERE o.id = v_profile.organization_id;

    SELECT COALESCE(jsonb_agg(to_jsonb(b.*) ORDER BY b.is_headquarters DESC, b.name ASC), '[]'::jsonb)
    INTO v_branches
    FROM public.branches b
    WHERE b.organization_id = v_profile.organization_id;
  ELSE
    v_org := NULL;
    v_branches := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(uba.branch_id), '[]'::jsonb)
  INTO v_auth_branches
  FROM public.user_branch_access uba
  WHERE uba.user_profile_id = v_profile.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(rp.*)), '[]'::jsonb)
  INTO v_role_perms
  FROM public.role_permissions rp
  WHERE rp.organization_id IS NULL
     OR (v_profile.organization_id IS NOT NULL AND rp.organization_id = v_profile.organization_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(ump.*)), '[]'::jsonb)
  INTO v_user_perms
  FROM public.user_menu_permissions ump
  WHERE ump.user_profile_id = v_profile.id;

  v_is_platform_super_admin := (
    v_profile.is_active = true
    AND v_profile.role_code = 'super_admin'
    AND EXISTS (
      SELECT 1
      FROM public.saas_platform_admins spa
      WHERE spa.user_id = auth.uid()
        AND spa.is_active = true
        AND spa.status = 'active'
    )
  );

  RETURN jsonb_build_object(
    'authenticated', true,
    'profile_found', true,
    'is_platform_super_admin', v_is_platform_super_admin,
    'profile', to_jsonb(v_profile),
    'organization', v_org,
    'branches', v_branches,
    'authorized_branch_ids', v_auth_branches,
    'role_permissions', v_role_perms,
    'user_permissions', v_user_perms
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.medsync_get_my_session_context() TO authenticated;

-- --------------------------------------------------------------------
-- 4. AJUSTAR BOOTSTRAP PARA NÃO CONCEDER SUPER_ADMIN AO E-MAIL DA CLÍNICA
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

-- Caso a função de primeiro acesso da clínica ainda seja invocada em base virgem,
-- cria o perfil como clinic_admin (NUNCA super_admin da plataforma).
CREATE OR REPLACE FUNCTION public.medsync_bootstrap_first_super_admin(
  p_auth_user_id UUID,
  p_auth_email TEXT,
  p_full_name TEXT,
  p_email_confirmed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized_email CONSTANT TEXT := 'admin@drnewtonmureb.com.br';
  v_clean_email TEXT;
  v_clean_name TEXT;
  v_org_id UUID;
  v_hq_branch_id UUID;
  v_existing_admin RECORD;
  v_existing_by_email RECORD;
  v_existing_by_uid RECORD;
  v_profile_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('medsync_bootstrap_clinic_admin_dr_newton_mureb'));

  v_clean_email := lower(trim(COALESCE(p_auth_email, '')));
  v_clean_name := trim(COALESCE(p_full_name, ''));

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'BOOTSTRAP_UNAUTHORIZED: Identificador de autenticação obrigatório.';
  END IF;

  IF v_clean_email <> v_authorized_email THEN
    RAISE EXCEPTION 'BOOTSTRAP_FORBIDDEN_EMAIL: Apenas o e-mail autorizado admin@drnewtonmureb.com.br pode realizar o primeiro acesso da clínica.';
  END IF;

  IF p_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'BOOTSTRAP_EMAIL_UNCONFIRMED: Confirme a propriedade do e-mail antes de concluir a inicialização.';
  END IF;

  IF length(v_clean_name) < 3 THEN
    v_clean_name := 'Administrador Clínica Dr Newton Mureb';
  END IF;

  v_org_id := public.medsync_resolve_newton_mureb_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'BOOTSTRAP_ORG_NOT_FOUND: Organização Clínica Dr Newton Mureb não localizada.';
  END IF;

  SELECT b.id
  INTO v_hq_branch_id
  FROM public.branches b
  WHERE b.organization_id = v_org_id
    AND b.is_active = true
  ORDER BY b.is_headquarters DESC, b.created_at ASC
  LIMIT 1;

  SELECT *
  INTO v_existing_admin
  FROM public.user_profiles up
  WHERE up.organization_id = v_org_id
    AND up.role_code IN ('clinic_admin', 'super_admin')
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_admin.user_id = p_auth_user_id AND lower(v_existing_admin.email) = v_clean_email THEN
      IF v_existing_admin.is_active IS NOT TRUE THEN
        UPDATE public.user_profiles
        SET is_active = true, updated_at = now()
        WHERE id = v_existing_admin.id;
      END IF;

      INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
      SELECT v_org_id, v_existing_admin.id, b.id, (b.id = v_hq_branch_id)
      FROM public.branches b
      WHERE b.organization_id = v_org_id AND b.is_active = true
      ON CONFLICT (user_profile_id, branch_id) DO NOTHING;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'profile_id', v_existing_admin.id,
        'organization_id', v_org_id,
        'role_code', v_existing_admin.role_code
      );
    END IF;

    RAISE EXCEPTION 'BOOTSTRAP_ALREADY_COMPLETED: A inicialização do administrador da clínica já foi concluída anteriormente.';
  END IF;

  SELECT *
  INTO v_existing_by_uid
  FROM public.user_profiles up
  WHERE up.user_id = p_auth_user_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'BOOTSTRAP_CONFLICT: Esta conta autenticada já está vinculada a outro perfil no sistema.';
  END IF;

  SELECT *
  INTO v_existing_by_email
  FROM public.user_profiles up
  WHERE up.organization_id = v_org_id
    AND lower(up.email) = v_clean_email
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_by_email.user_id IS NOT NULL AND v_existing_by_email.user_id <> p_auth_user_id THEN
      RAISE EXCEPTION 'BOOTSTRAP_CONFLICT: O e-mail autorizado já pertence a outro usuário vinculado.';
    END IF;

    UPDATE public.user_profiles
    SET
      user_id = p_auth_user_id,
      full_name = v_clean_name,
      role_code = 'clinic_admin',
      default_branch_id = COALESCE(default_branch_id, v_hq_branch_id),
      is_active = true,
      updated_at = now()
    WHERE id = v_existing_by_email.id
    RETURNING id INTO v_profile_id;
  ELSE
    INSERT INTO public.user_profiles (
      user_id, organization_id, default_branch_id, full_name, email, role_code, is_active
    )
    VALUES (
      p_auth_user_id, v_org_id, v_hq_branch_id, v_clean_name, v_clean_email, 'clinic_admin', true
    )
    RETURNING id INTO v_profile_id;
  END IF;

  INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
  SELECT v_org_id, v_profile_id, b.id, (b.id = v_hq_branch_id)
  FROM public.branches b
  WHERE b.organization_id = v_org_id AND b.is_active = true
  ON CONFLICT (user_profile_id, branch_id) DO UPDATE SET is_default = EXCLUDED.is_default;

  UPDATE public.professionals
  SET user_profile_id = v_profile_id, updated_at = now()
  WHERE organization_id = v_org_id
    AND lower(COALESCE(email, '')) = v_clean_email
    AND user_profile_id IS NULL;

  INSERT INTO public.audit_logs (
    organization_id, user_id, user_role, action, entity, entity_id, details
  )
  VALUES (
    v_org_id,
    p_auth_user_id,
    'clinic_admin',
    'bootstrap_clinic_admin',
    'user_profiles',
    v_profile_id,
    jsonb_build_object(
      'actor_name', v_clean_name,
      'email', v_clean_email,
      'organization_id', v_org_id,
      'role_code', 'clinic_admin',
      'email_confirmed_at', p_email_confirmed_at,
      'bootstrapped_at', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'profile_id', v_profile_id,
    'organization_id', v_org_id,
    'role_code', 'clinic_admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_bootstrap_first_super_admin(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_bootstrap_first_super_admin(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- --------------------------------------------------------------------
-- 5. FUNÇÃO ATÔMICA DE TRANSFERÊNCIA E SEPARAÇÃO DE IDENTIDADES
--    (EXCLUSIVO service_role / MIGRATIONS)
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

  -- 1. Garantir perfil do novo Super Admin sem transferir dados/vínculos da Clínica Dr. Newton Mureb
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

  -- Verificação explícita antes de revogar o anterior (garante zero estado sem super_admin ativo)
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

  -- 3. Rebaixar o antigo Super Admin da Clínica (admin@drnewtonmureb.com.br) para clinic_admin
  --    Preservando integralmente organization_id, filiais, permissões clínicas e histórico!
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

  -- Revogar eventuais entradas anteriores em saas_platform_admins diferentes do novo e-mail oficial
  UPDATE public.saas_platform_admins
  SET
    is_active = false,
    status = 'revoked',
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
  WHERE lower(email) <> v_target_email
    AND (is_active = true OR status <> 'revoked');

  -- 4. Registrar trilha imutável de auditoria administrativa (sem segredos/senhas/tokens)
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
    'Separação definitiva entre administração da plataforma MedSync SaaS e administração da Clínica Dr. Newton Mureb.',
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
-- 6. EXECUÇÃO IDEMPOTENTE NA MIGRAÇÃO (CENÁRIO A vs CENÁRIO B)
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_new_email CONSTANT TEXT := 'beaverstraining@gmail.com';
  v_old_email CONSTANT TEXT := 'admin@drnewtonmureb.com.br';
  v_new_auth RECORD;
  v_old_super RECORD;
  v_transfer_res JSONB;
BEGIN
  SELECT id, email, email_confirmed_at, raw_user_meta_data
  INTO v_new_auth
  FROM auth.users
  WHERE lower(email) = v_new_email
  LIMIT 1;

  IF FOUND AND v_new_auth.email_confirmed_at IS NOT NULL THEN
    -- CENÁRIO A: Conta já existe no Supabase Auth e está confirmada -> transfere imediatamente!
    v_transfer_res := public.medsync_finalize_platform_super_admin_transfer(
      v_new_auth.id,
      v_new_email,
      COALESCE(NULLIF(trim(v_new_auth.raw_user_meta_data->>'full_name'), ''), 'Beaver Soluções em Tecnologia'),
      v_new_auth.email_confirmed_at,
      v_new_auth.id
    );
  ELSE
    -- CENÁRIO B: Conta ainda não existe ou aguarda confirmação de e-mail ->
    -- Prepara novo Super Admin como pending_activation e preserva o atual provisoriamente
    -- para nunca deixar a plataforma sem Super Admin ativo.
    INSERT INTO public.saas_platform_admins (
      user_id, email, full_name, is_active, status, promoted_from_email
    )
    VALUES (
      v_new_auth.id,
      v_new_email,
      'Beaver Soluções em Tecnologia',
      false,
      'pending_activation',
      v_old_email
    )
    ON CONFLICT (email) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, public.saas_platform_admins.user_id),
      status = CASE
        WHEN public.saas_platform_admins.status = 'active' AND public.saas_platform_admins.is_active = true THEN 'active'
        ELSE 'pending_activation'
      END,
      updated_at = now();

    -- Mantém temporariamente o super_admin existente registrado em saas_platform_admins
    -- enquanto a ativação de beaverstraining@gmail.com é concluída.
    SELECT up.id, up.user_id, up.email, up.full_name
    INTO v_old_super
    FROM public.user_profiles up
    WHERE up.role_code = 'super_admin'
      AND up.is_active = true
      AND lower(up.email) <> v_new_email
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
        updated_at = now();
    END IF;

    INSERT INTO public.saas_audit_logs (
      actor_email, actor_role, action, entity, reason, previous_state, new_state
    )
    VALUES (
      'system_migration',
      'system',
      'super_admin_transfer_prepared',
      'saas_platform_admins',
      'Transferência preparada aguardando criação/confirmação segura da conta beaverstraining@gmail.com no Supabase Auth.',
      jsonb_build_object('current_super_admin_email', COALESCE(v_old_super.email, v_old_email)),
      jsonb_build_object(
        'pending_super_admin_email', v_new_email,
        'auth_account_found', (v_new_auth.id IS NOT NULL),
        'email_confirmed', (v_new_auth.email_confirmed_at IS NOT NULL),
        'result', 'awaiting_auth_activation'
      )
    );
  END IF;
END;
$$;
