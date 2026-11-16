-- ====================================================================
-- MIGRAÇÃO: INSTANCE KEY DA MEGAAPI NA TABELA PUBLIC.CLINICS
-- Garante a existência da coluna megaapi_instance_key para identificação da instância
-- ====================================================================

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS megaapi_instance_key TEXT;
