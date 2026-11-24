-- ====================================================================
-- MIGRAÇÃO: EQUIPES, USUÁRIOS, RBAC CONFIGURÁVEL, AUTENTICAÇÃO E RLS
-- MedSync SaaS — Primeiro Cliente em Produção: Clínica Newton Mureb
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. PAPÉIS CANÔNICOS (PUBLIC.ROLES)
-- --------------------------------------------------------------------

INSERT INTO public.roles (code, name, description)
VALUES
  ('super_admin', 'Super Administrador SaaS', 'Administração geral da plataforma MedSync SaaS.'),
  ('clinic_admin', 'Administrador da Clínica', 'Gestão operacional da organização, usuários, permissões e filiais.'),
  ('branch_admin', 'Administrador de Filial', 'Gestão operacional restrita às filiais autorizadas.'),
  ('doctor', 'Médico(a)', 'Agenda, pacientes autorizados, prontuário eletrônico e documentos clínicos.'),
  ('physiotherapist', 'Fisioterapeuta / Especialista Clínico', 'Agenda, pacientes autorizados e evoluções clínicas dentro das atribuições.'),
  ('receptionist', 'Recepção / Secretaria', 'Agenda, cadastro de pacientes e atendimento administrativo sem prontuário restrito.'),
  ('financial', 'Financeiro', 'Módulo financeiro preservado sem acesso clínico ou administrativo de equipe.'),
  ('patient', 'Paciente (Portal)', 'Acesso exclusivo ao portal do paciente.')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- --------------------------------------------------------------------
-- 2. AJUSTES INCREMENTAIS EM USER_PROFILES E PROFESSIONALS
-- --------------------------------------------------------------------

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_org_email
  ON public.user_profiles (organization_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_user_profiles_org_role_active
  ON public.user_profiles (organization_id, role_code, is_active);

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uq_professionals_org_council
  ON public.professionals (organization_id, lower(regexp_replace(council_number, '\s+', '', 'g')))
  WHERE length(trim(COALESCE(council_number, ''))) > 0;

CREATE INDEX IF NOT EXISTS idx_professionals_org_active
  ON public.professionals (organization_id, is_active);

DROP TRIGGER IF EXISTS trg_professionals_updated_at ON public.professionals;
CREATE TRIGGER trg_professionals_updated_at
  BEFORE UPDATE ON public.professionals
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- --------------------------------------------------------------------
-- 3. VÍNCULOS DE FILIAIS (PROFESSIONAL_BRANCHES & USER_BRANCH_ACCESS)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.professional_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (professional_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_professional_branches_org
  ON public.professional_branches (organization_id, branch_id);

-- Backfill seguro para profissionais já existentes sem vínculo em professional_branches
INSERT INTO public.professional_branches (organization_id, professional_id, branch_id)
SELECT p.organization_id, p.id, b.id
FROM public.professionals p
JOIN LATERAL (
  SELECT br.id
  FROM public.branches br
  WHERE br.organization_id = p.organization_id
  ORDER BY br.is_headquarters DESC, br.created_at ASC
  LIMIT 1
) b ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.professional_branches pb WHERE pb.professional_id = p.id
)
ON CONFLICT (professional_id, branch_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_branch_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_profile_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_profile_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branch_access_org_user
  ON public.user_branch_access (organization_id, user_profile_id);

-- Backfill a partir de default_branch_id dos perfis existentes
INSERT INTO public.user_branch_access (organization_id, user_profile_id, branch_id, is_default)
SELECT up.organization_id, up.id, up.default_branch_id, true
FROM public.user_profiles up
WHERE up.default_branch_id IS NOT NULL
ON CONFLICT (user_profile_id, branch_id) DO NOTHING;

-- --------------------------------------------------------------------
-- 4. MATRIZ RBAC CONFIGURÁVEL (ROLE_PERMISSIONS & USER_MENU_PERMISSIONS)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_code VARCHAR(50) NOT NULL REFERENCES public.roles(code) ON DELETE CASCADE,
  menu_key VARCHAR(50) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_consult BOOLEAN NOT NULL DEFAULT false,
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  can_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions_org_role_menu
  ON public.role_permissions (
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    role_code,
    menu_key
  );

DROP TRIGGER IF EXISTS trg_role_permissions_updated_at ON public.role_permissions;
CREATE TRIGGER trg_role_permissions_updated_at
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

CREATE TABLE IF NOT EXISTS public.user_menu_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_profile_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  menu_key VARCHAR(50) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_consult BOOLEAN NOT NULL DEFAULT false,
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  can_admin BOOLEAN NOT NULL DEFAULT false,
  is_custom_override BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_profile_id, menu_key)
);

