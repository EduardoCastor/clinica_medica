import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Organization, Plan, SaasInvoice } from '../types';
import {
  ClinicBillingCloudService,
  fetchPublicPlansStrict,
} from '../services/saasCloudService';
import {
  calculatePlanCyclePricing,
  formatBrl,
  sortPlansByCommercialOrder,
  TrialLicenseState,
} from '../services/saasCommercialUtils';
import { StorageService } from '../services/storage';

interface ClinicSubscriptionModalProps {
  isOpen: boolean;
  organization: Organization;
  licenseState: TrialLicenseState;
  onClose: () => void;
}

type PaidCycle = 'monthly' | 'quarterly' | 'yearly';

export const ClinicSubscriptionModal: React.FC<ClinicSubscriptionModalProps> = ({
  isOpen,
  organization,
  licenseState,
  onClose,
}) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<PaidCycle>('monthly');
  const [submittingPlanCode, setSubmittingPlanCode] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [createdCheckout, setCreatedCheckout] = useState<{
    invoice?: SaasInvoice;
    checkoutUrl?: string | null;
    gatewayConfigured?: boolean;
    message?: string;
  } | null>(null);

  const loadStrictPlans = useCallback(async () => {
    setIsLoadingPlans(true);
    setPlansError(null);
    const res = await fetchPublicPlansStrict({ includeInactive: false });
    if (!res.success) {
      setPlans([]);
      setPlansError(res.error || 'Erro ao carregar planos comerciais do Supabase.');
    } else {
      const commercialPaid = sortPlansByCommercialOrder(res.plans).filter(
        (p) => p.code !== 'trial' && p.priceMonthly > 0
      );
      setPlans(commercialPaid);
      if (commercialPaid.length === 0) {
        setPlansError('Nenhum plano pago ativo encontrado no catálogo comercial.');
      }
    }
    setIsLoadingPlans(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setCheckoutError(null);
    setCreatedCheckout(null);
    void loadStrictPlans();
  }, [isOpen, loadStrictPlans]);

  if (!isOpen) return null;

  const handleSelectPlan = async (plan: Plan) => {
    if (submittingPlanCode) return;
    setSubmittingPlanCode(plan.code);
    setCheckoutError(null);

    const res = await ClinicBillingCloudService.createCheckoutSession({
      organizationId: organization.id,
      planCode: plan.code,
      billingCycle,
    });

    if (!res.success) {
      setCheckoutError(res.error || 'Não foi possível gerar a cobrança do plano.');
      setSubmittingPlanCode(null);
      return;
    }

    setCreatedCheckout({
      invoice: res.invoice,
      checkoutUrl: res.checkoutUrl,
      gatewayConfigured: res.gatewayConfigured,
      message: res.message,
    });

    const billingRes = await ClinicBillingCloudService.getOrgBillingStatus(organization.id);
    if (billingRes.success && billingRes.organization) {
      StorageService.updateOrganizationCache(billingRes.organization);
    }

    setSubmittingPlanCode(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-6">
        <div className="p-6 bg-slate-950 text-white flex items-start justify-between gap-4 border-b border-slate-800">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-sky-400">
              <CreditCard className="w-4 h-4" />
              <span>Assinatura & Conversão da Clínica</span>
            </div>
            <h2 className="text-lg font-extrabold tracking-tight">
              Escolha seu plano para continuar com a mesma clínica ({organization.name})
            </h2>
            <p className="text-xs text-slate-300">
              Status atual: <strong>{licenseState.badgeLabel}</strong> · Todos os pacientes, prontuários e configurações serão mantidos automaticamente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 text-xs">
          {/* Segmented Cycle Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-slate-600">
              Valores oficiais carregados diretamente do servidor Supabase:
            </span>
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start">
              {(
                [
                  { id: 'monthly', label: 'Mensal' },
                  { id: 'quarterly', label: 'Trimestral' },
                  { id: 'yearly', label: 'Anual' },
                ] as Array<{ id: PaidCycle; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBillingCycle(tab.id)}
                  className={`px-3.5 py-1.5 rounded-lg font-bold transition-colors whitespace-nowrap shrink-0 ${
                    billingCycle === tab.id
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {checkoutError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{checkoutError}</span>
            </div>
          )}

          {createdCheckout ? (
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    Cobrança registrada · Aguardando confirmação de pagamento
                  </h3>
                  <p className="text-slate-600 leading-relaxed">
                    {createdCheckout.message ||
                      'Fatura gerada no sistema. A licença muda para Ativa assim que o pagamento for confirmado pelo gateway ou registrado pelo financeiro.'}
                  </p>
                </div>
              </div>

              {createdCheckout.invoice && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-500 block">Referência</span>
                    <strong className="font-mono text-slate-900">
                      {createdCheckout.invoice.referenceCode}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Valor do Ciclo</span>
                    <strong className="tabular-nums text-slate-900">
                      R$ {formatBrl(createdCheckout.invoice.finalAmount)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Status da Fatura</span>
                    <strong className="text-sky-700">Pendente de Pagamento</strong>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                {createdCheckout.checkoutUrl && (
                  <a
                    href={createdCheckout.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white font-bold rounded-xl inline-flex items-center gap-1.5"
                  >
                    <span>Ir para Checkout Seguro</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : isLoadingPlans ? (
            <div className="py-12 text-center text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
              <span>Carregando planos oficiais do Supabase...</span>
            </div>
          ) : plansError ? (
            <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-3">
              <AlertTriangle className="w-6 h-6 text-rose-700 mx-auto" />
              <p className="text-rose-900 font-semibold">{plansError}</p>
              <button
                type="button"
                onClick={() => void loadStrictPlans()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tentar novamente</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {plans.map((plan) => {
                const pricing = calculatePlanCyclePricing(plan, billingCycle);
                const isSubmittingThis = submittingPlanCode === plan.code;

                return (
                  <div
                    key={plan.id}
                    className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
                          <p className="text-slate-600 mt-0.5">{plan.description}</p>
                        </div>
                        {pricing.discountPercent > 0 && (
                          <span className="font-mono font-bold text-emerald-700 whitespace-nowrap shrink-0">
                            -{pricing.discountPercent}%
                          </span>
                        )}
                      </div>

                      <div className="pt-1">
                        <div className="flex items-baseline gap-1">
                          <span className="font-semibold text-slate-600">R$</span>
                          <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                            {formatBrl(pricing.effectiveMonthly)}
                          </span>
                          <span className="text-slate-500">/mês</span>
                        </div>
                        <p className="text-[11px] text-slate-600 font-mono tabular-nums mt-0.5">
                          Total do ciclo: R$ {formatBrl(pricing.finalPeriodAmount)} (
                          {billingCycle === 'monthly'
                            ? 'mensal'
                            : billingCycle === 'quarterly'
                            ? 'trimestral'
                            : 'anual'}
                          )
                        </p>
                      </div>

                      <ul className="space-y-1.5 pt-2 border-t border-slate-200 text-slate-700">
                        <li className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                          <span>
                            Até <strong>{plan.maxBranches}</strong>{' '}
                            {plan.maxBranches === 1 ? 'filial' : 'filiais'} ·{' '}
                            <strong>{plan.maxUsers}</strong> usuários ·{' '}
                            <strong>{plan.maxPatients.toLocaleString('pt-BR')}</strong> pacientes
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                          <span>
                            {plan.hasWhatsAppAutomation
                              ? 'Automação WhatsApp Oficial incluída'
                              : 'WhatsApp manual incluído'}
                          </span>
                        </li>
                        {plan.hasFinancialModule && (
                          <li className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                            <span>Financeiro completo + Recibos</span>
                          </li>
                        )}
                      </ul>
                    </div>

                    <button
                      type="button"
                      disabled={Boolean(submittingPlanCode)}
                      onClick={() => void handleSelectPlan(plan)}
                      className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      {isSubmittingThis ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Gerando cobrança...</span>
                        </>
                      ) : (
                        <span>Assinar {plan.name}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-700 shrink-0" />
            <span>
              Nenhuma licença paga é ativada sem confirmação real de pagamento ou baixa manual auditada.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
