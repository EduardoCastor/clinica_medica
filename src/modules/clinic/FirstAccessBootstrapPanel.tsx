import React, { useState } from 'react';
import {
  ShieldCheck,
  UserCheck,
  Mail,
  KeyRound,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { AUTHORIZED_FIRST_ACCESS_EMAIL, useAuth } from '../../contexts/AuthContext';

interface FirstAccessBootstrapPanelProps {
  variant?: 'light' | 'dark';
  onSwitchToLogin: () => void;
  onSuccess?: () => void;
}

export const FirstAccessBootstrapPanel: React.FC<FirstAccessBootstrapPanelProps> = ({
  variant = 'light',
  onSwitchToLogin,
  onSuccess,
}) => {
  const {
    bootstrapStatus,
    registerFirstAccessSuperAdmin,
    resendFirstAccessConfirmation,
  } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(AUTHORIZED_FIRST_ACCESS_EMAIL);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  if (
    !bootstrapStatus.checkedFromCloud ||
    !bootstrapStatus.needsBootstrap ||
    bootstrapStatus.alreadyInitialized
  ) {
    return null;
  }

  const isDark = variant === 'dark';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setResendMsg(null);
    setIsSubmitting(true);

    try {
      const res = await registerFirstAccessSuperAdmin({
        fullName,
        email,
        password,
        confirmPassword,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível iniciar o primeiro acesso.');
        return;
      }

      if (res.autoActivated) {
        if (onSuccess) onSuccess();
        return;
      }

      if (res.requiresEmailConfirmation) {
        setConfirmationSent(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setErrorMsg(null);
    setResendMsg(null);
    setIsResending(true);
    try {
      const res = await resendFirstAccessConfirmation(email);
      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível reenviar o e-mail de confirmação.');
      } else {
        setResendMsg(
          `Novo link de confirmação enviado para ${email.trim().toLowerCase()}. Verifique sua caixa de entrada e spam.`
        );
      }
    } finally {
      setIsResending(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="space-y-4 text-xs">
        <div
          className={`p-4 rounded-2xl border space-y-2.5 ${
            isDark
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-100'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>Confirme seu e-mail para concluir o primeiro acesso</span>
          </div>
          <p className="leading-relaxed">
            Enviamos um link de verificação para{' '}
            <strong className="font-mono">{email.trim().toLowerCase()}</strong>.
          </p>
          <p className="leading-relaxed opacity-90">
            Após clicar no link de confirmação enviado para o seu e-mail (ou retornar e entrar com sua
            senha), seu perfil será ativado automaticamente como Administrador Principal da{' '}
            <strong>Clínica Dr Newton Mureb</strong> (escopo operacional da clínica).
          </p>
        </div>

        {errorMsg && (
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 ${
              isDark
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {resendMsg && (
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 ${
              isDark
                ? 'bg-sky-500/20 border-sky-500/40 text-sky-200'
                : 'bg-sky-50 border-sky-200 text-sky-800'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{resendMsg}</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={isResending}
            onClick={() => void handleResend()}
            className={`w-full py-2.5 px-4 rounded-xl font-semibold border transition flex items-center justify-center gap-2 ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
            <span>{isResending ? 'Reenviando...' : 'Reenviar e-mail de confirmação'}</span>
          </button>

          <button
            type="button"
            onClick={onSwitchToLogin}
            className={`w-full py-2.5 px-4 rounded-xl font-bold text-white transition flex items-center justify-center gap-2 ${
              isDark
                ? 'bg-purple-600 hover:bg-purple-500'
                : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            <span>Já confirmei meu e-mail — Entrar no sistema</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      <div
        className={`p-3.5 rounded-2xl border space-y-1 ${
          isDark
            ? 'bg-purple-500/15 border-purple-400/30 text-purple-100'
            : 'bg-sky-50 border-sky-200 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-2 font-bold text-sm">
          <ShieldCheck
            className={`w-4 h-4 shrink-0 ${isDark ? 'text-purple-300' : 'text-sky-700'}`}
          />
          <span>Primeiro acesso — Clínica Dr Newton Mureb</span>
        </div>
        <p className={`text-[11px] leading-relaxed ${isDark ? 'text-purple-200/90' : 'text-slate-600'}`}>
          Cadastre a conta inicial do administrador da clínica utilizando exclusivamente o e-mail
          autorizado <strong className="font-mono">{AUTHORIZED_FIRST_ACCESS_EMAIL}</strong>. Após a
          confirmação do e-mail, este cadastro inicial será encerrado automaticamente.
        </p>
      </div>

      {errorMsg && (
        <div
          className={`p-3 rounded-xl border flex items-center gap-2 ${
            isDark
              ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div>
        <label
          className={`block text-xs font-bold mb-1.5 ${
            isDark ? 'text-slate-300' : 'text-slate-700'
          }`}
        >
          Nome completo *
        </label>
        <div className="relative">
          <UserCheck
            className={`w-4 h-4 absolute left-3.5 top-3 ${
              isDark ? 'text-slate-500' : 'text-slate-400'
            }`}
          />
          <input
            type="text"
            required
            autoComplete="name"
            placeholder="Ex: Dr. Newton Mureb"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={`w-full pl-10 pr-3 py-2.5 text-xs rounded-xl focus:outline-none focus:ring-2 ${
              isDark
                ? 'bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 focus:ring-purple-500'
                : 'border border-slate-300 text-slate-900 focus:ring-sky-500'
            }`}
          />
        </div>
      </div>

      <div>
        <label
          className={`block text-xs font-bold mb-1.5 ${
            isDark ? 'text-slate-300' : 'text-slate-700'
          }`}
        >
          E-mail autorizado *
        </label>
        <div className="relative">
          <Mail
            className={`w-4 h-4 absolute left-3.5 top-3 ${
              isDark ? 'text-slate-500' : 'text-slate-400'
            }`}
          />
          <input
            type="email"
            required
            autoComplete="email"
            placeholder={AUTHORIZED_FIRST_ACCESS_EMAIL}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full pl-10 pr-3 py-2.5 text-xs rounded-xl font-mono focus:outline-none focus:ring-2 ${
              isDark
                ? 'bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 focus:ring-purple-500'
                : 'border border-slate-300 text-slate-900 focus:ring-sky-500'
            }`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            className={`block text-xs font-bold mb-1.5 ${
              isDark ? 'text-slate-300' : 'text-slate-700'
            }`}
          >
            Senha (mín. 8 caracteres) *
          </label>
          <div className="relative">
            <KeyRound
              className={`w-4 h-4 absolute left-3.5 top-3 ${
                isDark ? 'text-slate-500' : 'text-slate-400'
              }`}
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full pl-10 pr-3 py-2.5 text-xs rounded-xl focus:outline-none focus:ring-2 ${
                isDark
                  ? 'bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 focus:ring-purple-500'
                  : 'border border-slate-300 text-slate-900 focus:ring-sky-500'
              }`}
            />
          </div>
        </div>

        <div>
          <label
            className={`block text-xs font-bold mb-1.5 ${
              isDark ? 'text-slate-300' : 'text-slate-700'
            }`}
          >
            Confirmação de senha *
          </label>
          <div className="relative">
            <KeyRound
              className={`w-4 h-4 absolute left-3.5 top-3 ${
                isDark ? 'text-slate-500' : 'text-slate-400'
              }`}
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full pl-10 pr-3 py-2.5 text-xs rounded-xl focus:outline-none focus:ring-2 ${
                isDark
                  ? 'bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 focus:ring-purple-500'
                  : 'border border-slate-300 text-slate-900 focus:ring-sky-500'
              }`}
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className={`w-full py-2.5 px-4 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-60 ${
          isDark
            ? 'bg-purple-600 hover:bg-purple-500'
            : 'bg-sky-600 hover:bg-sky-700'
        }`}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Criando conta inicial...</span>
          </>
        ) : (
          <>
            <span>Criar conta do administrador</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onSwitchToLogin}
        className={`w-full text-center text-xs font-semibold ${
          isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
        }`}
      >
        Já tenho conta confirmada — Voltar para Entrar
      </button>
    </form>
  );
};