CREATE INDEX IF NOT EXISTS idx_user_menu_permissions_org_user
  ON public.user_menu_permissions (organization_id, user_profile_id);

DROP TRIGGER IF EXISTS trg_user_menu_permissions_updated_at ON public.user_menu_permissions;
CREATE TRIGGER trg_user_menu_permissions_updated_at
  BEFORE UPDATE ON public.user_menu_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- Carga inicial dos modelos padrão globais (organization_id IS NULL)
INSERT INTO public.role_permissions (
  organization_id, role_code, menu_key, can_view, can_consult, can_create, can_edit, can_delete, can_admin
)
VALUES
  -- super_admin
  (NULL, 'super_admin', 'dashboard', true, true, true, true, false, false),
  (NULL, 'super_admin', 'appointments', true, true, true, true, true, true),
  (NULL, 'super_admin', 'patients', true, true, true, true, false, true),
  (NULL, 'super_admin', 'medical_records', true, true, false, false, false, true),
  (NULL, 'super_admin', 'communication', true, true, true, true, true, true),
  (NULL, 'super_admin', 'financial', true, true, true, true, false, true),
  (NULL, 'super_admin', 'users', true, true, true, true, false, true),
  (NULL, 'super_admin', 'settings', true, true, true, true, false, true),
  (NULL, 'super_admin', 'website_builder', true, true, true, true, false, true),

  -- clinic_admin
  (NULL, 'clinic_admin', 'dashboard', true, true, true, true, false, false),
  (NULL, 'clinic_admin', 'appointments', true, true, true, true, true, true),
  (NULL, 'clinic_admin', 'patients', true, true, true, true, false, true),
  (NULL, 'clinic_admin', 'medical_records', true, true, false, false, false, false),
  (NULL, 'clinic_admin', 'communication', true, true, true, true, true, true),
  (NULL, 'clinic_admin', 'financial', true, true, true, true, false, true),
  (NULL, 'clinic_admin', 'users', true, true, true, true, false, true),
  (NULL, 'clinic_admin', 'settings', true, true, true, true, false, true),
  (NULL, 'clinic_admin', 'website_builder', true, true, true, true, false, true),

  -- branch_admin
  (NULL, 'branch_admin', 'dashboard', true, true, true, true, false, false),
  (NULL, 'branch_admin', 'appointments', true, true, true, true, true, false),
  (NULL, 'branch_admin', 'patients', true, true, true, true, false, false),
  (NULL, 'branch_admin', 'medical_records', false, false, false, false, false, false),
  (NULL, 'branch_admin', 'communication', true, true, true, true, false, false),
  (NULL, 'branch_admin', 'financial', true, true, true, false, false, false),
  (NULL, 'branch_admin', 'users', true, true, true, true, false, false),
  (NULL, 'branch_admin', 'settings', false, false, false, false, false, false),
  (NULL, 'branch_admin', 'website_builder', false, false, false, false, false, false),

  -- doctor
  (NULL, 'doctor', 'dashboard', true, true, false, true, false, false),
  (NULL, 'doctor', 'appointments', true, true, true, true, false, false),
  (NULL, 'doctor', 'patients', true, true, true, true, false, false),
  (NULL, 'doctor', 'medical_records', true, true, true, true, false, false),
  (NULL, 'doctor', 'communication', true, true, false, false, false, false),
  (NULL, 'doctor', 'financial', false, false, false, false, false, false),
  (NULL, 'doctor', 'users', false, false, false, false, false, false),
  (NULL, 'doctor', 'settings', false, false, false, false, false, false),
  (NULL, 'doctor', 'website_builder', false, false, false, false, false, false),

  -- physiotherapist
  (NULL, 'physiotherapist', 'dashboard', true, true, false, true, false, false),
  (NULL, 'physiotherapist', 'appointments', true, true, true, true, false, false),
  (NULL, 'physiotherapist', 'patients', true, true, true, true, false, false),
  (NULL, 'physiotherapist', 'medical_records', true, true, true, true, false, false),
  (NULL, 'physiotherapist', 'communication', true, true, false, false, false, false),
  (NULL, 'physiotherapist', 'financial', false, false, false, false, false, false),
  (NULL, 'physiotherapist', 'users', false, false, false, false, false, false),
  (NULL, 'physiotherapist', 'settings', false, false, false, false, false, false),
  (NULL, 'physiotherapist', 'website_builder', false, false, false, false, false, false),

  -- receptionist
  (NULL, 'receptionist', 'dashboard', true, true, false, true, false, false),
  (NULL, 'receptionist', 'appointments', true, true, true, true, false, false),
  (NULL, 'receptionist', 'patients', true, true, true, true, false, false),
  (NULL, 'receptionist', 'medical_records', false, false, false, false, false, false),
  (NULL, 'receptionist', 'communication', true, true, true, false, false, false),
  (NULL, 'receptionist', 'financial', false, false, false, false, false, false),
  (NULL, 'receptionist', 'users', false, false, false, false, false, false),
  (NULL, 'receptionist', 'settings', false, false, false, false, false, false),
  (NULL, 'receptionist', 'website_builder', false, false, false, false, false, false),

  -- financial
  (NULL, 'financial', 'dashboard', true, true, false, false, false, false),
  (NULL, 'financial', 'appointments', false, false, false, false, false, false),
  (NULL, 'financial', 'patients', false, false, false, false, false, false),
  (NULL, 'financial', 'medical_records', false, false, false, false, false, false),
  (NULL, 'financial', 'communication', false, false, false, false, false, false),
  (NULL, 'financial', 'financial', true, true, true, true, false, true),
  (NULL, 'financial', 'users', false, false, false, false, false, false),
  (NULL, 'financial', 'settings', false, false, false, false, false, false),
  (NULL, 'financial', 'website_builder', false, false, false, false, false, false),

  -- patient
  (NULL, 'patient', 'dashboard', false, false, false, false, false, false),
  (NULL, 'patient', 'appointments', false, false, false, false, false, false),
  (NULL, 'patient', 'patients', false, false, false, false, false, false),
  (NULL, 'patient', 'medical_records', false, false, false, false, false, false),
  (NULL, 'patient', 'communication', false, false, false, false, false, false),
  (NULL, 'patient', 'financial', false, false, false, false, false, false),
  (NULL, 'patient', 'users', false, false, false, false, false, false),
  (NULL, 'patient', 'settings', false, false, false, false, false, false),
  (NULL, 'patient', 'website_builder', false, false, false, false, false, false)
