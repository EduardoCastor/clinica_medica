-- ============================================================================
-- MIGRAÇÃO: HARDENING DO INÍCIO AUTOMÁTICO DO PAINEL DE ATENDIMENTO
-- MedSync SaaS — Clínica Dr. Newton Mureb
-- ============================================================================
-- Preserva integralmente a assinatura e as regras de RLS/RBAC da RPC
-- `medsync_call_panel_start_attendance`, adicionando:
--   1. Retorno explícito de `server_now` e `due_at` em `AUTO_START_NOT_DUE`
--      para eliminar qualquer erro por diferença de relógio entre navegador e DB.
--   2. Guarda defensiva `AND status = 'chamado'` no UPDATE de `attendance_calls`.
--   3. Proteção contra alteração de agendamentos já em estado terminal.
-- ============================================================================

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
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_ORIGIN',
      'error', 'Origem de início inválida.'
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'error', 'Chamada não encontrada.'
    );
  END IF;

  v_actor := public.medsync_assert_call_panel_actor(v_row.organization_id, v_row.branch_id);

  -- Lock transacional por organização + médico contra concorrência (manual x automático x multi-usuário)
  PERFORM pg_advisory_xact_lock(
    hashtext('call_panel:' || v_row.organization_id::text || ':' || v_row.professional_id::text)
  );

  SELECT *
  INTO v_row
  FROM public.attendance_calls ac
  WHERE ac.id = p_attendance_call_id
  FOR UPDATE;

  -- Idempotência: se já iniciado (manual ou automático), nunca reinicia nem sobrescreve started_at/start_origin
  IF v_row.status = 'em_andamento' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_started', true,
      'attendance', to_jsonb(v_row)
    );
  END IF;

  -- Chamadas canceladas, concluídas ou sem horário de chamada jamais podem iniciar
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
        'server_now', v_now,
        'due_at', v_due_at,
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
    AND status = 'chamado'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATE_TRANSITION',
      'error', 'A chamada foi alterada concorrentemente antes do início.'
    );
  END IF;

  UPDATE public.appointments
  SET
    status = 'in_consultation',
    updated_at = v_now
  WHERE id = v_row.appointment_id
    AND status NOT IN ('cancelled', 'completed', 'no_show');

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
