-- ============================================================================
-- MIGRAÇÃO: PAINEL DE CHAMADA E CONTROLE DE ATENDIMENTOS MÉDICOS
-- MedSync SaaS — Clínica Dr. Newton Mureb
-- ============================================================================
-- Objetivos:
--   1. Estruturar tabelas reais para ciclo de vida de chamadas e atendimentos
--      (attendance_calls), histórico de eventos (attendance_call_events) e
--      configurações do painel (call_panel_settings).
--   2. Garantir invariantes de máquina de estados, timestamps do servidor e
--      bloqueio transacional contra atendimentos simultâneos do mesmo médico.
--   3. Prover RPCs atômicas (SECURITY DEFINER) para CHAMAR, INICIAR (manual e
--      automático por timestamp), CONCLUIR e CANCELAR com auditoria.
--   4. Integrar permissão RBAC 'call_panel', corrigir RLS de public.rooms e
--      habilitar Supabase Realtime nas tabelas operacionais do painel.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CORRIGIR RLS DE PUBLIC.ROOMS E GARANTIR SALA PADRÃO POR FILIAL ATIVA
-- ----------------------------------------------------------------------------

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rooms tenant read" ON public.rooms;
DROP POLICY IF EXISTS "Rooms tenant write" ON public.rooms;

CREATE POLICY "Rooms tenant read" ON public.rooms
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_is_active_user()
    AND (
      public.medsync_has_menu_permission('call_panel', 'consult')
      OR public.medsync_has_menu_permission('appointments', 'consult')
      OR public.medsync_has_menu_permission('dashboard', 'consult')
      OR public.medsync_has_menu_permission('settings', 'consult')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Rooms tenant write" ON public.rooms
  FOR ALL
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_has_menu_permission('settings', 'admin')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('settings', 'edit')
      OR public.medsync_has_menu_permission('settings', 'admin')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

-- Garantir ao menos um consultório cadastrado para filiais ativas que não tenham sala
INSERT INTO public.rooms (organization_id, branch_id, name, description, color, is_active)
SELECT
  b.organization_id,
  b.id,
  'Consultório 01',
  'Consultório médico principal para atendimento clínico',
  '#0284c7',
  true
FROM public.branches b
WHERE b.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.branch_id = b.id
  );

-- ----------------------------------------------------------------------------
-- 2. INTEGRAÇÃO RBAC DO MÓDULO 'call_panel'
-- ----------------------------------------------------------------------------

INSERT INTO public.role_permissions (
  organization_id, role_code, menu_key, can_view, can_consult, can_create, can_edit, can_delete, can_admin
)
VALUES
  (NULL, 'super_admin',     'call_panel', true,  true,  true,  true,  true,  true),
  (NULL, 'clinic_admin',    'call_panel', true,  true,  true,  true,  true,  true),
  (NULL, 'branch_admin',    'call_panel', true,  true,  true,  true,  false, false),
  (NULL, 'doctor',          'call_panel', true,  true,  true,  true,  false, false),
  (NULL, 'physiotherapist', 'call_panel', true,  true,  true,  true,  false, false),
  (NULL, 'receptionist',    'call_panel', true,  true,  true,  true,  false, false),
  (NULL, 'financial',       'call_panel', false, false, false, false, false, false),
  (NULL, 'patient',         'call_panel', false, false, false, false, false, false)
ON CONFLICT (
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  role_code,
  menu_key
) DO NOTHING;

-- Atualizar medsync_has_menu_permission preservando todas as regras existentes e incluindo 'call_panel' para super_admin
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
    IF p_menu_key IN (
      'dashboard', 'users', 'settings', 'appointments', 'call_panel',
      'patients', 'communication', 'website_builder', 'financial'
    ) THEN
      RETURN true;
    END IF;
    IF p_menu_key = 'medical_records' AND p_action IN ('view', 'consult', 'admin') THEN
      RETURN true;
    END IF;
  END IF;

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

