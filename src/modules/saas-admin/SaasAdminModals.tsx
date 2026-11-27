import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import {
  BillingCycle,
  LicenseStatus,
  Plan,
  SaasInvoice,
} from '../../types';
import {
  calculatePlanCyclePricing,
  computeTrialLicenseState,
  formatBrl,
} from '../../services/saasCommercialUtils';
import {
  SaasAdminCloudService,
  SaasAdminTenantRecord,
} from '../../services/saasCloudService';

interface PlanEditorModalProps {
  plan: Plan | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const PlanEditorModal: React.FC<PlanEditorModalProps> = ({
  plan,
  onClose,
  onSaved,
}) => {
  const [draft, setDraft] = useState<Plan | null>(plan);
  const [reason, setReason] = useState('Atualização comercial de tabela de planos');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(plan);
    setErrorMsg(null);
  }, [plan]);

  if (!draft) return null;

  const qCalc = calculatePlanCyclePricing(draft, 'quarterly');
  const yCalc = calculatePlanCyclePricing(draft, 'yearly');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMsg(null);
    setIsSaving(true);

    const normalized: Plan = {
      ...draft,
      priceQuarterly: qCalc.finalPeriodAmount,
      priceYearly: yCalc.finalPeriodAmount,
      quarterlyDiscountPercent: qCalc.discountPercent,
      yearlyDiscountPercent: yCalc.discountPercent,
    };

    const res = await SaasAdminCloudService.upsertPlan(normalized, reason.trim());
    setIsSaving(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Não foi possível salvar o plano comercial.');
      return;
    }

    onSaved(`Plano "${normalized.name}" atualizado no Supabase e sincronizado com a página comercial.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 my-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Editar Plano Comercial: {draft.name}
            </h3>
            <span className="text-[11px] text-slate-500 font-mono">
              Código: {draft.code} · Ordem de exibição: {draft.displayOrder ?? 1}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Nome do Plano</label>
              <input
                type="text"
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-semibold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Ordem na Página</label>
              <input
                type="number"
                min={1}
                value={draft.displayOrder ?? 1}
                onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Descrição Comercial</label>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-800 resize-none"
            />
          </div>

          {/* Precificação Unificada: Mensal + Desconto Trimestral + Desconto Anual */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span className="font-bold text-slate-900 block">
              Tabela de Preços & Descontos (Fonte Única: Landing + Checkout)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Preço Mensal (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  required
                  value={draft.priceMonthly}
                  onChange={(e) => setDraft({ ...draft, priceMonthly: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums font-bold text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Desc. Trimestral (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={95}
                  value={draft.quarterlyDiscountPercent ?? 0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      quarterlyDiscountPercent: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums font-bold text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Desc. Anual (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={95}
                  value={draft.yearlyDiscountPercent ?? 0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      yearlyDiscountPercent: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums font-bold text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Dias de Trial</label>
                <input
                  type="number"
                  min={0}
                  value={draft.trialDays}
                  onChange={(e) => setDraft({ ...draft, trialDays: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums text-slate-900 bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 text-[11px] text-slate-700">
              <div>
                Trimestral calculado:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  R$ {formatBrl(qCalc.finalPeriodAmount)}
                </strong>{' '}
                (equiv. R$ {formatBrl(qCalc.effectiveMonthly)}/mês)
              </div>
              <div>
                Anual calculado:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  R$ {formatBrl(yCalc.finalPeriodAmount)}
                </strong>{' '}
                (equiv. R$ {formatBrl(yCalc.effectiveMonthly)}/mês)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Máx. Filiais</label>
              <input
                type="number"
                min={1}
                value={draft.maxBranches}
                onChange={(e) => setDraft({ ...draft, maxBranches: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Máx. Usuários</label>
              <input
                type="number"
                min={1}
                value={draft.maxUsers}
                onChange={(e) => setDraft({ ...draft, maxUsers: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Máx. Pacientes</label>
              <input
                type="number"
                min={0}
                value={draft.maxPatients}
                onChange={(e) => setDraft({ ...draft, maxPatients: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hasWhatsAppAutomation}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    hasWhatsAppAutomation: e.target.checked,
                    hasWhatsappAutomation: e.target.checked,
                  })
                }
              />
              <span>Automação WhatsApp Oficial</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hasCustomWebsite}
                onChange={(e) => setDraft({ ...draft, hasCustomWebsite: e.target.checked })}
              />
              <span>Site Institucional White-Label</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hasFinancialModule}
                onChange={(e) => setDraft({ ...draft, hasFinancialModule: e.target.checked })}
              />
              <span>Módulo Financeiro Completo</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hasAdvancedReports}
                onChange={(e) => setDraft({ ...draft, hasAdvancedReports: e.target.checked })}
              />
              <span>Relatórios Gerenciais & BI</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hasPatientSharing}
                onChange={(e) => setDraft({ ...draft, hasPatientSharing: e.target.checked })}
              />
              <span>Compartilhamento entre Filiais (Modelo B)</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg border border-amber-200 bg-amber-50/50 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(draft.isPopular)}
                onChange={(e) => setDraft({ ...draft, isPopular: e.target.checked })}
              />
              <span className="font-semibold text-amber-900">Destaque "Mais escolhido"</span>
            </label>
            <label className="flex items-center gap-2 p-2 rounded-lg border border-emerald-200 bg-emerald-50/50 cursor-pointer sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.isActive !== false}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              <span className="font-semibold text-emerald-900">
                Disponível comercialmente (visível na Landing Page e Checkout)
              </span>
            </label>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Motivo / Registro de Auditoria
            </label>
            <input
              type="text"
              required
              minLength={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 disabled:opacity-60 rounded-xl inline-flex items-center gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{isSaving ? 'Salvando...' : 'Salvar e Publicar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface OrganizationDetailModalProps {
  tenant: SaasAdminTenantRecord | null;
  plans: Plan[];
  invoices: SaasInvoice[];
  onClose: () => void;
  onUpdated: (message: string) => void;
  onImpersonate: (clinicId: string) => void;
}

function toDateInputValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export const OrganizationDetailModal: React.FC<OrganizationDetailModalProps> = ({
  tenant,
  plans,
  invoices,
  onClose,
  onUpdated,
  onImpersonate,
}) => {
  const [planId, setPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('trial');
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>('TESTE_ATIVO');
  const [expiryDateInput, setExpiryDateInput] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    const org = tenant.organization;
    const state = computeTrialLicenseState(org);
    setPlanId(org.planId || plans[0]?.id || '');
    setBillingCycle(org.billingCycle || (state.isTrial ? 'trial' : 'monthly'));
    setLicenseStatus(state.licenseStatus);
    setExpiryDateInput(
      toDateInputValue(
        state.isTrial ? org.trialEndsAt : org.subscriptionRenewsAt || org.trialEndsAt
      )
    );
    setReason('');
    setErrorMsg(null);
  }, [tenant, plans]);

  if (!tenant) return null;

  const org = tenant.organization;
  const orgInvoices = invoices.filter((inv) => inv.organizationId === org.id);

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (reason.trim().length < 5) {
      setErrorMsg('Informe o motivo obrigatório da alteração (mínimo 5 caracteres).');
      return;
    }

    setErrorMsg(null);
    setIsSaving(true);

    const endIso = expiryDateInput
      ? new Date(`${expiryDateInput}T23:59:59.000Z`).toISOString()
      : null;

    const isTrialStatus =
      licenseStatus === 'TESTE_ATIVO' || licenseStatus === 'TESTE_EXPIRADO';

    const res = await SaasAdminCloudService.updateOrganizationLicense({
      organizationId: org.id,
      planId: planId || undefined,
      billingCycle,
      licenseStatus,
      trialEndsAt: isTrialStatus ? endIso : undefined,
      subscriptionRenewsAt: !isTrialStatus ? endIso : undefined,
      reason: reason.trim(),
    });

    setIsSaving(false);
    if (!res.success) {
      setErrorMsg(res.error || 'Falha ao atualizar licença da organização.');
      return;
    }

    onUpdated(`Organização "${org.name}" atualizada com sucesso e registrada na auditoria.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-5 my-6">
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Gerenciar Cliente: {tenant.clinic?.legalName || org.name}
            </h3>
            <p className="text-xs text-slate-500">
              Slug: <span className="font-mono">{org.slug}</span> · Responsável:{' '}
              {org.responsibleName || '—'} · {org.contactEmail || tenant.clinic?.email || '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onImpersonate(tenant.clinic?.id || org.id)}
              className="px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg inline-flex items-center gap-1.5"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Acessar como Suporte</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <div>
            <span className="text-slate-500 block">Unidades / Equipe</span>
            <strong className="tabular-nums text-slate-900">
              {tenant.branchesCount} filiais · {tenant.activeUsersCount} usuários
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">Pacientes (Contagem)</span>
            <strong className="tabular-nums text-slate-900">
              {tenant.patientsCount} cadastros
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">Último Acesso</span>
            <strong className="tabular-nums text-slate-900">
              {org.lastAccessedAt
                ? new Date(org.lastAccessedAt).toLocaleDateString('pt-BR')
                : 'Sem registro'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">Onboarding</span>
            <strong className="text-slate-900">
              {org.onboardingCompleted ? 'Concluído' : 'Em andamento'}
            </strong>
          </div>
        </div>

        <form onSubmit={handleSaveChanges} className="space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Plano Associado</label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold text-slate-900"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (R$ {formatBrl(p.priceMonthly)}/mês)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Ciclo de Cobrança</label>
              <select
                value={billingCycle}
                onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold text-slate-900"
              >
                <option value="trial">Período de Teste (Trial)</option>
                <option value="monthly">Mensal</option>
                <option value="quarterly">Trimestral</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Status da Licença
              </label>
              <select
                value={licenseStatus}
                onChange={(e) => setLicenseStatus(e.target.value as LicenseStatus)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold text-slate-900"
              >
                <option value="TESTE_ATIVO">Teste Gratuito Ativo</option>
                <option value="TESTE_EXPIRADO">Teste Expirado (Modo Leitura)</option>
                <option value="ATIVA">Assinatura Ativa</option>
                <option value="PAGAMENTO_PENDENTE">Pagamento Pendente</option>
                <option value="INADIMPLENTE">Inadimplente (Modo Leitura)</option>
                <option value="SUSPENSA">Suspensa</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {licenseStatus.startsWith('TESTE')
                  ? 'Data de Expiração do Teste'
                  : 'Próximo Vencimento / Renovação'}
              </label>
              <div className="relative">
                <CalendarClock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="date"
                  value={expiryDateInput}
                  onChange={(e) => setExpiryDateInput(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Motivo Obrigatório da Alteração (Auditoria SaaS)
            </label>
            <input
              type="text"
              required
              minLength={5}
              placeholder="Ex: Extensão de 5 dias de teste autorizada pela diretoria / Suspensão solicitada pelo cliente"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
            />
          </div>

          {/* Historical Invoices of Organization */}
          {orgInvoices.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <span className="font-bold text-slate-800 block">
                Últimas Faturas desta Organização
              </span>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {orgInvoices.slice(0, 6).map((inv) => (
                  <div
                    key={inv.id}
                    className="px-3 py-2 flex items-center justify-between text-[11px]"
                  >
                    <span className="font-mono text-slate-700">{inv.referenceCode}</span>
                    <span className="tabular-nums font-semibold">
                      R$ {formatBrl(inv.finalAmount)}
                    </span>
                    <span
                      className={
                        inv.status === 'paid'
                          ? 'text-emerald-700 font-bold'
                          : inv.status === 'overdue'
                          ? 'text-rose-700 font-bold'
                          : 'text-amber-700 font-bold'
                      }
                    >
                      {inv.status === 'paid'
                        ? 'Paga'
                        : inv.status === 'overdue'
                        ? 'Em atraso'
                        : inv.status === 'pending'
                        ? 'Pendente'
                        : inv.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 font-semibold"
            >
              Fechar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 disabled:opacity-60 rounded-xl inline-flex items-center gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              <span>{isSaving ? 'Aplicando...' : 'Aplicar Alteração com Auditoria'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ManualPaymentModalProps {
  isOpen: boolean;
  invoice: SaasInvoice | null;
  tenants: SaasAdminTenantRecord[];
  plans: Plan[];
  onClose: () => void;
  onConfirmed: (message: string) => void;
}

export const ManualPaymentModal: React.FC<ManualPaymentModalProps> = ({
  isOpen,
  invoice,
  tenants,
  plans,
  onClose,
  onConfirmed,
}) => {
  const paidPlans = plans.filter((p) => p.priceMonthly > 0);
  const [organizationId, setOrganizationId] = useState('');
  const [planId, setPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [paymentMethod, setPaymentMethod] = useState('PIX Direto');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setReason('');
    if (invoice) {
      setOrganizationId(invoice.organizationId);
      setPlanId(invoice.planId || paidPlans[0]?.id || '');
      setBillingCycle(
        invoice.billingCycle === 'quarterly' || invoice.billingCycle === 'yearly'
          ? invoice.billingCycle
          : 'monthly'
      );
    } else {
      setOrganizationId(tenants[0]?.organization.id || '');
      setPlanId(paidPlans[0]?.id || '');
      setBillingCycle('monthly');
    }
  }, [isOpen, invoice, tenants]);

  if (!isOpen) return null;

  const selectedPlan = paidPlans.find((p) => p.id === planId) || paidPlans[0];
  const amountPreview = invoice
    ? invoice.finalAmount
    : selectedPlan
    ? calculatePlanCyclePricing(selectedPlan, billingCycle).finalPeriodAmount
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (reason.trim().length < 5) {
      setErrorMsg('Informe o comprovante/justificativa da baixa manual (mínimo 5 caracteres).');
      return;
    }

    setErrorMsg(null);
    setIsSaving(true);

    const res = await SaasAdminCloudService.confirmManualPayment({
      invoiceId: invoice?.id,
      organizationId: invoice ? undefined : organizationId,
      planId: invoice ? undefined : planId,
      billingCycle: invoice ? undefined : billingCycle,
      paymentMethod,
      reason: reason.trim(),
    });

    setIsSaving(false);
    if (!res.success) {
      setErrorMsg(res.error || 'Falha ao confirmar baixa manual.');
      return;
    }

    onConfirmed('Pagamento confirmado manualmente. Licença ativada e registrada na auditoria.');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-700" />
              <span>Confirmar Baixa Manual de Pagamento</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Registra o recebimento confirmado no caixa SaaS e ativa automaticamente a licença da clínica.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {invoice ? (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-bold text-slate-900">
                Fatura {invoice.referenceCode} · {invoice.organizationName}
              </div>
              <div className="text-slate-600 tabular-nums">
                Plano: {invoice.planName} · Valor oficial:{' '}
                <strong>R$ {formatBrl(invoice.finalAmount)}</strong>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Organização / Clínica
                </label>
                <select
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold"
                >
                  {tenants.map((t) => (
                    <option key={t.organization.id} value={t.organization.id}>
                      {t.clinic?.legalName || t.organization.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Plano Contratado</label>
                  <select
                    value={planId}
                    onChange={(e) => setPlanId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                  >
                    {paidPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ciclo</label>
                  <select
                    value={billingCycle}
                    onChange={(e) =>
                      setBillingCycle(e.target.value as 'monthly' | 'quarterly' | 'yearly')
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                  >
                    <option value="monthly">Mensal</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="yearly">Anual</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Meio de Pagamento</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="PIX Direto">PIX Direto</option>
                <option value="Transferência Bancária">Transferência Bancária</option>
                <option value="Boleto Compensado">Boleto Compensado</option>
                <option value="Kiwify / Cartão">Kiwify / Cartão</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Valor Confirmado</label>
              <div className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 font-mono font-bold text-slate-900 tabular-nums">
                R$ {formatBrl(amountPreview)}
              </div>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Justificativa / Número do Comprovante (Obrigatório)
            </label>
            <input
              type="text"
              required
              minLength={5}
              placeholder="Ex: Comprovante PIX E2E 98412 recebido em conta"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl inline-flex items-center gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>{isSaving ? 'Confirmando...' : 'Confirmar Pagamento e Ativar Licença'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