ON CONFLICT (
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  role_code,
  menu_key
) DO NOTHING;

-- --------------------------------------------------------------------
-- 5. FUNÇÕES DE SEGURANÇA RBAC & ISOLAMENTO MULTI-TENANT (SECURITY DEFINER)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.medsync_current_user_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.id
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
    AND up.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.medsync_is_active_user()
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
  );
$$;

CREATE OR REPLACE FUNCTION public.medsync_current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.role_code::text
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
    AND up.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.medsync_is_super_admin()
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

CREATE OR REPLACE FUNCTION public.medsync_current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.organization_id
  FROM public.user_profiles up
  WHERE up.user_id = auth.uid()
    AND up.is_active = true
  LIMIT 1;
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
    WHEN auth.uid() IS NULL THEN false
    WHEN public.medsync_is_super_admin() THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.is_active = true
        AND up.organization_id = target_org_id
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.medsync_user_has_branch_access(target_org_id UUID, target_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR target_org_id IS NULL THEN false
    WHEN NOT public.medsync_can_access_org(target_org_id) THEN false
    WHEN public.medsync_current_role() IN ('super_admin', 'clinic_admin') THEN true
    WHEN target_branch_id IS NULL THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.user_id = auth.uid()
        AND up.is_active = true
        AND up.organization_id = target_org_id
        AND (
          up.default_branch_id = target_branch_id
          OR EXISTS (
            SELECT 1
            FROM public.user_branch_access uba
            WHERE uba.user_profile_id = up.id
              AND uba.branch_id = target_branch_id
          )
          OR (
            up.default_branch_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.user_branch_access uba2 WHERE uba2.user_profile_id = up.id
            )
          )
        )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.medsync_has_menu_permission(p_menu_key TEXT, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_override RECORD;
  v_role_perm RECORD;
  v_granted BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, organization_id, role_code, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_profile.role_code = 'super_admin' THEN
    IF p_menu_key IN ('dashboard', 'users', 'settings', 'appointments', 'patients', 'communication', 'website_builder', 'financial') THEN
      RETURN true;
    END IF;
    IF p_menu_key = 'medical_records' AND p_action IN ('view', 'consult', 'admin') THEN
      RETURN true;
    END IF;
  END IF;

  -- 1. Verificar exceção individual explícita do usuário
  SELECT *
  INTO v_override
  FROM public.user_menu_permissions ump
  WHERE ump.user_profile_id = v_profile.id
    AND ump.menu_key = p_menu_key
    AND ump.is_custom_override = true
  LIMIT 1;

  IF FOUND THEN
    v_granted := CASE p_action
      WHEN 'view' THEN v_override.can_view
      WHEN 'consult' THEN v_override.can_consult
      WHEN 'create' THEN v_override.can_create
      WHEN 'edit' THEN v_override.can_edit
      WHEN 'delete' THEN v_override.can_delete
      WHEN 'admin' THEN v_override.can_admin
      ELSE false
    END;
    RETURN COALESCE(v_granted, false);
  END IF;

  -- 2. Verificar permissão padrão do papel (override da organização -> padrão global)
  SELECT *
  INTO v_role_perm
  FROM public.role_permissions rp
  WHERE rp.role_code = v_profile.role_code
    AND rp.menu_key = p_menu_key
    AND (rp.organization_id = v_profile.organization_id OR rp.organization_id IS NULL)
  ORDER BY (rp.organization_id IS NOT NULL) DESC
  LIMIT 1;

  IF FOUND THEN
    v_granted := CASE p_action
      WHEN 'view' THEN v_role_perm.can_view
      WHEN 'consult' THEN v_role_perm.can_consult
      WHEN 'create' THEN v_role_perm.can_create
      WHEN 'edit' THEN v_role_perm.can_edit
      WHEN 'delete' THEN v_role_perm.can_delete
      WHEN 'admin' THEN v_role_perm.can_admin
      ELSE false
    END;
    RETURN COALESCE(v_granted, false);
  END IF;

  RETURN false;
END;
$$;

-- --------------------------------------------------------------------
-- 6. TRIGGER ANTI-ELEVAÇÃO DE PRIVILÉGIOS EM PUBLIC.USER_PROFILES
-- --------------------------------------------------------------------

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

  -- Operações executadas por service_role (Edge Functions administrativas ou SQL admin)
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

  -- Impedir que qualquer não-super_admin crie ou promova alguém para super_admin
  IF NEW.role_code = 'super_admin' AND v_actor_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Elevação de privilégio bloqueada: apenas super_admin pode atribuir papel super_admin.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_actor_role <> 'super_admin' AND NEW.organization_id <> v_actor_org THEN
      RAISE EXCEPTION 'Isolamento multi-tenant: não é permitido criar usuário em outra organização.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Impedir alteração do próprio papel, organização ou status de ativação (exceto super_admin)
    IF OLD.user_id = auth.uid() AND v_actor_role <> 'super_admin' THEN
      IF NEW.role_code IS DISTINCT FROM OLD.role_code
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.is_active IS DISTINCT FROM OLD.is_active
         OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'Segurança RBAC: usuário não pode alterar seu próprio papel, organização ou status.';
      END IF;
    END IF;

    -- Impedir Clinic Admin / Branch Admin de tocar outra organização ou editar um Super Admin
    IF v_actor_role <> 'super_admin' THEN
      IF OLD.organization_id <> v_actor_org OR NEW.organization_id <> v_actor_org THEN
        RAISE EXCEPTION 'Isolamento multi-tenant: alteração não permitida fora da própria organização.';
      END IF;
      IF OLD.role_code = 'super_admin' THEN
        RAISE EXCEPTION 'Acesso negado: apenas super_admin pode modificar outro super_admin.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_protect_escalation ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_protect_escalation
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_profile_privilege_escalation();

-- --------------------------------------------------------------------
-- 7. POLÍTICAS RLS ESTRITAS (SEM USING (true) OU WITH CHECK (true))
-- --------------------------------------------------------------------

-- 7.1 Roles (leitura por usuários autenticados ativos)
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Roles authenticated read" ON public.roles;
CREATE POLICY "Roles authenticated read" ON public.roles
  FOR SELECT
  USING (public.medsync_is_active_user());

-- 7.2 Organizations & Branches & Professionals (leitura pública restrita a catálogo ativo apenas se necessário + escrita restrita)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Organizations read access" ON public.organizations;
DROP POLICY IF EXISTS "Organizations authenticated read" ON public.organizations;
CREATE POLICY "Organizations authenticated read" ON public.organizations
  FOR SELECT
  USING (
    public.medsync_is_super_admin()
    OR id = public.medsync_current_org_id()
    OR status IN ('active', 'trial')
  );

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Branches tenant read" ON public.branches;
DROP POLICY IF EXISTS "Branches write access" ON public.branches;
CREATE POLICY "Branches tenant read" ON public.branches
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    OR (is_active = true AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND o.status IN ('active', 'trial')))
  );