-- ----------------------------------------------------------------------------
-- 3. TABELAS DO PAINEL DE CHAMADA E CONTROLE DE ATENDIMENTOS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,

  patient_name_snapshot VARCHAR(160) NOT NULL,
  professional_name_snapshot VARCHAR(160) NOT NULL,
  room_name_snapshot VARCHAR(120) NOT NULL DEFAULT 'Consultório 01',
  procedure_name_snapshot VARCHAR(160) NOT NULL DEFAULT 'Consulta Médica',
  attendance_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),

  status VARCHAR(24) NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando', 'chamado', 'em_andamento', 'concluido', 'cancelado')),

  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),

  start_origin VARCHAR(20) CHECK (start_origin IS NULL OR start_origin IN ('manual', 'automatic')),
  end_origin VARCHAR(20) CHECK (end_origin IS NULL OR end_origin IN ('manual', 'automatic')),
  auto_end_reason VARCHAR(60),
  call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  auto_start_delay_seconds INTEGER NOT NULL DEFAULT 120 CHECK (auto_start_delay_seconds BETWEEN 15 AND 1800),

  last_called_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  started_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ended_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  cancelled_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_attendance_calls_timestamps CHECK (
    (ended_at IS NULL OR started_at IS NOT NULL)
    AND (ended_at IS NULL OR ended_at >= started_at)
  )
);

-- Índices únicos parciais garantindo invariantes de concorrência no banco
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_calls_one_active_per_prof
  ON public.attendance_calls (organization_id, professional_id)
  WHERE status = 'em_andamento';

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_calls_one_called_per_prof
  ON public.attendance_calls (organization_id, professional_id)
  WHERE status = 'chamado';

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_calls_one_open_per_appt
  ON public.attendance_calls (appointment_id)
  WHERE status IN ('aguardando', 'chamado', 'em_andamento');

CREATE INDEX IF NOT EXISTS idx_attendance_calls_org_date_status
  ON public.attendance_calls (organization_id, branch_id, attendance_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_attendance_calls_org_prof_status
  ON public.attendance_calls (organization_id, professional_id, status, ended_at DESC);

DROP TRIGGER IF EXISTS trg_attendance_calls_updated_at ON public.attendance_calls;
CREATE TRIGGER trg_attendance_calls_updated_at
  BEFORE UPDATE ON public.attendance_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- Histórico append-only de chamadas e transições
CREATE TABLE IF NOT EXISTS public.attendance_call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  attendance_call_id UUID NOT NULL REFERENCES public.attendance_calls(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,

  patient_name VARCHAR(160) NOT NULL,
  professional_name VARCHAR(160) NOT NULL,
  room_name VARCHAR(120) NOT NULL,
  procedure_name VARCHAR(160) NOT NULL DEFAULT 'Consulta Médica',

  event_type VARCHAR(30) NOT NULL CHECK (
    event_type IN (
      'called',
      'recalled',
      'started_manual',
      'started_auto',
      'completed_manual',
      'completed_auto',
      'cancelled'
    )
  ),
  actor_user_profile_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_name VARCHAR(150),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_call_events_org_created
  ON public.attendance_call_events (organization_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_call_events_session
  ON public.attendance_call_events (attendance_call_id, created_at ASC);

-- Configurações do Painel de Chamada persistidas no Supabase
CREATE TABLE IF NOT EXISTS public.call_panel_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  default_professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  default_room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  physician_display_label VARCHAR(160),
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  voice_enabled BOOLEAN NOT NULL DEFAULT true,
  chime_volume NUMERIC(3,2) NOT NULL DEFAULT 0.70 CHECK (chime_volume >= 0 AND chime_volume <= 1),
  auto_start_delay_seconds INTEGER NOT NULL DEFAULT 120 CHECK (auto_start_delay_seconds BETWEEN 15 AND 1800),
  patient_name_display_mode VARCHAR(20) NOT NULL DEFAULT 'full'
    CHECK (patient_name_display_mode IN ('full', 'first_last', 'initials')),
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_panel_settings_org_branch
  ON public.call_panel_settings (
    organization_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

DROP TRIGGER IF EXISTS trg_call_panel_settings_updated_at ON public.call_panel_settings;
CREATE TRIGGER trg_call_panel_settings_updated_at
  BEFORE UPDATE ON public.call_panel_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. POLÍTICAS RLS ESTRITAS (ISOLAMENTO MULTI-TENANT + FILIAL + RBAC)
-- ----------------------------------------------------------------------------

ALTER TABLE public.attendance_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_panel_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Attendance calls select strict" ON public.attendance_calls;
DROP POLICY IF EXISTS "Attendance calls write blocked direct" ON public.attendance_calls;

CREATE POLICY "Attendance calls select strict" ON public.attendance_calls
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('call_panel', 'consult')
      OR public.medsync_has_menu_permission('dashboard', 'consult')
      OR public.medsync_has_menu_permission('appointments', 'consult')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

DROP POLICY IF EXISTS "Attendance call events select strict" ON public.attendance_call_events;

CREATE POLICY "Attendance call events select strict" ON public.attendance_call_events
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('call_panel', 'consult')
      OR public.medsync_has_menu_permission('dashboard', 'consult')
      OR public.medsync_has_menu_permission('appointments', 'consult')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

DROP POLICY IF EXISTS "Call panel settings select strict" ON public.call_panel_settings;
DROP POLICY IF EXISTS "Call panel settings upsert strict" ON public.call_panel_settings;
DROP POLICY IF EXISTS "Call panel settings update strict" ON public.call_panel_settings;

CREATE POLICY "Call panel settings select strict" ON public.call_panel_settings
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('call_panel', 'consult')
      OR public.medsync_has_menu_permission('call_panel', 'view')
      OR public.medsync_has_menu_permission('settings', 'consult')
    )
    AND (branch_id IS NULL OR public.medsync_user_has_branch_access(organization_id, branch_id))
  );

CREATE POLICY "Call panel settings upsert strict" ON public.call_panel_settings
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('call_panel', 'edit')
      OR public.medsync_has_menu_permission('call_panel', 'admin')
      OR public.medsync_has_menu_permission('settings', 'edit')
    )
    AND (branch_id IS NULL OR public.medsync_user_has_branch_access(organization_id, branch_id))
  );

