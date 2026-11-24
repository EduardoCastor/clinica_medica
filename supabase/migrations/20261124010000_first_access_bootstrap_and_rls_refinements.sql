-- ====================================================================
-- MIGRAÇÃO: PRIMEIRO ACESSO (BOOTSTRAP SUPER ADMIN), MULTI-TENANT ESTRITO E RLS
-- MedSync SaaS — Primeiro Cliente: Clínica Dr Newton Mureb
-- E-mail autorizado para primeiro acesso: admin@drnewtonmureb.com.br
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. GARANTIA NÃO-DESTRUTIVA DA ORGANIZAÇÃO CANÔNICA (SEM DUPLICATAS)
-- --------------------------------------------------------------------
-- Só insere se nenhuma organização correspondente à Clínica Dr Newton Mureb existir.
DO $$
DECLARE
  v_existing_org_id UUID;
  v_adv_plan_id UUID;
  v_clinic_id UUID;
BEGIN
  SELECT o.id
  INTO v_existing_org_id
  FROM public.organizations o
  WHERE lower(o.slug) IN ('dr-newton-mureb', 'newton-mureb')
     OR o.id = 'a0000000-0000-0000-0000-000000000001'::uuid
     OR lower(o.name) LIKE '%newton mureb%'
  ORDER BY
    CASE
      WHEN lower(o.slug) = 'dr-newton-mureb' THEN 0
      WHEN o.id = 'a0000000-0000-0000-0000-000000000001'::uuid THEN 1
      ELSE 2
    END
  LIMIT 1;

  IF v_existing_org_id IS NULL THEN
    SELECT p.id INTO v_adv_plan_id
    FROM public.plans p
    WHERE p.code = 'advanced'
    LIMIT 1;

    v_existing_org_id := 'a0000000-0000-0000-0000-000000000001'::uuid;

    INSERT INTO public.organizations (id, name, slug, plan_id, status, trial_ends_at)
    VALUES (
      v_existing_org_id,
      'NEWTON MUREB CLINICA MEDICA',
      'dr-newton-mureb',
      v_adv_plan_id,
      'active',
      now() + interval '10 days'
    )
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO v_existing_org_id
    FROM public.organizations
    WHERE slug = 'dr-newton-mureb'
    LIMIT 1;
  END IF;

  -- Garantir clínica vinculada caso ainda não exista
  SELECT c.id INTO v_clinic_id
  FROM public.clinics c
  WHERE c.organization_id = v_existing_org_id
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    v_clinic_id := 'b0000000-0000-0000-0000-000000000001'::uuid;
    INSERT INTO public.clinics (
      id, organization_id, legal_name, trade_name, document_number,
      email, phone, whatsapp, institutional_bio
    )
    VALUES (
      v_clinic_id,
      v_existing_org_id,
      'NEWTON MUREB CLINICA MEDICA LTDA',
      'NEWTON MUREB CLINICA MEDICA',
      '55.937.470/0001-78',
      'roseneco1@gmail.com',
      '(22) 9908-9122',
      '(22) 99908-9122',
      'Clínica Médica, Endocrinologia e Metabologia em Cabo Frio - RJ.'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- Garantir unidade matriz vinculada caso ainda não exista
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.organization_id = v_existing_org_id
  ) THEN
    INSERT INTO public.branches (
      id, organization_id, clinic_id, name, code, is_headquarters,
      phone, email, postal_code, street, number, complement,
      neighborhood, city, state, patient_sharing_mode, is_active
    )
    VALUES (
      'c1111111-1111-1111-1111-111111111111'::uuid,
      v_existing_org_id,
      COALESCE(v_clinic_id, 'b0000000-0000-0000-0000-000000000001'::uuid),
      'Unidade Matriz Cabo Frio (Centro)',
      'CF-CENTRO',
      true,
      '(22) 9908-9122',
      'roseneco1@gmail.com',
      '28.905-000',
      'Av. Júlia Kubitschek',
      '16',
      'Sala 307 A - Edif. Premier Center',
      'Centro',
      'Cabo Frio',
      'RJ',
      'model_b',
      true
    )
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- --------------------------------------------------------------------
-- 2. RESTRIÇÃO ESTRUTURAL: NO MÁXIMO UM SUPER_ADMIN POR ORGANIZAÇÃO
-- --------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_single_super_admin_per_org
  ON public.user_profiles (organization_id)
  WHERE role_code = 'super_admin';

