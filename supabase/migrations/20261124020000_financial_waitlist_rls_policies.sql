-- ============================================================================
-- Migration: 20261124020000_financial_waitlist_rls_policies.sql
-- Objetivo:
--   1) Adicionar políticas RLS explícitas em public.financial_transactions e
--      public.waitlist seguindo o isolamento multi-tenant + filial + RBAC
--      já consolidado nas migrations anteriores.
--   2) Garantir coluna e trigger updated_at nessas duas tabelas operacionais.
--   3) Adicionar índices para consultas do dashboard, financeiro e lista de espera.
-- ============================================================================

-- 1. Coluna updated_at e triggers automáticos
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_financial_transactions_updated_at ON public.financial_transactions;
CREATE TRIGGER trg_financial_transactions_updated_at
  BEFORE UPDATE ON public.financial_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON public.waitlist;
CREATE TRIGGER trg_waitlist_updated_at
  BEFORE UPDATE ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.medsync_set_updated_at();

-- 2. Políticas RLS para public.financial_transactions
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Financial select strict" ON public.financial_transactions;
DROP POLICY IF EXISTS "Financial insert strict" ON public.financial_transactions;
DROP POLICY IF EXISTS "Financial update strict" ON public.financial_transactions;
DROP POLICY IF EXISTS "Financial delete strict" ON public.financial_transactions;

CREATE POLICY "Financial select strict" ON public.financial_transactions
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('financial', 'consult')
      OR public.medsync_current_role() IN ('super_admin', 'clinic_admin', 'branch_admin', 'financial')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Financial insert strict" ON public.financial_transactions
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('financial', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Financial update strict" ON public.financial_transactions
  FOR UPDATE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('financial', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  )
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('financial', 'edit')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Financial delete strict" ON public.financial_transactions
  FOR DELETE
  USING (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('financial', 'delete')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

-- 3. Políticas RLS para public.waitlist
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Waitlist select strict" ON public.waitlist;
DROP POLICY IF EXISTS "Waitlist insert strict" ON public.waitlist;
DROP POLICY IF EXISTS "Waitlist update strict" ON public.waitlist;
DROP POLICY IF EXISTS "Waitlist delete strict" ON public.waitlist;

CREATE POLICY "Waitlist select strict" ON public.waitlist
  FOR SELECT
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('appointments', 'consult')
      OR public.medsync_has_menu_permission('dashboard', 'consult')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Waitlist insert strict" ON public.waitlist
  FOR INSERT
  WITH CHECK (
    public.medsync_can_access_org(organization_id)
    AND public.medsync_has_menu_permission('appointments', 'create')
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

CREATE POLICY "Waitlist update strict" ON public.waitlist
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

CREATE POLICY "Waitlist delete strict" ON public.waitlist
  FOR DELETE
  USING (
    public.medsync_can_access_org(organization_id)
    AND (
      public.medsync_has_menu_permission('appointments', 'delete')
      OR public.medsync_has_menu_permission('appointments', 'edit')
    )
    AND public.medsync_user_has_branch_access(organization_id, branch_id)
  );

-- 4. Índices de consulta para dashboard e financeiro
CREATE INDEX IF NOT EXISTS idx_financial_org_branch_due
  ON public.financial_transactions (organization_id, branch_id, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_org_branch_status
  ON public.waitlist (organization_id, branch_id, status, created_at ASC);