CREATE POLICY "Branches write access" ON public.branches
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('settings', 'admin')
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('settings', 'admin')
  );

-- 7.3 User Profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User profiles read" ON public.user_profiles;
DROP POLICY IF EXISTS "User profiles insert" ON public.user_profiles;
DROP POLICY IF EXISTS "User profiles update" ON public.user_profiles;
DROP POLICY IF EXISTS "User profiles delete" ON public.user_profiles;

CREATE POLICY "User profiles read" ON public.user_profiles
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND (
        public.medsync_has_menu_permission('users', 'consult')
        OR public.medsync_current_role() IN ('clinic_admin', 'branch_admin')
      )
    )
  );

CREATE POLICY "User profiles insert" ON public.user_profiles
  FOR INSERT
  WITH CHECK (
    public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'create')
      AND role_code <> 'super_admin'
    )
  );

CREATE POLICY "User profiles update" ON public.user_profiles
  FOR UPDATE
  USING (
    public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'edit')
      AND role_code <> 'super_admin'
    )
  )
  WITH CHECK (
    public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'edit')
      AND role_code <> 'super_admin'
    )
  );

CREATE POLICY "User profiles delete" ON public.user_profiles
  FOR DELETE
  USING (public.medsync_is_super_admin());

-- 7.4 User Branch Access
ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User branch access read" ON public.user_branch_access;
DROP POLICY IF EXISTS "User branch access write" ON public.user_branch_access;