-- --------------------------------------------------------------------
-- 3. FUNÇÕES DE BOOTSTRAP SEGURO DO PRIMEIRO SUPER ADMIN
-- --------------------------------------------------------------------

-- 3.1 Resolvedor interno da organização da Clínica Dr Newton Mureb (somente service_role)
CREATE OR REPLACE FUNCTION public.medsync_resolve_newton_mureb_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id
  FROM public.organizations o
  WHERE lower(o.slug) IN ('dr-newton-mureb', 'newton-mureb')
     OR o.id = 'a0000000-0000-0000-0000-000000000001'::uuid
     OR lower(o.name) LIKE '%newton mureb%'
  ORDER BY
    CASE
      WHEN lower(o.slug) = 'dr-newton-mureb' THEN 0
      WHEN o.id = 'a0000000-0000-0000-0000-000000000001'::uuid THEN 1
      ELSE 2
    END,
    o.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.medsync_resolve_newton_mureb_org_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_resolve_newton_mureb_org_id() TO service_role;

-- 3.2 Consulta pública segura de status de inicialização (zero PII, zero UUID, zero e-mail)
CREATE OR REPLACE FUNCTION public.medsync_get_bootstrap_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_has_super_admin BOOLEAN := false;
BEGIN
  v_org_id := public.medsync_resolve_newton_mureb_org_id();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'organization_found', false,
      'needs_bootstrap', false,
      'already_initialized', false,
      'organization_name', 'Clínica Dr Newton Mureb'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.organization_id = v_org_id
      AND up.role_code = 'super_admin'
  ) INTO v_has_super_admin;

  RETURN jsonb_build_object(
    'organization_found', true,
    'needs_bootstrap', NOT v_has_super_admin,
    'already_initialized', v_has_super_admin,
    'organization_name', 'Clínica Dr Newton Mureb'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_get_bootstrap_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.medsync_get_bootstrap_status() TO anon, authenticated, service_role;

-- 3.3 Bootstrap atômico, concorrente-seguro e idempotente (exclusivo service_role)
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
  v_existing_super RECORD;
  v_existing_by_email RECORD;
  v_existing_by_uid RECORD;
  v_profile_id UUID;
BEGIN
  -- Trava transacional contra concorrência de múltiplas requisições simultâneas
  PERFORM pg_advisory_xact_lock(hashtext('medsync_bootstrap_super_admin_dr_newton_mureb'));

  v_clean_email := lower(trim(COALESCE(p_auth_email, '')));
  v_clean_name := trim(COALESCE(p_full_name, ''));

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'BOOTSTRAP_UNAUTHORIZED: Identificador de autenticação obrigatório.';
  END IF;

  IF v_clean_email <> v_authorized_email THEN
    RAISE EXCEPTION 'BOOTSTRAP_FORBIDDEN_EMAIL: Apenas o e-mail autorizado admin@drnewtonmureb.com.br pode realizar o primeiro acesso administrativo.';
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

  -- Verifica se já existe um Super Admin na organização
  SELECT *
  INTO v_existing_super
  FROM public.user_profiles up
  WHERE up.organization_id = v_org_id
    AND up.role_code = 'super_admin'
  LIMIT 1;

  IF FOUND THEN
    -- Idempotência estrita: apenas o mesmo usuário confirmado que já concluiu o bootstrap recebe sucesso
    IF v_existing_super.user_id = p_auth_user_id AND lower(v_existing_super.email) = v_clean_email THEN
      IF v_existing_super.is_active IS NOT TRUE THEN
        UPDATE public.user_profiles
        SET is_active = true, updated_at = now()
        WHERE id = v_existing_super.id;
      END IF;

      INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
      SELECT v_org_id, v_existing_super.id, b.id, (b.id = v_hq_branch_id)
      FROM public.branches b
      WHERE b.organization_id = v_org_id AND b.is_active = true
      ON CONFLICT (user_profile_id, branch_id) DO NOTHING;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'profile_id', v_existing_super.id,
        'organization_id', v_org_id,
        'role_code', 'super_admin'
      );
    END IF;

    RAISE EXCEPTION 'BOOTSTRAP_ALREADY_COMPLETED: A inicialização do Super Administrador já foi concluída anteriormente.';
  END IF;

  -- Verifica conflito de user_id vinculado em outro perfil
  SELECT *
  INTO v_existing_by_uid
  FROM public.user_profiles up
  WHERE up.user_id = p_auth_user_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'BOOTSTRAP_CONFLICT: Esta conta autenticada já está vinculada a outro perfil no sistema.';
  END IF;

  -- Caso raro: perfil pré-existente na org com o mesmo e-mail ainda sem user_id
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
      role_code = 'super_admin',
      default_branch_id = COALESCE(default_branch_id, v_hq_branch_id),
      is_active = true,
      updated_at = now()
    WHERE id = v_existing_by_email.id
    RETURNING id INTO v_profile_id;
  ELSE
    INSERT INTO public.user_profiles (
      user_id,
      organization_id,
      default_branch_id,
      full_name,
      email,
      role_code,
      is_active
    )
    VALUES (
      p_auth_user_id,
      v_org_id,
      v_hq_branch_id,
      v_clean_name,
      v_clean_email,
      'super_admin',
      true
    )
    RETURNING id INTO v_profile_id;
  END IF;

  -- Conceder acesso às unidades ativas da organização autorizada
  INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
  SELECT v_org_id, v_profile_id, b.id, (b.id = v_hq_branch_id)
  FROM public.branches b
  WHERE b.organization_id = v_org_id AND b.is_active = true
  ON CONFLICT (user_profile_id, branch_id) DO UPDATE SET is_default = EXCLUDED.is_default;

  -- Vincular registro profissional caso o e-mail coincida com profissional existente
  UPDATE public.professionals
  SET user_profile_id = v_profile_id, updated_at = now()
  WHERE organization_id = v_org_id
    AND lower(COALESCE(email, '')) = v_clean_email
    AND user_profile_id IS NULL;

  -- Auditoria obrigatória do bootstrap inicial
  INSERT INTO public.audit_logs (
    organization_id,
    user_id,
    user_role,
    action,
    entity,
    entity_id,
    details
  )
  VALUES (
    v_org_id,
    p_auth_user_id,
    'super_admin',
    'bootstrap_super_admin',
    'user_profiles',
    v_profile_id,
    jsonb_build_object(
      'actor_name', v_clean_name,
      'email', v_clean_email,
      'organization_id', v_org_id,
      'email_confirmed_at', p_email_confirmed_at,
      'bootstrapped_at', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'profile_id', v_profile_id,
    'organization_id', v_org_id,
    'role_code', 'super_admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.medsync_bootstrap_first_super_admin(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medsync_bootstrap_first_super_admin(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- --------------------------------------------------------------------
-- 4. REFORÇO MULTI-TENANT ESTRITO E RLS (SEÇÃO 8)
-- --------------------------------------------------------------------
-- Garante que até mesmo o Super Admin da Clínica Dr Newton Mureb opere
-- exclusivamente dentro da sua própria organização autorizada.

CREATE OR REPLACE FUNCTION public.medsync_can_access_org(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_org_id IS NULL THEN false
    WHEN auth.uid() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.is_active = true
        AND up.organization_id = target_org_id
    )
  END;
$$;

-- User Profiles: isolamento estrito por organização inclusive para super_admin
DROP POLICY IF EXISTS "User profiles read" ON public.user_profiles;
DROP POLICY IF EXISTS "User profiles insert" ON public.user_profiles;
DROP POLICY IF EXISTS "User profiles update" ON public.user_profiles;
DROP POLICY IF EXISTS "User profiles delete" ON public.user_profiles;

CREATE POLICY "User profiles read" ON public.user_profiles
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      public.medsync_can_access_org(organization_id)
      AND (
        public.medsync_is_super_admin()
        OR public.medsync_has_menu_permission('users', 'consult')
        OR public.medsync_current_role() IN ('clinic_admin', 'branch_admin')
      )
    )
  );

