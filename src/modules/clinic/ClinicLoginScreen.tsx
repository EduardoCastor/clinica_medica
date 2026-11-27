import React, { useState } from 'react';
import {
  Building2,
  Stethoscope,
  Users,
  DollarSign,
  ShieldCheck,
  ArrowRight,
  Lock,
  Mail,
  KeyRound,
  Sparkles,
  Loader2,
  CheckCircle2,
  UserPlus,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { ClinicBrandLogo, CLINIC_OFFICIAL_DATA } from '../../components/ClinicBrandLogo';
import { FirstAccessBootstrapPanel } from './FirstAccessBootstrapPanel';
import { getSupabaseConfigError } from '../../services/supabaseClient';
import { DomainResolver } from '../../services/domainResolver';

interface ClinicLoginScreenProps {
  onSuccess?: () => void;
}

export const ClinicLoginScreen: React.FC<ClinicLoginScreenProps> = ({ onSuccess }) => {
  const { clinic } = useTenant();
  const {
    usersList,
    login,
    signInWithEmail,
    sendPasswordReset,
    isSupabaseAuthMode,
    isDevSimulationMode,
    bootstrapStatus,
    authError,
    clearAuthError,
  } = useAuth();
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [isResetMode, setIsResetMode] = useState(false);
  const [isFirstAccessView, setIsFirstAccessView] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canShowFirstAccess = Boolean(
    isSupabaseAuthMode &&
      bootstrapStatus.checkedFromCloud &&
      bootstrapStatus.needsBootstrap &&
      !bootstrapStatus.alreadyInitialized
  );

  React.useEffect(() => {
    if (canShowFirstAccess) {
      setIsFirstAccessView(true);
    } else {
      setIsFirstAccessView(false);
    }
  }, [canShowFirstAccess]);

  // Clinic staff users (rendered exclusively in local dev simulation without cloud auth)
  const staffUsers = usersList.filter(
    (u) => u.role !== 'super_admin' && u.role !== 'patient' && u.role !== 'physiotherapist' && u.isActive
  );

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResetSuccessMessage(null);
    clearAuthError();
    setIsSubmitting(true);

    try {
      if (isResetMode) {
        const res = await sendPasswordReset(emailInput);
        if (!res.success) {
          setErrorMessage(res.error || 'Não foi possível enviar o link de recuperação.');
        } else {
          setResetSuccessMessage(
            `Instruções de redefinição enviadas para ${emailInput.trim().toLowerCase()}. Verifique sua caixa de entrada.`
          );
          setIsResetMode(false);
        }
        return;
      }

      const result = await signInWithEmail(emailInput, passwordInput, 'clinic');
      if (!result.success) {
        setErrorMessage(result.error || 'Falha na autenticação.');
        return;
      }
      if (onSuccess) onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickLogin = (userId: string) => {
    if (!isDevSimulationMode) return;
    login(userId);
    if (onSuccess) onSuccess();
  };

  const configError = getSupabaseConfigError();
  const displayedError = errorMessage || authError || configError;

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-sky-50/40 to-teal-50/30">
      <div className="w-full max-w-xl space-y-6">
        {/* White-Label Card */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden">
          {/* Header with Clinic Branding (Dark Marbled & Gold) */}
          <div
            className="p-8 pb-6 border-b border-[#D4AF37]/30 text-center space-y-4 text-white"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.06) 0%, transparent 55%), radial-gradient(circle at 80% 80%, rgba(212,175,55,0.12) 0%, transparent 50%), linear-gradient(145deg, #1E2024 0%, #2A2D32 55%, #17191C 100%)',
            }}
          >
            <div className="flex justify-center">
              <ClinicBrandLogo
                variant="dark"
                size="lg"
                showSubtitle
                subtitle={CLINIC_OFFICIAL_DATA.specialty}
              />
            </div>

            <div>
              <h1 className="text-sm font-bold text-[#E5C158] tracking-wide uppercase">
                {clinic.legalName || CLINIC_OFFICIAL_DATA.legalName}
              </h1>
              <p className="text-[11px] text-slate-300 mt-1">
                CNPJ: {clinic.documentNumber || CLINIC_OFFICIAL_DATA.cnpj} · {CLINIC_OFFICIAL_DATA.crm}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {CLINIC_OFFICIAL_DATA.street}, {CLINIC_OFFICIAL_DATA.number},{' '}
                {CLINIC_OFFICIAL_DATA.complement} · {CLINIC_OFFICIAL_DATA.city} -{' '}
                {CLINIC_OFFICIAL_DATA.state}
              </p>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 text-[#E5C158] text-[11px] font-semibold border border-[#D4AF37]/30">
              <ShieldCheck className="w-3.5 h-3.5 text-[#E5C158]" />
              <span>Portal Administrativo & Clínico · Acesso Restrito</span>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {canShowFirstAccess && (
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setIsFirstAccessView(true);
                    setErrorMessage(null);
                    clearAuthError();
                  }}
                  className={`py-2 px-3 rounded-lg font-bold transition flex items-center justify-center gap-1.5 ${
                    isFirstAccessView
                      ? 'bg-white text-sky-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Primeiro acesso</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsFirstAccessView(false);
                    setErrorMessage(null);
                    clearAuthError();
                  }}
                  className={`py-2 px-3 rounded-lg font-bold transition ${
                    !isFirstAccessView
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Entrar
                </button>
              </div>
            )}

            {canShowFirstAccess && isFirstAccessView ? (
              <FirstAccessBootstrapPanel
                variant="light"
                onSwitchToLogin={() => setIsFirstAccessView(false)}
                onSuccess={onSuccess}
              />
            ) : (
            /* Real Email/Password Login & Password Recovery Form */
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {displayedError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">
                  {displayedError}
                </div>
              )}

              {resetSuccessMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{resetSuccessMessage}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  E-mail Profissional
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={CLINIC_OFFICIAL_DATA.email}
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {!isResetMode && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      Senha de Acesso
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsResetMode(true);
                        setErrorMessage(null);
                        setResetSuccessMessage(null);
                      }}
                      className="text-[11px] font-semibold text-sky-700 hover:text-sky-900"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder="••••••••••••"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isResetMode ? 'Enviando link...' : 'Autenticando...'}</span>
                  </>
                ) : (
                  <>
                    <span>{isResetMode ? 'Enviar link de redefinição' : 'Entrar no Sistema'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {isResetMode && (
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(false);
                    setErrorMessage(null);
                  }}
                  className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Voltar para o login com senha
                </button>
              )}
            </form>
            )}

            {/* Quick Demo Access ONLY in local dev without cloud auth */}
            {isDevSimulationMode && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Simulação Local de Desenvolvimento (Sem Banco Conectado)
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {staffUsers.map((u) => {
                    const roleBadge =
                      u.role === 'clinic_admin'
                        ? { label: 'Admin Clínica', icon: <Building2 className="w-3 h-3 text-sky-600" /> }
                        : u.role === 'doctor'
                        ? { label: 'Médico · CRM/RJ', icon: <Stethoscope className="w-3 h-3 text-blue-600" /> }
                        : u.role === 'receptionist'
                        ? { label: 'Recepção', icon: <Users className="w-3 h-3 text-amber-600" /> }
                        : { label: 'Financeiro', icon: <DollarSign className="w-3 h-3 text-emerald-600" /> };

                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => handleQuickLogin(u.id)}
                        className="text-left p-2.5 rounded-xl border border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 transition group flex items-center justify-between"
                      >
                        <div className="truncate pr-2">
                          <div className="flex items-center gap-1.5">
                            {roleBadge.icon}
                            <span className="text-xs font-bold text-slate-800 group-hover:text-sky-700 truncate">
                              {u.fullName}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
                            {roleBadge.label} · {u.email}
                          </span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-sky-600 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer Security Notice */}
          <div className="p-4 bg-slate-50 border-t border-slate-100 text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Conformidade CFM nº 1.821/2007 · LGPD Dados Sensíveis · Acesso Autenticado</span>
          </div>
        </div>

        {(DomainResolver.isClinicLoginRoute() || DomainResolver.isSimulationAllowed()) && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => DomainResolver.navigateToLanding()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para a página institucional do MedSync</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
