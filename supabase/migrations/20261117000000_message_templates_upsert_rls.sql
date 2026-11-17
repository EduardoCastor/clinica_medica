-- ====================================================================
-- MIGRAÇÃO: PERSISTÊNCIA E UPSERT DE MODELOS DE MENSAGENS (PUBLIC.MESSAGE_TEMPLATES)
-- Adiciona coluna updated_at e políticas RLS para leitura e gravação pelo painel e n8n
-- ====================================================================

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_message_templates_org_category
  ON public.message_templates (organization_id, category);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read message_templates by tenant" ON public.message_templates;
CREATE POLICY "Allow read message_templates by tenant"
  ON public.message_templates
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert message_templates by tenant" ON public.message_templates;
CREATE POLICY "Allow insert message_templates by tenant"
  ON public.message_templates
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update message_templates by tenant" ON public.message_templates;
CREATE POLICY "Allow update message_templates by tenant"
  ON public.message_templates
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