CREATE POLICY "User profiles insert" ON public.user_profiles
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      (public.medsync_is_super_admin() AND role_code <> 'super_admin')
      OR (
        public.medsync_has_menu_permission('users', 'create')
        AND role_code <> 'super_admin'
      )
    )
  );

CREATE POLICY "User profiles update" ON public.user_profiles
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_is_super_admin()
      OR (
        public.medsync_has_menu_permission('users', 'edit')
        AND role_code <> 'super_admin'
      )
    )
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_is_super_admin()
      OR (
        public.medsync_has_menu_permission('users', 'edit')
        AND role_code <> 'super_admin'
      )
    )
  );

CREATE POLICY "User profiles delete" ON public.user_profiles
  FOR DELETE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_is_super_admin()
    AND role_code <> 'super_admin'
  );

-- Role Permissions: escrita restrita à organização do ator
DROP POLICY IF EXISTS "Role permissions write" ON public.role_permissions;
CREATE POLICY "Role permissions write" ON public.role_permissions
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_is_super_admin()
      OR (
        public.medsync_has_menu_permission('users', 'admin')
        AND role_code <> 'super_admin'
      )
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_is_super_admin()
      OR (
        public.medsync_has_menu_permission('users', 'admin')
        AND role_code <> 'super_admin'
      )
    )
  );

