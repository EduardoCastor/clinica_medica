-- ====================================================================
-- MIGRAÇÃO: INTEGRAÇÃO WHATSAPP MEGAAPI & WEBHOOKS POR CLÍNICA
-- Adiciona campos de instância Megaapi e webhooks na tabela public.clinics
-- ====================================================================

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS megaapi_instance_url TEXT,
  ADD COLUMN IF NOT EXISTS megaapi_token TEXT,
  ADD COLUMN IF NOT EXISTS n8n_webhook_disponibilidade TEXT,
  ADD COLUMN IF NOT EXISTS n8n_webhook_agendamento TEXT;

-- Índice auxiliar para busca rápida de sites publicados por domínio customizado
CREATE INDEX IF NOT EXISTS idx_websites_custom_domain
  ON public.websites (lower(custom_domain));
