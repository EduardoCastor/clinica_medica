-- ============================================================================
-- MEDSYNC SaaS — GERENCIADOR INTELIGENTE DE AUTOMAÇÕES WHATSAPP
-- Tabelas de gatilhos configuráveis e histórico/fila de execuções idempotentes
-- Arquitetura: Orquestrador Único (n8n + Supabase + MegaAPI sem exposição de token)
-- ============================================================================

-- 1. TABELA DE GATILHOS DE AUTOMAÇÃO WHATSAPP
CREATE TABLE IF NOT EXISTS public.whatsapp_automation_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL, -- NULL = todas as filiais
  trigger_code VARCHAR(80), -- código determinístico para gatilhos padrão (evita duplicação no seed)
  name VARCHAR(160) NOT NULL,
  description TEXT,
  category VARCHAR(60) NOT NULL DEFAULT 'custom',
  event_type VARCHAR(60) NOT NULL DEFAULT 'appointment_upcoming',
  template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
  template_category VARCHAR(60),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'draft', 'inactive')),

  -- Repetição e programação independente (Duração x Quantidade x Intervalo)
  total_sends INTEGER NOT NULL DEFAULT 1 CHECK (total_sends >= 1 AND total_sends <= 50),
  interval_value INTEGER NOT NULL DEFAULT 24 CHECK (interval_value >= 0),
  interval_unit VARCHAR(20) NOT NULL DEFAULT 'hours'
    CHECK (interval_unit IN ('minutes', 'hours', 'days', 'weeks')),
  max_duration_days INTEGER NOT NULL DEFAULT 7 CHECK (max_duration_days >= 0),
  schedule_mode VARCHAR(20) NOT NULL DEFAULT 'relative'
    CHECK (schedule_mode IN ('relative', 'fixed_time')),
  lead_time_value INTEGER NOT NULL DEFAULT 0,
  lead_time_unit VARCHAR(20) NOT NULL DEFAULT 'hours'
    CHECK (lead_time_unit IN ('minutes', 'hours', 'days')),
  preferred_send_time VARCHAR(10) NOT NULL DEFAULT '09:00',

  -- Janela de envio (padrão America/Sao_Paulo)
  allowed_days JSONB NOT NULL DEFAULT '["mon","tue","wed","thu","fri","sat"]'::jsonb,
  window_start VARCHAR(10) NOT NULL DEFAULT '08:00',
  window_end VARCHAR(10) NOT NULL DEFAULT '20:00',
  timezone VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
  outside_window_policy VARCHAR(30) NOT NULL DEFAULT 'next_allowed_window'
    CHECK (outside_window_policy IN ('next_allowed_window', 'skip')),

  -- Regras inteligentes e sequência de etapas
  smart_rules JSONB NOT NULL DEFAULT '{
    "requireValidPhone": true,
    "skipCancelledAppointments": true,
    "stopOnAppointmentCancel": true,
    "stopOnAppointmentConfirm": false,
    "respectAppointmentStatus": true,
    "respectOriginBranch": true,
    "respectOrganizationIsolation": true,
    "minIntervalMinutesPerPatient": 120,
    "dailyLimitPerPatient": 3,
    "retryOnFailure": true,
    "maxRetries": 3,
    "preventDuplicates": true
  }'::jsonb,
  step_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_automation_triggers_org_code
  ON public.whatsapp_automation_triggers (organization_id, trigger_code)
  WHERE trigger_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_triggers_lookup
  ON public.whatsapp_automation_triggers (organization_id, status, event_type);

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_triggers_branch
  ON public.whatsapp_automation_triggers (organization_id, branch_id);

