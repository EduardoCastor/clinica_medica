import React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  ListChecks,
  Lock,
} from 'lucide-react';
import { Organization } from '../types';
import {
  ONBOARDING_STEPS,
  TrialLicenseState,
  normalizeOnboardingProgress,
} from '../services/saasCommercialUtils';

interface TrialStatusBannerProps {
  organization: Organization;
  licenseState: TrialLicenseState;
  onOpenUpgradeModal: () => void;
  onOpenOnboardingWizard: () => void;
}

export const TrialStatusBanner: React.FC<TrialStatusBannerProps> = ({
  organization,
  licenseState,
  onOpenUpgradeModal,
  onOpenOnboardingWizard,
}) => {
  const onboarding = normalizeOnboardingProgress(organization.onboardingProgress);
  const completedCount = onboarding.completedSteps.length;
  const totalSteps = ONBOARDING_STEPS.length;
  const showOnboardingButton = !organization.onboardingCompleted;

  const shouldRender =
    licenseState.isTrial ||
    licenseState.isBlockedForWrites ||
    licenseState.licenseStatus === 'PAGAMENTO_PENDENTE' ||
    showOnboardingButton;

  if (!shouldRender) {
    return null;
  }

  if (licenseState.isBlockedForWrites) {
    const title =
      licenseState.licenseStatus === 'TESTE_EXPIRADO'
        ? 'Período de teste gratuito encerrado'
        : licenseState.licenseStatus === 'INADIMPLENTE'
        ? 'Assinatura com pagamento em atraso'
        : licenseState.licenseStatus === 'CANCELADA'
        ? 'Assinatura cancelada'
        : 'Licença temporariamente suspensa';

    return (
      <div className="bg-rose-50 border-b border-rose-200 px-4 sm:px-6 py-2.5 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-start sm:items-center gap-2.5 text-rose-900">
            <Lock className="w-4 h-4 text-rose-700 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <strong className="font-bold">{title}.</strong>{' '}
              <span className="text-rose-800">
                Novos registros estão bloqueados em modo leitura, mas todos os pacientes, prontuários, documentos e histórico da sua clínica permanecem preservados.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenUpgradeModal}
            className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0"
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Regularizar / Escolher Plano</span>
          </button>
        </div>
      </div>
    );
  }

  if (licenseState.licenseStatus === 'PAGAMENTO_PENDENTE') {
    return (
      <div className="bg-sky-50 border-b border-sky-200 px-4 sm:px-6 py-2 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-sky-900">
            <AlertTriangle className="w-4 h-4 text-sky-700 shrink-0" />
            <span>
              <strong>Pagamento pendente de confirmação.</strong> Assim que o gateway confirmar o pagamento da fatura, sua licença será marcada como Ativa.
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenUpgradeModal}
            className="px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Ver Planos & Cobrança
          </button>
        </div>
      </div>
    );
  }

  if (licenseState.isTrialActive) {
    const urgent = licenseState.daysRemaining <= 3;
    return (
      <div
        className={`border-b px-4 sm:px-6 py-2 print:hidden ${
          urgent
            ? 'bg-amber-50 border-amber-200 text-amber-950'
            : 'bg-slate-900 border-slate-800 text-slate-100'
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <CalendarClock
                className={`w-3.5 h-3.5 ${urgent ? 'text-amber-700' : 'text-sky-400'}`}
              />
              <span>Plano: Teste gratuito</span>
            </span>
            <span aria-hidden="true" className={urgent ? 'text-amber-400' : 'text-slate-600'}>
              ·
            </span>
            <span className="tabular-nums">
              Termina em <strong>{licenseState.formattedEndsAt}</strong>
            </span>
            <span aria-hidden="true" className={urgent ? 'text-amber-400' : 'text-slate-600'}>
              ·
            </span>
            <span className="tabular-nums font-semibold">
              {licenseState.daysRemaining}{' '}
              {licenseState.daysRemaining === 1 ? 'dia restante' : 'dias restantes'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {showOnboardingButton && (
              <button
                type="button"
                onClick={onOpenOnboardingWizard}
                className={`px-3 py-1 rounded-lg font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  urgent
                    ? 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  Configuração inicial ({completedCount}/{totalSteps})
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenUpgradeModal}
              className="px-3.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Escolher Plano
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Caso assinatura esteja ativa mas configuração inicial ainda não tenha sido marcada como concluída
  return (
    <div className="bg-slate-100 border-b border-slate-200 px-4 sm:px-6 py-2 print:hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 text-xs text-slate-700">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
          <span className="tabular-nums">
            Configuração inicial da clínica: <strong>{completedCount}</strong> de{' '}
            <strong>{totalSteps}</strong> etapas concluídas.
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenOnboardingWizard}
          className="px-3 py-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-900 font-semibold rounded-lg whitespace-nowrap shrink-0"
        >
          Abrir Assistente
        </button>
      </div>
    </div>
  );
};