CREATE POLICY "User branch access read" ON public.user_branch_access
  FOR SELECT
  USING (
    user_profile_id = public.medsync_current_user_profile_id()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'consult')
    )
  );

CREATE POLICY "User branch access write" ON public.user_branch_access
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'edit')
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'edit')
  );

-- 7.5 Role Permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Role permissions read" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions write" ON public.role_permissions;

CREATE POLICY "Role permissions read" ON public.role_permissions
  FOR SELECT
  USING (
    public.medsync_is_active_user()
    AND (
      organization_id IS NULL
      OR public.medsync_can_access_org(organization_id)
    )
  );

CREATE POLICY "Role permissions write" ON public.role_permissions
  FOR ALL
  USING (
    public.medsync_is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'admin')
      AND role_code <> 'super_admin'
    )
  )
  WITH CHECK (
    public.medsync_is_super_admin()
    OR (
      organization_id IS NOT NULL
      AND public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'admin')
      AND role_code <> 'super_admin'
    )
  );

-- 7.6 User Menu Permissions
ALTER TABLE public.user_menu_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User menu permissions read" ON public.user_menu_permissions;
DROP POLICY IF EXISTS "User menu permissions write" ON public.user_menu_permissions;

CREATE POLICY "User menu permissions read" ON public.user_menu_permissions
  FOR SELECT
  USING (
    user_profile_id = public.medsync_current_user_profile_id()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'consult')
    )
  );

