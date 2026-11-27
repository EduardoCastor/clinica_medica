import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  UserPlus,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import {
  AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL,
  useAuth,
} from '../../contexts/AuthContext';
import { DomainResolver, PRODUCTION_DOMAINS } from '../../services/domainResolver';
import { getSupabaseConfigError } from '../../services/supabaseClient';

interface SaasAdminLoginScreenProps {
  onSuccess?: () => void;
}

export const SaasAdminLoginScreen: React.FC<SaasAdminLoginScreenProps> = ({ onSuccess }) => {
  const {
    usersList,
    login,
    logout,
    currentUser,
    isAuthenticated,
    isPlatformSuperAdmin,
    signInWithEmail,
    sendPasswordReset,
    registerPendingPlatformSuperAdmin,
    resendFirstAccessConfirmation,
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
  const [isPlatformActivationView, setIsPlatformActivationView] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Platform Super Admin pending activation state (only when beaverstraining@gmail.com is pending_activation)
  const [activationName, setActivationName] = useState('Beaver Soluções em Tecnologia');
  const [activationEmail, setActivationEmail] = useState(AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL);
  const [activationPassword, setActivationPassword] = useState('');
  const [activationConfirmPassword, setActivationConfirmPassword] = useState('');
  const [activationEmailSent, setActivationEmailSent] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const saasAdminRedirectTo =
    typeof window !== 'undefined'
      ? DomainResolver.isSimulationAllowed()
        ? window.location.origin
        : `https://${PRODUCTION_DOMAINS.SAAS_ADMIN}`
      : `https://${PRODUCTION_DOMAINS.SAAS_ADMIN}`;

  const canShowPlatformActivation = Boolean(
    isSupabaseAuthMode &&
      bootstrapStatus.checkedFromCloud &&
      !bootstrapStatus.platformInitialized &&
      bootstrapStatus.platformNeedsActivation
  );

  const superAdminUser =
    usersList.find(
      (u) =>
        u.role === 'super_admin' &&
        u.email.toLowerCase() === AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL
    ) || usersList.find((u) => u.role === 'super_admin');

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResetSuccessMessage(null);
    clearAuthError();
    setIsSubmitting(true);

    try {
      if (isResetMode) {
        const res = await sendPasswordReset(emailInput, saasAdminRedirectTo);
        if (!res.success) {
          setErrorMessage(res.error || 'Falha ao enviar link de redefinição de senha.');
        } else {
          setResetSuccessMessage(
            `E-mail de redefinição enviado para ${emailInput.trim().toLowerCase()}.`
          );
          setIsResetMode(false);
        }
        return;
      }

      const result = await signInWithEmail(emailInput, passwordInput, 'saas_admin');
      if (!result.success) {
        setErrorMessage(
          result.error ||
            'Credenciais inválidas. Este painel é restrito ao Super Administrador da plataforma MedSync.'
        );
        return;
      }
      if (onSuccess) onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResetSuccessMessage(null);
    clearAuthError();
    setIsSubmitting(true);

    try {
      const res = await registerPendingPlatformSuperAdmin({
        fullName: activationName,
        email: activationEmail,
        password: activationPassword,
        confirmPassword: activationConfirmPassword,
      });

      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível ativar a conta da plataforma.');
        return;
      }

      if (res.autoActivated) {
        if (onSuccess) onSuccess();
        return;
      }

      if (res.requiresEmailConfirmation) {
        setActivationEmailSent(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendActivation = async () => {
    setErrorMessage(null);
    setResetSuccessMessage(null);
    setIsResending(true);
    try {
      const cleanActivationEmail = activationEmail.trim().toLowerCase() || AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL;
      const res = await resendFirstAccessConfirmation(cleanActivationEmail, saasAdminRedirectTo);
      if (!res.success) {
        setErrorMessage(res.error || 'Falha ao reenviar link de confirmação.');
      } else {
        setResetSuccessMessage(
          `Link de confirmação reenviado para ${cleanActivationEmail}.`
        );
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleQuickDemoLogin = () => {
    if (!isDevSimulationMode || !superAdminUser) return;
    login(superAdminUser.id);
    if (onSuccess) onSuccess();
  };

  const configError = getSupabaseConfigError();
  const displayedError = errorMessage || authError || configError;

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-purple-950/40 to-slate-900 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        <div className="bg-slate-900 rounded-3xl border border-purple-500/30 shadow-2xl overflow-hidden backdrop-blur-md">
          <div className="p-8 pb-6 bg-gradient-to-b from-purple-900/40 to-transparent border-b border-slate-800 text-center space-y-3">
            <div className="inline-flex p-3.5 bg-gradient-to-tr from-purple-600 to-indigo-600 text-white rounded-2xl shadow-lg ring-1 ring-purple-400/40">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h1 className="text-xl font-black text-white tracking-tight">
                MedSync <span className="text-purple-400 font-semibold">Administração Geral</span>
              </h1>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                painelclinica.beaverstraining.com.br
              </p>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-[11px] font-semibold border border-purple-400/30">
              <Lock className="w-3.5 h-3.5 text-purple-400" />
              <span>Plataforma SaaS · Beaver Soluções em Tecnologia</span>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {isAuthenticated && !isPlatformSuperAdmin && (
              <div className="p-4 bg-rose-500/15 border border-rose-500/40 text-rose-200 rounded-2xl space-y-3 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <strong className="block text-rose-100">
                      Acesso não autorizado ao Painel Geral SaaS
                    </strong>
                    <p className="leading-relaxed">
                      A sessão atual (<span className="font-mono">{currentUser.email}</span> ·{' '}
                      {currentUser.role}) pertence a uma clínica cliente e não possui permissão de
                      Super Administrador da plataforma.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="w-full py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl inline-flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Encerrar sessão da clínica e entrar como Super Admin</span>
                </button>
              </div>
            )}

            {canShowPlatformActivation && (
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-800/90 rounded-xl text-xs border border-slate-700">
                <button
                  type="button"
                  onClick={() => {
                    setIsPlatformActivationView(false);
                    setErrorMessage(null);
                    clearAuthError();
                  }}
                  className={`py-2 px-3 rounded-lg font-bold transition ${
                    !isPlatformActivationView
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlatformActivationView(true);
                    setErrorMessage(null);
                    clearAuthError();
                  }}
                  className={`py-2 px-3 rounded-lg font-bold transition flex items-center justify-center gap-1.5 ${
                    isPlatformActivationView
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Ativar Super Admin</span>
                </button>
              </div>
            )}

            {canShowPlatformActivation && isPlatformActivationView ? (
              activationEmailSent ? (
                <div className="space-y-4 text-xs">
                  <div className="p-4 rounded-2xl border bg-emerald-500/15 border-emerald-500/30 text-emerald-100 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <span>Confirme seu e-mail para assumir o Super Admin</span>
                    </div>
                    <p>
                      Enviamos um link de confirmação para{' '}
                      <strong className="font-mono">{AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL}</strong>.
                    </p>
                    <p className="opacity-90">
                      Após confirmar o e-mail e fazer login, a transferência da plataforma será concluída automaticamente mantendo <span className="font-mono">admin@drnewtonmureb.com.br</span> como administrador da clínica.
                    </p>
                  </div>

                  {resetSuccessMessage && (
                    <div className="p-3 bg-sky-500/20 border border-sky-500/40 text-sky-200 rounded-xl flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{resetSuccessMessage}</span>
                    </div>
                  )}

                  {displayedError && (
                    <div className="p-3 bg-rose-500/20 border border-rose-500/40 text-rose-200 rounded-xl flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{displayedError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={isResending}
                    onClick={() => void handleResendActivation()}
                    className="w-full py-2.5 px-4 rounded-xl font-semibold border bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                    <span>{isResending ? 'Reenviando...' : 'Reenviar e-mail de confirmação'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActivationEmailSent(false);
                      setIsPlatformActivationView(false);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-white bg-purple-600 hover:bg-purple-500 flex items-center justify-center gap-2"
                  >
                    <span>Já confirmei meu e-mail — Entrar</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <form onSubmit={handleActivationSubmit} className="space-y-4 text-xs">
                  <div className="p-3.5 rounded-2xl border bg-purple-500/15 border-purple-400/30 text-purple-100 space-y-1">
                    <strong className="block">Ativação Segura do Super Admin SaaS</strong>
                    <p className="text-[11px] text-purple-200/90 leading-relaxed">
                      Exclusivo para <span className="font-mono">{AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL}</span>. Defina sua própria senha e confirme o e-mail para concluir a separação administrativa.
                    </p>
                  </div>

                  {displayedError && (
                    <div className="p-3 bg-rose-500/20 border border-rose-500/40 text-rose-200 rounded-xl flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{displayedError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      Nome / Empresa Responsável
                    </label>
                    <input
                      type="text"
                      required
                      value={activationName}
                      onChange={(e) => setActivationName(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      E-mail do Super Administrador SaaS
                    </label>
                    <input
                      type="email"
                      required
                      value={activationEmail}
                      onChange={(e) => setActivationEmail(e.target.value)}
                      placeholder={AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL}
                      className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-purple-200 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        Nova Senha (mín. 8)
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={activationPassword}
                        onChange={(e) => setActivationPassword(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        Confirmar Senha
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={activationConfirmPassword}
                        onChange={(e) => setActivationConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Ativando...</span>
                      </>
                    ) : (
                      <>
                        <span>Registrar e Enviar Confirmação</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )
            ) : (
              <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
                {displayedError && (
                  <div className="p-3 bg-rose-500/20 border border-rose-500/40 text-rose-200 rounded-xl flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{displayedError}</span>
                  </div>
                )}

                {resetSuccessMessage && (
                  <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{resetSuccessMessage}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    E-mail do Super Administrador SaaS
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder={AUTHORIZED_PLATFORM_SUPER_ADMIN_EMAIL}
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
                    />
                  </div>
                </div>

                {!isResetMode && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-300">
                        Senha de Acesso
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsResetMode(true);
                          setErrorMessage(null);
                          setResetSuccessMessage(null);
                        }}
                        className="text-[11px] font-semibold text-purple-300 hover:text-purple-200"
                      >
                        Esqueci minha senha
                      </button>
                    </div>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        placeholder="••••••••••••"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{isResetMode ? 'Enviando link...' : 'Autenticando...'}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {isResetMode ? 'Enviar Link de Redefinição' : 'Autenticar no Painel Geral'}
                      </span>
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
                    className="w-full text-center text-xs font-semibold text-slate-400 hover:text-white"
                  >
                    Voltar para o login com senha
                  </button>
                )}
              </form>
            )}

            {isDevSimulationMode && superAdminUser && (
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Simulação Local de Desenvolvimento
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                </div>

                <button
                  type="button"
                  onClick={handleQuickDemoLogin}
                  className="w-full text-left p-3 rounded-xl border border-purple-500/30 bg-purple-950/40 hover:bg-purple-900/40 transition group flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-purple-400" />
                      <span className="text-xs font-bold text-white group-hover:text-purple-300">
                        Entrar como Super Administrador (Dev Local)
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 block mt-0.5 font-mono">
                      {superAdminUser.fullName} · {superAdminUser.email}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-purple-400 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-950 border-t border-slate-800 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-purple-400" />
            <span>Auditoria estrita de acessos · Zero conhecimento de prontuários</span>
          </div>
        </div>
      </div>
    </div>
  );
};