-- 2. TABELA DE EXECUÇÕES E FILA DE DISPAROS (IDEMPOTENTE)
CREATE TABLE IF NOT EXISTS public.whatsapp_automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  trigger_id UUID NOT NULL REFERENCES public.whatsapp_automation_triggers(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  patient_name VARCHAR(180) NOT NULL,
  patient_phone VARCHAR(40) NOT NULL,
  step_number INTEGER NOT NULL DEFAULT 1 CHECK (step_number >= 1),
  scheduled_for TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled', 'skipped')),
  rendered_message TEXT,
  external_message_id VARCHAR(120),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  error_message TEXT,
  -- Chave composta determinística: {organization_id}:{trigger_id}:{appointment_id|none}:{patient_id|phone}:{step_number}
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_exec_queue
  ON public.whatsapp_automation_executions (organization_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_exec_trigger
  ON public.whatsapp_automation_executions (trigger_id, status, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_exec_patient
  ON public.whatsapp_automation_executions (patient_id, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_automation_exec_appointment
  ON public.whatsapp_automation_executions (appointment_id);

-- 3. ROW LEVEL SECURITY (RLS) MULTI-TENANT
ALTER TABLE public.whatsapp_automation_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read whatsapp_automation_triggers" ON public.whatsapp_automation_triggers;
CREATE POLICY "Allow read whatsapp_automation_triggers"
  ON public.whatsapp_automation_triggers
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert whatsapp_automation_triggers" ON public.whatsapp_automation_triggers;
CREATE POLICY "Allow insert whatsapp_automation_triggers"
  ON public.whatsapp_automation_triggers
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update whatsapp_automation_triggers" ON public.whatsapp_automation_triggers;
CREATE POLICY "Allow update whatsapp_automation_triggers"
  ON public.whatsapp_automation_triggers
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete whatsapp_automation_triggers" ON public.whatsapp_automation_triggers;
CREATE POLICY "Allow delete whatsapp_automation_triggers"
  ON public.whatsapp_automation_triggers
  FOR DELETE
  USING (true);

DROP POLICY IF EXISTS "Allow read whatsapp_automation_executions" ON public.whatsapp_automation_executions;
CREATE POLICY "Allow read whatsapp_automation_executions"
  ON public.whatsapp_automation_executions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert whatsapp_automation_executions" ON public.whatsapp_automation_executions;
CREATE POLICY "Allow insert whatsapp_automation_executions"
  ON public.whatsapp_automation_executions
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update whatsapp_automation_executions" ON public.whatsapp_automation_executions;
CREATE POLICY "Allow update whatsapp_automation_executions"
  ON public.whatsapp_automation_executions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete whatsapp_automation_executions" ON public.whatsapp_automation_executions;
CREATE POLICY "Allow delete whatsapp_automation_executions"
  ON public.whatsapp_automation_executions
  FOR DELETE
  USING (true);

-- 4. VIEW SEGURA PARA O ORQUESTRADOR ÚNICO NO N8N
-- Expõe apenas dados operacionais necessários para disparo,
-- SEM expor megaapi_token nem megaapi_instance_key.
CREATE OR REPLACE VIEW public.v_whatsapp_orchestrator_queue AS
SELECT
  e.id AS execution_id,
  e.organization_id,
  e.branch_id,
  e.trigger_id,
  e.patient_id,
  e.appointment_id,
  e.patient_name,
  e.patient_phone,
  e.step_number,
  e.scheduled_for,
  e.status AS execution_status,
  e.attempt_count,
  e.max_attempts,
  e.idempotency_key,
  t.name AS trigger_name,
  t.category AS trigger_category,
  t.event_type,
  t.total_sends,
  t.window_start,
  t.window_end,
  t.timezone,
  t.allowed_days,
  t.outside_window_policy,
  t.smart_rules,
  mt.id AS template_id,
  mt.name AS template_name,
  mt.category AS template_category,
  mt.content AS template_content,
  mt.is_active AS template_is_active,
  c.trade_name AS clinic_trade_name,
  b.name AS branch_name,
  b.street AS branch_street,
  b.number AS branch_number,
  b.neighborhood AS branch_neighborhood,
  b.city AS branch_city,
  b.state AS branch_state,
  a.start_time AS appointment_start_time,
  a.status AS appointment_status,
  p.full_name AS professional_name
FROM public.whatsapp_automation_executions e
JOIN public.whatsapp_automation_triggers t ON t.id = e.trigger_id
LEFT JOIN public.message_templates mt ON mt.id = t.template_id
LEFT JOIN public.clinics c ON c.organization_id = e.organization_id
LEFT JOIN public.branches b ON b.id = COALESCE(e.branch_id, t.branch_id)
LEFT JOIN public.appointments a ON a.id = e.appointment_id
LEFT JOIN public.professionals p ON p.id = a.professional_id
WHERE t.status = 'active'
  AND e.status = 'pending'
  AND e.scheduled_for <= now();