CREATE POLICY "User menu permissions write" ON public.user_menu_permissions
  FOR ALL
  USING (
    public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'admin')
      AND user_profile_id <> public.medsync_current_user_profile_id()
    )
  )
  WITH CHECK (
    public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_has_menu_permission('users', 'admin')
      AND user_profile_id <> public.medsync_current_user_profile_id()
    )
  );

-- 7.7 Professionals & Professional Branches & Specialties
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Specialties read" ON public.specialties;
DROP POLICY IF EXISTS "Specialties write" ON public.specialties;
CREATE POLICY "Specialties read" ON public.specialties
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    OR is_active = true
  );
CREATE POLICY "Specialties write" ON public.specialties
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND (public.medsync_has_menu_permission('users', 'edit') OR public.medsync_has_menu_permission('settings', 'edit'))
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (public.medsync_has_menu_permission('users', 'edit') OR public.medsync_has_menu_permission('settings', 'edit'))
  );

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Professionals tenant read" ON public.professionals;
DROP POLICY IF EXISTS "Professionals tenant insert" ON public.professionals;
DROP POLICY IF EXISTS "Professionals tenant update" ON public.professionals;
DROP POLICY IF EXISTS "Professionals tenant delete" ON public.professionals;

CREATE POLICY "Professionals tenant read" ON public.professionals
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    OR (is_active = true AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND o.status IN ('active', 'trial')))
  );

CREATE POLICY "Professionals tenant insert" ON public.professionals
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'create')
  );

CREATE POLICY "Professionals tenant update" ON public.professionals
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'edit')
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'edit')
  );

ALTER TABLE public.professional_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Professional branches read" ON public.professional_branches;
DROP POLICY IF EXISTS "Professional branches write" ON public.professional_branches;

CREATE POLICY "Professional branches read" ON public.professional_branches
  FOR SELECT
  USING (public.medsync_can_access_org(organization_id));

CREATE POLICY "Professional branches write" ON public.professional_branches
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'edit')
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('users', 'edit')
  );

-- 7.8 Hardening de Pacientes, Agenda, Prontuários e Storage Privado por Papel/Menu e Filial
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for patients" ON public.patients;
DROP POLICY IF EXISTS "Patients select strict" ON public.patients;
DROP POLICY IF EXISTS "Patients insert strict" ON public.patients;
DROP POLICY IF EXISTS "Patients update strict" ON public.patients;

CREATE POLICY "Patients select strict" ON public.patients
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('patients', 'consult')
      OR public.medsync_has_menu_permission('medical_records', 'consult')
      OR public.medsync_has_menu_permission('appointments', 'consult')
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