-- User Menu Permissions: escrita restrita à organização do ator
DROP POLICY IF EXISTS "User menu permissions write" ON public.user_menu_permissions;
CREATE POLICY "User menu permissions write" ON public.user_menu_permissions
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_is_super_admin()
      OR (
        public.medsync_has_menu_permission('users', 'admin')
        AND user_profile_id <> public.medsync_current_user_profile_id()
      )
    )
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_is_super_admin()
      OR (
        public.medsync_has_menu_permission('users', 'admin')
        AND user_profile_id <> public.medsync_current_user_profile_id()
      )
    )
  );

-- Audit Logs: leitura restrita à organização do administrador
DROP POLICY IF EXISTS "Audit logs select" ON public.audit_logs;
CREATE POLICY "Audit logs select" ON public.audit_logs
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_current_role() IN ('super_admin', 'clinic_admin', 'branch_admin')
  );

-- Plans: leitura pública de planos ativos; gestão somente por super_admin ativo
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Plans public read" ON public.plans;
DROP POLICY IF EXISTS "Plans super admin write" ON public.plans;
CREATE POLICY "Plans public read" ON public.plans
  FOR SELECT
  USING (is_active = true OR public.medsync_is_super_admin());

CREATE POLICY "Plans super admin write" ON public.plans
  FOR ALL
  USING (public.medsync_is_super_admin())
  WITH CHECK (public.medsync_is_super_admin());

-- Reforçar trigger anti-escalação para exigir mesma organização inclusive para super_admin autenticado
CREATE OR REPLACE FUNCTION public.protect_user_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role TEXT;
  v_actor_org UUID;
  v_actor_profile_id UUID;
  v_jwt_role TEXT;
