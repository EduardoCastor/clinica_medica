import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { Organization } from '../types';
import { ClinicTab } from './Sidebar';
import {
  ONBOARDING_STEPS,
  normalizeOnboardingProgress,
} from '../services/saasCommercialUtils';
import { ClinicBillingCloudService } from '../services/saasCloudService';
import { StorageService } from '../services/storage';

interface ClinicOnboardingWizardProps {
  isOpen: boolean;
  organization: Organization;
  onClose: () => void;
  onNavigateTab: (tab: ClinicTab) => void;
}

export const ClinicOnboardingWizard: React.FC<ClinicOnboardingWizardProps> = ({
  isOpen,
  organization,
  onClose,
  onNavigateTab,
}) => {
  const initialProgress = normalizeOnboardingProgress(organization.onboardingProgress);
  const [completedSteps, setCompletedSteps] = useState<string[]>(initialProgress.completedSteps);
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  if (!isOpen) return null;

  const progressPercent = Math.round((completedSteps.length / ONBOARDING_STEPS.length) * 100);

  const persistProgress = async (
    nextSteps: string[],
    options?: { skipped?: boolean; completed?: boolean; closeAfter?: boolean }
  ) => {
    setIsSaving(true);
    setFeedbackError(null);

    const isAllDone = options?.completed ?? nextSteps.length >= ONBOARDING_STEPS.length;
    const nextOrg: Organization = {
      ...organization,
      onboardingCompleted: isAllDone,
      onboardingProgress: {
        completedSteps: nextSteps,
        skipped: Boolean(options?.skipped),
        currentStep: Math.min(ONBOARDING_STEPS.length, nextSteps.length + 1),
        updatedAt: new Date().toISOString(),
      },
    };
    StorageService.updateOrganizationCache(nextOrg);

    const res = await ClinicBillingCloudService.updateOnboardingProgress({
      organizationId: organization.id,
      completedSteps: nextSteps,
      skipped: options?.skipped,
      completed: isAllDone,
      currentStep: Math.min(ONBOARDING_STEPS.length, nextSteps.length + 1),
    });

    if (!res.success && res.error) {
      setFeedbackError(res.error);
    } else if (res.organization) {
      StorageService.updateOrganizationCache(res.organization);
    }

    setIsSaving(false);
    if (options?.closeAfter) {
      onClose();
    }
  };

  const toggleStep = (stepKey: string) => {
    const nextSteps = completedSteps.includes(stepKey)
      ? completedSteps.filter((s) => s !== stepKey)
      : [...completedSteps, stepKey];
    setCompletedSteps(nextSteps);
    void persistProgress(nextSteps);
  };

  const handleOpenStepModule = (stepKey: string, targetTab: ClinicTab) => {
    const nextSteps = completedSteps.includes(stepKey)
      ? completedSteps
      : [...completedSteps, stepKey];
    setCompletedSteps(nextSteps);
    void persistProgress(nextSteps);
    onNavigateTab(targetTab);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-6">
        <div className="p-6 bg-slate-950 text-white flex items-start justify-between gap-4 border-b border-slate-800">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Configuração Inicial da Clínica</span>
            </div>
            <h2 className="text-lg font-extrabold tracking-tight">
              Prepare sua operação clínica em 7 etapas simples
            </h2>
            <p className="text-xs text-slate-300">
              Você pode seguir a ordem sugerida ou pular etapas e concluir quando desejar.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            aria-label="Fechar assistente"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-semibold text-slate-700">
              <span>Progresso da implantação</span>
              <span className="tabular-nums">
                {completedSteps.length} / {ONBOARDING_STEPS.length} ({progressPercent}%)
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-sky-600 transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {feedbackError && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
              Progresso salvo localmente. Aviso de sincronização: {feedbackError}
            </div>
          )}

          {/* 7 Steps */}
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
            {ONBOARDING_STEPS.map((step) => {
              const isDone = completedSteps.includes(step.key);
              return (
                <div
                  key={step.key}
                  className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isDone ? 'bg-emerald-50/40' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleStep(step.key)}
                      aria-label={`Marcar ${step.title} como concluída`}
                      className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isDone
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-slate-300 text-transparent hover:border-sky-600'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-900">
                        <span className="font-mono text-slate-400 mr-1.5 tabular-nums">
                          0{step.stepNumber}.
                        </span>
                        <span className={isDone ? 'line-through text-slate-500' : ''}>
                          {step.title}
                        </span>
                      </div>
                      <p className="text-slate-600 leading-relaxed">{step.description}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenStepModule(step.key, step.targetTab)}
                    className="px-3 py-1.5 text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg inline-flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0"
                  >
                    <span>{step.actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={isSaving}
              onClick={() =>
                void persistProgress(completedSteps, {
                  skipped: true,
                  completed: false,
                  closeAfter: true,
                })
              }
              className="px-4 py-2 text-slate-600 hover:text-slate-900 font-semibold text-left sm:text-center"
            >
              Pular configuração por enquanto
            </button>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() =>
                  void persistProgress(
                    ONBOARDING_STEPS.map((s) => s.key),
                    { completed: true, skipped: false, closeAfter: true }
                  )
                }
                className="px-4 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Concluir configuração</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