CREATE POLICY "Patients insert strict" ON public.patients
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('patients', 'create')
    AND public.medsync_user_has_branch_access(organization_id, origin_branch_id)
  );

CREATE POLICY "Patients update strict" ON public.patients
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('patients', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, origin_branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('patients', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, origin_branch_id)
  );

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for appointments" ON public.appointments;
DROP POLICY IF EXISTS "Appointments select strict" ON public.appointments;
DROP POLICY IF EXISTS "Appointments insert strict" ON public.appointments;
DROP POLICY IF EXISTS "Appointments update strict" ON public.appointments;

CREATE POLICY "Appointments select strict" ON public.appointments
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('appointments', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Appointments insert strict" ON public.appointments
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('appointments', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Appointments update strict" ON public.appointments
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('appointments', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('appointments', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

-- Prontuário Eletrônico & Documentos Médicos: bloqueado para quem não tem permissão em medical_records
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Medical records select" ON public.medical_records;
DROP POLICY IF EXISTS "Medical records insert" ON public.medical_records;
DROP POLICY IF EXISTS "Medical records update draft only" ON public.medical_records;

CREATE POLICY "Medical records select" ON public.medical_records
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Medical records insert" ON public.medical_records
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Medical records update draft only" ON public.medical_records
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
    AND is_signed = false
    AND status = 'draft'
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

ALTER TABLE public.medical_record_addendums ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Medical addendums select" ON public.medical_record_addendums;
DROP POLICY IF EXISTS "Medical addendums insert" ON public.medical_record_addendums;

CREATE POLICY "Medical addendums select" ON public.medical_record_addendums
  FOR SELECT
  USING (
    public.medsync_has_menu_permission('medical_records', 'consult')
    AND EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
        AND public.medsync_can_access_org(mr.organization_id)
        AND public.medsync_user_has_branch_access(mr.organization_id, mr.branch_id)
    )
  );

CREATE POLICY "Medical addendums insert" ON public.medical_record_addendums
  FOR INSERT
  WITH CHECK (
    public.medsync_has_menu_permission('medical_records', 'edit')
    AND EXISTS (
      SELECT 1 FROM public.medical_records mr
      WHERE mr.id = record_id
        AND public.medsync_can_access_org(mr.organization_id)
        AND public.medsync_user_has_branch_access(mr.organization_id, mr.branch_id)
    )
  );

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for prescriptions" ON public.prescriptions;
CREATE POLICY "Tenant isolation for prescriptions" ON public.prescriptions
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

ALTER TABLE public.medical_certificates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for medical_certificates" ON public.medical_certificates;
CREATE POLICY "Tenant isolation for medical_certificates" ON public.medical_certificates
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for lab_orders" ON public.lab_orders;
CREATE POLICY "Tenant isolation for lab_orders" ON public.lab_orders
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for exam_results" ON public.exam_results;
CREATE POLICY "Tenant isolation for exam_results" ON public.exam_results
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for medical_documents" ON public.medical_documents;
CREATE POLICY "Tenant isolation for medical_documents" ON public.medical_documents
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('medical_records', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

-- Storage privado 'medical-documents': exige permissão em medical_records
DROP POLICY IF EXISTS "MedSync private medical-documents select" ON storage.objects;
CREATE POLICY "MedSync private medical-documents select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
    AND public.medsync_has_menu_permission('medical_records', 'consult')
  );

DROP POLICY IF EXISTS "MedSync private medical-documents insert" ON storage.objects;
CREATE POLICY "MedSync private medical-documents insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
    AND public.medsync_has_menu_permission('medical_records', 'create')
  );

DROP POLICY IF EXISTS "MedSync private medical-documents update" ON storage.objects;
CREATE POLICY "MedSync private medical-documents update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
    AND public.medsync_has_menu_permission('medical_records', 'edit')
  )
  WITH CHECK (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
    AND public.medsync_has_menu_permission('medical_records', 'edit')
  );

DROP POLICY IF EXISTS "MedSync private medical-documents delete" ON storage.objects;
CREATE POLICY "MedSync private medical-documents delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'medical-documents'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.medsync_can_access_org(((storage.foldername(name))[1])::uuid)
    AND public.medsync_has_menu_permission('medical_records', 'edit')
  );