CREATE POLICY "Call panel settings update strict" ON public.call_panel_settings
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('call_panel', 'edit')
      OR public.medsync_has_menu_permission('call_panel', 'admin')
      OR public.medsync_has_menu_permission('settings', 'edit')
    )
    AND (branch_id IS NULL OR public.medsync_user_has_branch_access(organization_id, branch_id))
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('call_panel', 'edit')
      OR public.medsync_has_menu_permission('call_panel', 'admin')
      OR public.medsync_has_menu_permission('settings', 'edit')
    )
    AND (branch_id IS NULL OR public.medsync_user_has_branch_access(organization_id, branch_id))
  );

-- ----------------------------------------------------------------------------
-- 5. RPCS TRANSACIONAIS (CHAMAR, INICIAR MANUAL/AUTO, CONCLUIR, CANCELAR)
-- ----------------------------------------------------------------------------

-- 5.1 Helper interno para validar ator e acesso
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

-- 5.2 CHAMAR PACIENTE (próximo da fila ou agendamento específico; suporta rechamada e autoencerramento atômico)
CREATE OR REPLACE FUNCTION public.medsync_call_panel_call_patient(
  p_organization_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_professional_id UUID DEFAULT NULL,
  p_room_id UUID DEFAULT NULL,
  p_appointment_id UUID DEFAULT NULL,
  p_confirm_auto_close BOOLEAN DEFAULT false,
  p_allow_recall BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.user_profiles;
  v_now TIMESTAMPTZ := now();
  v_today_sp DATE := (v_now AT TIME ZONE 'America/Sao_Paulo')::date;
  v_prof_id UUID := p_professional_id;
  v_branch_id UUID := p_branch_id;
  v_room_id UUID := p_room_id;
  v_appt RECORD;
  v_active_in_progress RECORD;
  v_active_called RECORD;
  v_closed_session JSONB := NULL;
  v_auto_delay INTEGER := 120;
  v_patient_name TEXT;
  v_prof_name TEXT;
  v_room_name TEXT;
  v_procedure_name TEXT;
  v_call_row public.attendance_calls;
  v_event_type TEXT := 'called';
  v_duration_secs INTEGER;
BEGIN
  -- 1. Se p_appointment_id informado, resolve org/branch/prof a partir dele com segurança
  IF p_appointment_id IS NOT NULL THEN
    SELECT a.*
    INTO v_appt
    FROM public.appointments a
    WHERE a.id = p_appointment_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'APPOINTMENT_NOT_FOUND', 'error', 'Agendamento não encontrado.');
    END IF;

    IF v_appt.organization_id <> p_organization_id THEN
      RAISE EXCEPTION 'TENANT_FORBIDDEN: Agendamento pertence a outra organização.';
    END IF;

    v_branch_id := v_appt.branch_id;
    v_prof_id := COALESCE(p_professional_id, v_appt.professional_id);
  END IF;

  v_actor := public.medsync_assert_call_panel_actor(p_organization_id, v_branch_id);

  IF v_prof_id IS NULL THEN
    SELECT pr.id INTO v_prof_id
    FROM public.professionals pr
    WHERE pr.organization_id = p_organization_id AND pr.is_active = true
    ORDER BY pr.created_at ASC
    LIMIT 1;
  END IF;

  IF v_prof_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PROFESSIONAL_REQUIRED', 'error', 'Selecione um médico ativo para realizar a chamada.');
  END IF;

  -- Trava transacional por organização + médico contra cliques concorrentes
  PERFORM pg_advisory_xact_lock(hashtext('call_panel:' || p_organization_id::text || ':' || v_prof_id::text));

  -- Buscar configuração de auto-início do painel (default 120s)
  SELECT COALESCE(cps.auto_start_delay_seconds, 120)
  INTO v_auto_delay
  FROM public.call_panel_settings cps
  WHERE cps.organization_id = p_organization_id
    AND (cps.branch_id = v_branch_id OR cps.branch_id IS NULL)
  ORDER BY (cps.branch_id IS NOT NULL) DESC
  LIMIT 1;
  v_auto_delay := COALESCE(v_auto_delay, 120);

  -- Selecionar próximo agendamento elegível na fila caso p_appointment_id seja NULL
  IF p_appointment_id IS NULL THEN
    SELECT a.*
    INTO v_appt
    FROM public.appointments a
    WHERE a.organization_id = p_organization_id
      AND a.professional_id = v_prof_id
      AND (v_branch_id IS NULL OR a.branch_id = v_branch_id)
      AND (a.start_time AT TIME ZONE 'America/Sao_Paulo')::date = v_today_sp
      AND a.status IN ('waiting_room', 'confirmed', 'scheduled')
      AND NOT EXISTS (
        SELECT 1
        FROM public.attendance_calls ac
        WHERE ac.appointment_id = a.id
          AND ac.status IN ('em_andamento', 'concluido')
      )
    ORDER BY
      CASE a.status
        WHEN 'waiting_room' THEN 0
        WHEN 'confirmed' THEN 1
        ELSE 2
      END,
      a.start_time ASC,
      a.created_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'QUEUE_EMPTY',
        'error', 'Não há pacientes elegíveis aguardando na fila de hoje para este médico.'
      );
    END IF;
    v_branch_id := v_appt.branch_id;
  ELSE
    IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'APPOINTMENT_TERMINAL',
        'error', 'Este agendamento está finalizado, cancelado ou marcado como falta.'
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.attendance_calls ac
      WHERE ac.appointment_id = v_appt.id
        AND ac.status IN ('em_andamento', 'concluido')
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'APPOINTMENT_ALREADY_ATTENDED',
        'error', 'Este agendamento já possui atendimento em andamento ou concluído.'
      );
    END IF;
  END IF;

  -- Validar se já existe atendimento EM ANDAMENTO para o MESMO médico
  SELECT *
  INTO v_active_in_progress
  FROM public.attendance_calls ac
  WHERE ac.organization_id = p_organization_id
    AND ac.professional_id = v_prof_id
    AND ac.status = 'em_andamento'
  FOR UPDATE;

  IF FOUND THEN
    IF p_confirm_auto_close IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'ACTIVE_CONSULTATION_EXISTS',
        'error', 'Existe um atendimento em andamento para este médico. Ao chamar outro paciente, o atendimento atual será encerrado automaticamente. Deseja continuar?',
        'active_attendance', to_jsonb(v_active_in_progress)
      );
    END IF;

    v_duration_secs := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - v_active_in_progress.started_at)))::integer);

    UPDATE public.attendance_calls
    SET
      status = 'concluido',
      ended_at = v_now,
      duration_seconds = v_duration_secs,
      end_origin = 'automatic',
      auto_end_reason = 'new_call_started',
      ended_by = v_actor.id,
      updated_at = v_now
    WHERE id = v_active_in_progress.id
    RETURNING to_jsonb(attendance_calls.*) INTO v_closed_session;

    UPDATE public.appointments
    SET status = 'completed', updated_at = v_now
    WHERE id = v_active_in_progress.appointment_id;

    INSERT INTO public.attendance_call_events (
      organization_id, branch_id, attendance_call_id, appointment_id, patient_id, professional_id,
      room_id, patient_name, professional_name, room_name, procedure_name,
      event_type, actor_user_profile_id, actor_name, notes
    )
    VALUES (
      v_active_in_progress.organization_id, v_active_in_progress.branch_id, v_active_in_progress.id,
      v_active_in_progress.appointment_id, v_active_in_progress.patient_id, v_active_in_progress.professional_id,
      v_active_in_progress.room_id, v_active_in_progress.patient_name_snapshot, v_active_in_progress.professional_name_snapshot,
      v_active_in_progress.room_name_snapshot, v_active_in_progress.procedure_name_snapshot,
      'completed_auto', v_actor.id, v_actor.full_name,
      'Encerrado automaticamente ao chamar próximo paciente.'
    );
  END IF;

  -- Resolver snapshots reais de paciente, médico, procedimento e sala
  SELECT COALESCE(NULLIF(trim(p.social_name), ''), p.full_name)
  INTO v_patient_name
  FROM public.patients p
  WHERE p.id = v_appt.patient_id;

  SELECT pr.full_name
  INTO v_prof_name
  FROM public.professionals pr
  WHERE pr.id = v_prof_id;

  v_room_id := COALESCE(p_room_id, v_appt.room_id);
  IF v_room_id IS NULL THEN
    SELECT r.id INTO v_room_id
    FROM public.rooms r
    WHERE r.organization_id = p_organization_id
      AND r.branch_id = v_branch_id
      AND r.is_active = true
    ORDER BY r.created_at ASC
    LIMIT 1;
  END IF;

  IF v_room_id IS NOT NULL THEN
    SELECT r.name INTO v_room_name FROM public.rooms r WHERE r.id = v_room_id;
  END IF;
  v_room_name := COALESCE(NULLIF(trim(v_room_name), ''), 'Consultório 01');

  IF v_appt.service_id IS NOT NULL THEN
    SELECT s.name INTO v_procedure_name FROM public.services s WHERE s.id = v_appt.service_id;
  END IF;
  v_procedure_name := COALESCE(NULLIF(trim(v_procedure_name), ''), 'Consulta Médica');

  -- Verificar se já há um CHAMADO ativo para o mesmo médico
  SELECT *
  INTO v_active_called
  FROM public.attendance_calls ac
  WHERE ac.organization_id = p_organization_id
    AND ac.professional_id = v_prof_id
    AND ac.status = 'chamado'
  FOR UPDATE;

  IF FOUND THEN
    IF v_active_called.appointment_id = v_appt.id THEN
      IF p_allow_recall IS NOT TRUE THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'ALREADY_CALLED_SAME_PATIENT',
          'error', 'Este paciente já está sendo chamado no painel. Confirme se deseja chamar novamente.',
          'attendance', to_jsonb(v_active_called)
        );
      END IF;

      UPDATE public.attendance_calls
      SET
        room_id = v_room_id,
        room_name_snapshot = v_room_name,
        called_at = v_now,
        call_count = call_count + 1,
        auto_start_delay_seconds = v_auto_delay,
        last_called_by = v_actor.id,
        updated_at = v_now
      WHERE id = v_active_called.id
      RETURNING * INTO v_call_row;

      v_event_type := 'recalled';
    ELSE
      -- Cancelar chamado anterior ainda não iniciado ao chamar outro paciente
      UPDATE public.attendance_calls
      SET
        status = 'cancelado',
        cancelled_by = v_actor.id,
        cancellation_reason = 'Substituído pela chamada do próximo paciente.',
        updated_at = v_now
      WHERE id = v_active_called.id;

      INSERT INTO public.attendance_call_events (
        organization_id, branch_id, attendance_call_id, appointment_id, patient_id, professional_id,
        room_id, patient_name, professional_name, room_name, procedure_name,
        event_type, actor_user_profile_id, actor_name, notes
      )
      VALUES (
        v_active_called.organization_id, v_active_called.branch_id, v_active_called.id,
        v_active_called.appointment_id, v_active_called.patient_id, v_active_called.professional_id,
        v_active_called.room_id, v_active_called.patient_name_snapshot, v_active_called.professional_name_snapshot,
        v_active_called.room_name_snapshot, v_active_called.procedure_name_snapshot,
        'cancelled', v_actor.id, v_actor.full_name,
        'Chamada anterior substituída antes do início.'
      );
    END IF;
  END IF;

  IF v_call_row.id IS NULL THEN
    -- Caso exista linha em 'aguardando' para este agendamento, promove para 'chamado'; senão insere nova
    UPDATE public.attendance_calls
    SET
      professional_id = v_prof_id,
      room_id = v_room_id,
      patient_name_snapshot = COALESCE(v_patient_name, 'Paciente'),
      professional_name_snapshot = COALESCE(v_prof_name, 'Médico'),
      room_name_snapshot = v_room_name,
      procedure_name_snapshot = v_procedure_name,
      status = 'chamado',
      called_at = v_now,
      call_count = GREATEST(call_count, 0) + 1,
      auto_start_delay_seconds = v_auto_delay,
      last_called_by = v_actor.id,
      updated_at = v_now
    WHERE appointment_id = v_appt.id
      AND status = 'aguardando'
    RETURNING * INTO v_call_row;

    IF v_call_row.id IS NULL THEN
      INSERT INTO public.attendance_calls (
        organization_id, branch_id, appointment_id, patient_id, professional_id,
        room_id, service_id,
        patient_name_snapshot, professional_name_snapshot, room_name_snapshot, procedure_name_snapshot,
        attendance_date, status, called_at, call_count, auto_start_delay_seconds, last_called_by
      )
      VALUES (
        p_organization_id, v_branch_id, v_appt.id, v_appt.patient_id, v_prof_id,
        v_room_id, v_appt.service_id,
        COALESCE(v_patient_name, 'Paciente'),
        COALESCE(v_prof_name, 'Médico'),
        v_room_name,
        v_procedure_name,
        (v_appt.start_time AT TIME ZONE 'America/Sao_Paulo')::date,
        'chamado',
        v_now,
        1,
        v_auto_delay,
        v_actor.id
      )
      RETURNING * INTO v_call_row;
    END IF;

    v_event_type := 'called';
  END IF;

  -- Atualizar sala/status na agenda sem destruir dados existentes
  UPDATE public.appointments
  SET
    room_id = COALESCE(v_room_id, room_id),
    status = CASE WHEN status IN ('scheduled', 'confirmed') THEN 'waiting_room' ELSE status END,
    updated_at = v_now
  WHERE id = v_appt.id;

  -- Registrar evento no histórico
  INSERT INTO public.attendance_call_events (
    organization_id, branch_id, attendance_call_id, appointment_id, patient_id, professional_id,
    room_id, patient_name, professional_name, room_name, procedure_name,
    event_type, actor_user_profile_id, actor_name, notes
  )
  VALUES (
    v_call_row.organization_id, v_call_row.branch_id, v_call_row.id,
    v_call_row.appointment_id, v_call_row.patient_id, v_call_row.professional_id,
    v_call_row.room_id, v_call_row.patient_name_snapshot, v_call_row.professional_name_snapshot,
    v_call_row.room_name_snapshot, v_call_row.procedure_name_snapshot,
    v_event_type, v_actor.id, v_actor.full_name,
    CASE WHEN v_event_type = 'recalled' THEN 'Rechamada do paciente no painel.' ELSE 'Paciente chamado no painel.' END
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_type', v_event_type,
    'attendance', to_jsonb(v_call_row),
    'auto_closed_attendance', v_closed_session
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.medsync_call_panel_call_patient(UUID, UUID, UUID, UUID, UUID, BOOLEAN, BOOLEAN) TO authenticated;

-- 5.3 INICIAR ATENDIMENTO (manual ou automático idempotente baseado em called_at + auto_start_delay_seconds)
CREATE OR REPLACE FUNCTION public.medsync_call_panel_start_attendance(
  p_attendance_call_id UUID,
  p_origin TEXT DEFAULT 'manual'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.user_profiles;
  v_now TIMESTAMPTZ := now();
  v_row public.attendance_calls;
  v_due_at TIMESTAMPTZ;
  v_remaining INTEGER;
BEGIN
  IF p_origin NOT IN ('manual', 'automatic') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ORIGIN', 'error', 'Origem de início inválida.');
  END IF;

  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Chamada não encontrada.');
  END IF;

  v_actor := public.medsync_assert_call_panel_actor(v_row.organization_id, v_row.branch_id);

  PERFORM pg_advisory_xact_lock(hashtext('call_panel:' || v_row.organization_id::text || ':' || v_row.professional_id::text));

  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  FOR UPDATE;

  -- Idempotência: se já iniciado (manual ou auto), nunca reinicia nem grava evento duplicado
  IF v_row.status = 'em_andamento' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_started', true,
      'attendance', to_jsonb(v_row)
    );
  END IF;

  IF v_row.status <> 'chamado' OR v_row.called_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATE_TRANSITION',
      'error', 'Somente chamadas no status CHAMADO podem iniciar atendimento.'
    );
  END IF;

  IF p_origin = 'automatic' THEN
    v_due_at := v_row.called_at + make_interval(secs => COALESCE(v_row.auto_start_delay_seconds, 120));
    IF v_now < v_due_at THEN
      v_remaining := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_due_at - v_now)))::integer);
      RETURN jsonb_build_object(
        'success', false,
        'code', 'AUTO_START_NOT_DUE',
        'remaining_seconds', v_remaining,
        'error', 'Prazo de início automático ainda não atingido.'
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.attendance_calls other_ac
    WHERE other_ac.organization_id = v_row.organization_id
      AND other_ac.professional_id = v_row.professional_id
      AND other_ac.status = 'em_andamento'
      AND other_ac.id <> v_row.id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PHYSICIAN_BUSY',
      'error', 'Já existe outro atendimento em andamento para este médico.'
    );
  END IF;

  UPDATE public.attendance_calls
  SET
    status = 'em_andamento',
    started_at = v_now,
    start_origin = p_origin,
    started_by = v_actor.id,
    updated_at = v_now
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.appointments
  SET status = 'in_consultation', updated_at = v_now
  WHERE id = v_row.appointment_id;

  INSERT INTO public.attendance_call_events (
    organization_id, branch_id, attendance_call_id, appointment_id, patient_id, professional_id,
    room_id, patient_name, professional_name, room_name, procedure_name,
    event_type, actor_user_profile_id, actor_name, notes
  )
  VALUES (
    v_row.organization_id, v_row.branch_id, v_row.id,
    v_row.appointment_id, v_row.patient_id, v_row.professional_id,
    v_row.room_id, v_row.patient_name_snapshot, v_row.professional_name_snapshot,
    v_row.room_name_snapshot, v_row.procedure_name_snapshot,
    CASE WHEN p_origin = 'automatic' THEN 'started_auto' ELSE 'started_manual' END,
    v_actor.id,
    v_actor.full_name,
    CASE WHEN p_origin = 'automatic'
      THEN 'Atendimento iniciado automaticamente após prazo da chamada.'
      ELSE 'Atendimento iniciado manualmente.'
    END
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_started', false,
    'attendance', to_jsonb(v_row)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.medsync_call_panel_start_attendance(UUID, TEXT) TO authenticated;

-- 5.4 CONCLUIR ATENDIMENTO (manual com cálculo de duração no servidor)
CREATE OR REPLACE FUNCTION public.medsync_call_panel_complete_attendance(
  p_attendance_call_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.user_profiles;
  v_now TIMESTAMPTZ := now();
  v_row public.attendance_calls;
  v_duration_secs INTEGER;
BEGIN
  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Atendimento não encontrado.');
  END IF;

  v_actor := public.medsync_assert_call_panel_actor(v_row.organization_id, v_row.branch_id);

  PERFORM pg_advisory_xact_lock(hashtext('call_panel:' || v_row.organization_id::text || ':' || v_row.professional_id::text));

  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  FOR UPDATE;

  IF v_row.status = 'concluido' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_COMPLETED',
      'error', 'Este atendimento já foi concluído anteriormente.'
    );
  END IF;

  IF v_row.status <> 'em_andamento' OR v_row.started_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATE_TRANSITION',
      'error', 'Somente atendimentos em andamento podem ser concluídos.'
    );
  END IF;

  v_duration_secs := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - v_row.started_at)))::integer);

  UPDATE public.attendance_calls
  SET
    status = 'concluido',
    ended_at = v_now,
    duration_seconds = v_duration_secs,
    end_origin = 'manual',
    ended_by = v_actor.id,
    updated_at = v_now
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.appointments
  SET status = 'completed', updated_at = v_now
  WHERE id = v_row.appointment_id;

  INSERT INTO public.attendance_call_events (
    organization_id, branch_id, attendance_call_id, appointment_id, patient_id, professional_id,
    room_id, patient_name, professional_name, room_name, procedure_name,
    event_type, actor_user_profile_id, actor_name, notes
  )
  VALUES (
    v_row.organization_id, v_row.branch_id, v_row.id,
    v_row.appointment_id, v_row.patient_id, v_row.professional_id,
    v_row.room_id, v_row.patient_name_snapshot, v_row.professional_name_snapshot,
    v_row.room_name_snapshot, v_row.procedure_name_snapshot,
    'completed_manual', v_actor.id, v_actor.full_name,
    'Atendimento concluído manualmente.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'attendance', to_jsonb(v_row)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.medsync_call_panel_complete_attendance(UUID) TO authenticated;

-- 5.5 CANCELAR CHAMADA / FILA (AGUARDANDO -> CANCELADO ou CHAMADO -> CANCELADO)
CREATE OR REPLACE FUNCTION public.medsync_call_panel_cancel_attendance(
  p_attendance_call_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.user_profiles;
  v_now TIMESTAMPTZ := now();
  v_row public.attendance_calls;
  v_reason TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'Chamada cancelada pelo operador.');
BEGIN
  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Chamada não encontrada.');
  END IF;

  v_actor := public.medsync_assert_call_panel_actor(v_row.organization_id, v_row.branch_id);

  PERFORM pg_advisory_xact_lock(hashtext('call_panel:' || v_row.organization_id::text || ':' || v_row.professional_id::text));

  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  FOR UPDATE;

  IF v_row.status NOT IN ('aguardando', 'chamado') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATE_TRANSITION',
      'error', 'Somente atendimentos em Aguardando ou Chamado podem ser cancelados.'
    );
  END IF;

  UPDATE public.attendance_calls
  SET
    status = 'cancelado',
    cancelled_by = v_actor.id,
    cancellation_reason = v_reason,
    updated_at = v_now
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.attendance_call_events (
    organization_id, branch_id, attendance_call_id, appointment_id, patient_id, professional_id,
    room_id, patient_name, professional_name, room_name, procedure_name,
    event_type, actor_user_profile_id, actor_name, notes
  )
  VALUES (
    v_row.organization_id, v_row.branch_id, v_row.id,
    v_row.appointment_id, v_row.patient_id, v_row.professional_id,
    v_row.room_id, v_row.patient_name_snapshot, v_row.professional_name_snapshot,
    v_row.room_name_snapshot, v_row.procedure_name_snapshot,
    'cancelled', v_actor.id, v_actor.full_name, v_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'attendance', to_jsonb(v_row)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.medsync_call_panel_cancel_attendance(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. HABILITAR SUPABASE REALTIME NAS TABELAS DO PAINEL E AGENDA
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_calls;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_call_events;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.call_panel_settings;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;