BEGIN
  v_jwt_role := COALESCE(auth.role(), '');

  IF v_jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória para alterar perfis de usuário.';
  END IF;

  SELECT id, organization_id, role_code::text
  INTO v_actor_profile_id, v_actor_org, v_actor_role
  FROM public.user_profiles
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado inválido ou inativo.';
  END IF;

  -- Isolamento multi-tenant obrigatório para qualquer ator autenticado
  IF NEW.organization_id <> v_actor_org THEN
    RAISE EXCEPTION 'Isolamento multi-tenant: operação restrita à organização autorizada.';
  END IF;

  IF NEW.role_code = 'super_admin' AND v_actor_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Elevação de privilégio bloqueada: apenas super_admin pode atribuir papel super_admin.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_id <> v_actor_org THEN
      RAISE EXCEPTION 'Isolamento multi-tenant: alteração não permitida fora da própria organização.';
    END IF;

    IF OLD.user_id = auth.uid() AND v_actor_role <> 'super_admin' THEN
      IF NEW.role_code IS DISTINCT FROM OLD.role_code
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.is_active IS DISTINCT FROM OLD.is_active
         OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'Segurança RBAC: usuário não pode alterar seu próprio papel, organização ou status.';
      END IF;
    END IF;

    IF v_actor_role <> 'super_admin' AND OLD.role_code = 'super_admin' THEN
      RAISE EXCEPTION 'Acesso negado: apenas super_admin pode modificar o Super Administrador.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Reforçar RPCs administrativas para manter isolamento multi-tenant também para super_admin