-- Audit Logs: leitura restrita a administradores da organização; inserção para usuários ativos da org
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs select" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs insert" ON public.audit_logs;

CREATE POLICY "Audit logs select" ON public.audit_logs
  FOR SELECT
  USING (
    public.medsync_is_super_admin()
    OR (
      public.medsync_can_access_org(organization_id)
      AND public.medsync_current_role() IN ('clinic_admin', 'branch_admin')
    )
  );

CREATE POLICY "Audit logs insert" ON public.audit_logs
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_is_active_user()
  );

-- --------------------------------------------------------------------
-- 8. RPCS SEGURAS (SESSÃO RBAC, SALVAMENTO ATÔMICO COM AUDITORIA E AGENDA PÚBLICA)
-- --------------------------------------------------------------------

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

  SELECT to_jsonb(o.*) INTO v_org
  FROM public.organizations o
  WHERE o.id = v_profile.organization_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(b.*) ORDER BY b.is_headquarters DESC, b.name ASC), '[]'::jsonb)
  INTO v_branches
  FROM public.branches b
  WHERE b.organization_id = v_profile.organization_id;

  SELECT COALESCE(jsonb_agg(uba.branch_id), '[]'::jsonb)
  INTO v_auth_branches
  FROM public.user_branch_access uba
  WHERE uba.user_profile_id = v_profile.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(rp.*)), '[]'::jsonb)
  INTO v_role_perms
  FROM public.role_permissions rp
  WHERE rp.organization_id IS NULL OR rp.organization_id = v_profile.organization_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ump.*)), '[]'::jsonb)
  INTO v_user_perms
  FROM public.user_menu_permissions ump
  WHERE ump.user_profile_id = v_profile.id;

  RETURN jsonb_build_object(
    'authenticated', true,
    'profile_found', true,
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

  IF v_actor.role_code <> 'super_admin' THEN
    IF v_target.organization_id <> v_actor.organization_id THEN
      RAISE EXCEPTION 'Isolamento multi-tenant: não é permitido alterar usuários de outra organização.';
    END IF;
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

  UPDATE public.user_profiles
  SET
    full_name = COALESCE(NULLIF(trim(p_full_name), ''), full_name),
    phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
    role_code = p_role_code,
    default_branch_id = p_default_branch_id,
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = v_target.id;

  -- Sincronizar filiais autorizadas
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

  -- Sincronizar permissões individuais de menu (limitadas às atribuições do ator quando não for super_admin)
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

  -- Auditoria obrigatória de alteração de papel e permissão
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

GRANT EXECUTE ON FUNCTION public.medsync_save_user_rbac(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, UUID[], JSONB) TO authenticated;

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

  IF v_actor.role_code <> 'super_admin' THEN
    IF p_organization_id <> v_actor.organization_id THEN
      RAISE EXCEPTION 'Isolamento multi-tenant: não é permitido alterar papéis de outra organização.';
    END IF;
    IF p_role_code = 'super_admin' THEN
      RAISE EXCEPTION 'O modelo de permissões do papel super_admin não pode ser alterado por administradores de clínica.';
    END IF;
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

GRANT EXECUTE ON FUNCTION public.medsync_save_role_permissions(UUID, TEXT, JSONB) TO authenticated;

-- RPC segura para o portal público de agendamento (agenda.drnewtonmureb.com.br)
-- Evita exposição de SELECT público em public.patients e public.appointments
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

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Clínica não encontrada.');
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

GRANT EXECUTE ON FUNCTION public.medsync_public_book_appointment(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO anon, authenticated;
