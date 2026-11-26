-- ============================================================================
-- MIGRAÇÃO: CONFIABILIDADE DO SUPABASE REALTIME NO PAINEL DE ATENDIMENTO
-- MedSync SaaS — Clínica Dr. Newton Mureb
-- ============================================================================
-- Motivo técnico:
--   Filtros de linha em `postgres_changes` (ex.: `organization_id=eq.<uuid>`)
--   sobre operações UPDATE/DELETE exigem que o WAL registre os valores das
--   colunas filtradas (`REPLICA IDENTITY FULL`) além da publicação ativa em
--   `supabase_realtime`. Esta migração garante ambos de forma idempotente sem
--   alterar migrações anteriores nem relaxar políticas RLS existentes.
-- ============================================================================

ALTER TABLE public.attendance_calls REPLICA IDENTITY FULL;
ALTER TABLE public.attendance_call_events REPLICA IDENTITY FULL;
ALTER TABLE public.call_panel_settings REPLICA IDENTITY FULL;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;

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