CREATE OR REPLACE FUNCTION public.medsync_save_user_rbac(
  p_target_profile_id UUID,
  p_full_name TEXT,
  p_phone TEXT,
  p_role_code TEXT,
  p_default_branch_id UUID,
  p_is_active BOOLEAN,
  p_authorized_branch_ids UUID[],
  p_menu_permissions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor RECORD;
  v_target RECORD;
  v_item JSONB;
  v_menu_key TEXT;
  v_can_view BOOLEAN;
  v_can_consult BOOLEAN;
  v_can_create BOOLEAN;
  v_can_edit BOOLEAN;
  v_can_delete BOOLEAN;
  v_can_admin BOOLEAN;
  v_is_override BOOLEAN;
  v_branch_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.user_profiles
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil autenticado inválido ou inativo.';
  END IF;

  IF NOT (v_actor.role_code = 'super_admin' OR public.medsync_has_menu_permission('users', 'edit') OR public.medsync_has_menu_permission('users', 'admin')) THEN
    RAISE EXCEPTION 'Permissão insuficiente para alterar usuários e permissões.';
  END IF;

  SELECT *
  INTO v_target
  FROM public.user_profiles
  WHERE id = p_target_profile_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário alvo não encontrado.';
  END IF;

  IF v_target.organization_id <> v_actor.organization_id THEN
    RAISE EXCEPTION 'Isolamento multi-tenant: não é permitido alterar usuários de outra organização.';
  END IF;

  IF v_actor.role_code <> 'super_admin' THEN
    IF v_target.role_code = 'super_admin' OR p_role_code = 'super_admin' THEN
      RAISE EXCEPTION 'Elevação de privilégio bloqueada: papel super_admin é exclusivo da administração geral.';
    END IF;
    IF v_target.id = v_actor.id AND (p_role_code IS DISTINCT FROM v_target.role_code OR p_is_active IS DISTINCT FROM v_target.is_active) THEN
      RAISE EXCEPTION 'Não é permitido alterar o próprio papel ou status por esta operação.';
    END IF;
    IF v_actor.role_code = 'branch_admin' AND p_role_code IN ('clinic_admin', 'branch_admin') AND p_role_code IS DISTINCT FROM v_target.role_code THEN
      RAISE EXCEPTION 'Administrador de filial não pode promover usuários para administrador.';
    END IF;
  END IF;

  IF v_target.role_code = 'super_admin' AND p_role_code <> 'super_admin' THEN
    RAISE EXCEPTION 'Não é permitido remover o papel super_admin do administrador principal.';
  END IF;

  UPDATE public.user_profiles
  SET
    full_name = COALESCE(NULLIF(trim(p_full_name), ''), full_name),
    phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
    role_code = p_role_code,
    default_branch_id = p_default_branch_id,
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = v_target.id;

  DELETE FROM public.user_branch_access WHERE user_profile_id = v_target.id;

  IF p_authorized_branch_ids IS NOT NULL THEN
    FOREACH v_branch_id IN ARRAY p_authorized_branch_ids LOOP
      INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
      SELECT v_target.organization_id, v_target.id, b.id, (b.id = p_default_branch_id)
      FROM public.branches b
      WHERE b.id = v_branch_id AND b.organization_id = v_target.organization_id
      ON CONFLICT (user_profile_id, branch_id) DO UPDATE SET is_default = EXCLUDED.is_default;
    END LOOP;
  END IF;

  IF p_default_branch_id IS NOT NULL THEN
    INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
    SELECT v_target.organization_id, v_target.id, b.id, true
    FROM public.branches b
    WHERE b.id = p_default_branch_id AND b.organization_id = v_target.organization_id
    ON CONFLICT (user_profile_id, branch_id) DO UPDATE SET is_default = true;
  END IF;

  IF p_menu_permissions IS NOT NULL AND jsonb_typeof(p_menu_permissions) = 'array' THEN
    DELETE FROM public.user_menu_permissions WHERE user_profile_id = v_target.id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_menu_permissions) LOOP
      v_menu_key := v_item->>'menuKey';
      IF v_menu_key IS NULL OR trim(v_menu_key) = '' THEN
        CONTINUE;
      END IF;

      v_is_override := COALESCE((v_item->>'isCustomOverride')::boolean, false);
      IF NOT v_is_override THEN
        CONTINUE;
      END IF;

      v_can_view := COALESCE((v_item->>'canView')::boolean, false);
      v_can_consult := COALESCE((v_item->>'canConsult')::boolean, false);
      v_can_create := COALESCE((v_item->>'canCreate')::boolean, false);
      v_can_edit := COALESCE((v_item->>'canEdit')::boolean, false);
      v_can_delete := COALESCE((v_item->>'canDelete')::boolean, false);
      v_can_admin := COALESCE((v_item->>'canAdmin')::boolean, false);

      IF v_actor.role_code <> 'super_admin' THEN
        v_can_view := v_can_view AND public.medsync_has_menu_permission(v_menu_key, 'view');
        v_can_consult := v_can_consult AND public.medsync_has_menu_permission(v_menu_key, 'consult');
        v_can_create := v_can_create AND public.medsync_has_menu_permission(v_menu_key, 'create');
        v_can_edit := v_can_edit AND public.medsync_has_menu_permission(v_menu_key, 'edit');
        v_can_delete := v_can_delete AND public.medsync_has_menu_permission(v_menu_key, 'delete');
        v_can_admin := v_can_admin AND public.medsync_has_menu_permission(v_menu_key, 'admin');
      END IF;

      INSERT INTO public.user_menu_permissions (
        organization_id, user_profile_id, menu_key,
        can_view, can_consult, can_create, can_edit, can_delete, can_admin,
        is_custom_override, updated_by
      )
      VALUES (
        v_target.organization_id, v_target.id, v_menu_key,
        v_can_view, v_can_consult, v_can_create, v_can_edit, v_can_delete, v_can_admin,
        true, v_actor.id
      )
      ON CONFLICT (user_profile_id, menu_key) DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_consult = EXCLUDED.can_consult,
        can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete,
        can_admin = EXCLUDED.can_admin,
        is_custom_override = true,
        updated_by = v_actor.id,
        updated_at = now();
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (
    organization_id, user_id, user_role, action, entity, entity_id, details
  )
  VALUES (
    v_target.organization_id,
    v_actor.user_id,
    v_actor.role_code,
    'change_permission',
    'user_profiles',
    v_target.id,
    jsonb_build_object(
      'actor_profile_id', v_actor.id,
      'actor_name', v_actor.full_name,
      'target_profile_id', v_target.id,
      'target_email', v_target.email,
      'previous_role', v_target.role_code,
      'new_role', p_role_code,
      'previous_active', v_target.is_active,
      'new_active', p_is_active,
      'authorized_branch_ids', p_authorized_branch_ids,
      'updated_at', now()
    )
  );

  RETURN jsonb_build_object('success', true, 'profile_id', v_target.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.medsync_save_role_permissions(
  p_organization_id UUID,
  p_role_code TEXT,
  p_permissions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor RECORD;
  v_item JSONB;
  v_menu_key TEXT;
  v_can_view BOOLEAN;
  v_can_consult BOOLEAN;
  v_can_create BOOLEAN;
  v_can_edit BOOLEAN;
  v_can_delete BOOLEAN;
  v_can_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.';
  END IF;

  SELECT *
  INTO v_actor
  FROM public.user_profiles
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil autenticado inválido ou inativo.';
  END IF;

  IF NOT (v_actor.role_code = 'super_admin' OR public.medsync_has_menu_permission('users', 'admin')) THEN
    RAISE EXCEPTION 'Permissão insuficiente para configurar papéis da organização.';
  END IF;

  IF p_organization_id <> v_actor.organization_id THEN
    RAISE EXCEPTION 'Isolamento multi-tenant: não é permitido alterar papéis de outra organização.';
  END IF;

  IF v_actor.role_code <> 'super_admin' AND p_role_code = 'super_admin' THEN
    RAISE EXCEPTION 'O modelo de permissões do papel super_admin não pode ser alterado por administradores de clínica.';
  END IF;

  IF p_permissions IS NOT NULL AND jsonb_typeof(p_permissions) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_permissions) LOOP
      v_menu_key := v_item->>'menuKey';
      IF v_menu_key IS NULL OR trim(v_menu_key) = '' THEN
        CONTINUE;
      END IF;

      v_can_view := COALESCE((v_item->>'canView')::boolean, false);
      v_can_consult := COALESCE((v_item->>'canConsult')::boolean, false);
      v_can_create := COALESCE((v_item->>'canCreate')::boolean, false);
      v_can_edit := COALESCE((v_item->>'canEdit')::boolean, false);
      v_can_delete := COALESCE((v_item->>'canDelete')::boolean, false);
      v_can_admin := COALESCE((v_item->>'canAdmin')::boolean, false);

      IF v_actor.role_code <> 'super_admin' THEN
        v_can_view := v_can_view AND public.medsync_has_menu_permission(v_menu_key, 'view');
        v_can_consult := v_can_consult AND public.medsync_has_menu_permission(v_menu_key, 'consult');
        v_can_create := v_can_create AND public.medsync_has_menu_permission(v_menu_key, 'create');
        v_can_edit := v_can_edit AND public.medsync_has_menu_permission(v_menu_key, 'edit');
        v_can_delete := v_can_delete AND public.medsync_has_menu_permission(v_menu_key, 'delete');
        v_can_admin := v_can_admin AND public.medsync_has_menu_permission(v_menu_key, 'admin');
      END IF;

      INSERT INTO public.role_permissions (
        organization_id, role_code, menu_key,
        can_view, can_consult, can_create, can_edit, can_delete, can_admin
      )
      VALUES (
        p_organization_id, p_role_code, v_menu_key,
        v_can_view, v_can_consult, v_can_create, v_can_edit, v_can_delete, v_can_admin
      )
      ON CONFLICT (
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        role_code,
        menu_key
      ) DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_consult = EXCLUDED.can_consult,
        can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete,
        can_admin = EXCLUDED.can_admin,
        updated_at = now();
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (
    organization_id, user_id, user_role, action, entity, details
  )
  VALUES (
    p_organization_id,
    v_actor.user_id,
    v_actor.role_code,
    'change_role_template',
    'role_permissions',
    jsonb_build_object(
      'actor_profile_id', v_actor.id,
      'actor_name', v_actor.full_name,
      'role_code', p_role_code,
      'updated_at', now()
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
