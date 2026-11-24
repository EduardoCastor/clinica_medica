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
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface SaasAdminLoginScreenProps {
  onSuccess?: () => void;
}

export const SaasAdminLoginScreen: React.FC<SaasAdminLoginScreenProps> = ({ onSuccess }) => {
  const {
    usersList,
    login,
    signInWithEmail,
    sendPasswordReset,
    isDevSimulationMode,
    authError,
    clearAuthError,
  } = useAuth();
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [isResetMode, setIsResetMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const superAdminUser = usersList.find((u) => u.role === 'super_admin') || usersList[0];

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
            'Credenciais inválidas. Este painel é restrito aos Super Administradores da plataforma MedSync SaaS.'
        );
        return;
      }
      if (onSuccess) onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickDemoLogin = () => {
    if (!isDevSimulationMode || !superAdminUser) return;
    login(superAdminUser.id);
    if (onSuccess) onSuccess();
  };

  const displayedError = errorMessage || authError;

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-purple-950/40 to-slate-900 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Super Admin Card */}
        <div className="bg-slate-900 rounded-3xl border border-purple-500/30 shadow-2xl overflow-hidden backdrop-blur-md">
          {/* Header */}
          <div className="p-8 pb-6 bg-gradient-to-b from-purple-900/40 to-transparent border-b border-slate-800 text-center space-y-3">
            <div className="inline-flex p-3.5 bg-gradient-to-tr from-purple-600 to-indigo-600 text-white rounded-2xl shadow-lg ring-1 ring-purple-400/40">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h1 className="text-xl font-black text-white tracking-tight">
                MedSync SaaS <span className="text-purple-400 font-semibold">Master Admin</span>
              </h1>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                painelclinica.beaverstraining.com.br
              </p>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-[11px] font-semibold border border-purple-400/30">
              <Lock className="w-3.5 h-3.5 text-purple-400" />
              <span>Ambiente de Controle Geral · Super Administrador</span>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {/* Form */}
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
                  E-mail de Super Administrador
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="admin@drnewtonmureb.com.br"
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
                      Chave Mestra de Acesso
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

            {/* Quick Demo Access Button ONLY in local dev simulation without Supabase */}
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

          {/* Footer Security Notice */}
          <div className="p-4 bg-slate-950 border-t border-slate-800 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-purple-400" />
            <span>Auditoria estrita de acessos · Zero conhecimento de prontuários</span>
          </div>
        </div>
      </div>
    </div>
  );
};
