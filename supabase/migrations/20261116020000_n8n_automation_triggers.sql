-- ====================================================================
-- MIGRAÇÃO: WEBHOOK INBOUND MEGAAPI & GATILHOS AUTOMÁTICOS N8N
-- Adiciona configuração de webhook inbound do WhatsApp e toggles de gatilho por clínica
-- ====================================================================

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS n8n_webhook_megaapi_inbound TEXT,
  ADD COLUMN IF NOT EXISTS automation_triggers JSONB DEFAULT '{"immediateConfirmation":true,"confirmation48h":true,"reminder24h":true,"autoReplyConfirm":true,"postCare":true}'::jsonb;
