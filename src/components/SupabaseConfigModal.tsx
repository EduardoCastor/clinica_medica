import React, { useState } from 'react';
import { Database, CheckCircle2, AlertTriangle, Key, Globe, RefreshCw, X, ShieldCheck } from 'lucide-react';
import {
  getSupabaseCredentials,
  saveSupabaseCredentials,
  clearSupabaseCredentials,
  validatePublicSupabaseKey,
} from '../services/supabaseClient';
import { StorageService } from '../services/storage';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({ isOpen, onClose }) => {
  const currentCreds = getSupabaseCredentials();
  const [url, setUrl] = useState(currentCreds.url || '');
  const [anonKey, setAnonKey] = useState(currentCreds.anonKey || '');
  const [isSaved, setIsSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(currentCreds.configError || null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!url.trim() || !anonKey.trim()) {
      setErrorMsg('Informe a URL do projeto Supabase e a chave pública (anon / sb_publishable_).');
      return;
    }

    const keyValidation = validatePublicSupabaseKey(anonKey);
    if (keyValidation.isSecretKey || !keyValidation.valid) {
      setErrorMsg(
        keyValidation.error ||
          'Chave inválida para uso no navegador. Utilize apenas a chave pública (anon / sb_publishable_).'
      );
      return;
    }

    const saved = saveSupabaseCredentials(url.trim(), anonKey.trim());
    if (!saved.success) {
      setErrorMsg(saved.error || 'Não foi possível validar as credenciais informadas.');
      return;
    }

    setIsSaved(true);
    setStatusMsg('Conexão configurada com chave pública segura.');
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 900);
  };

  const handleResetToDemo = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    clearSupabaseCredentials();
    StorageService.resetAll();
    setUrl('');
    setAnonKey('');
    setConfirmReset(false);
    setErrorMsg(null);
    setStatusMsg('Credenciais locais limpas e cache redefinido com sucesso.');
    setTimeout(() => {
      setStatusMsg(null);
      onClose();
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8">
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Conexão com a Nuvem</h3>
              <p className="text-xs text-slate-400">Segurança por clínica e sincronização em tempo real</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-800 space-y-1">
            <p className="font-semibold">Proteção Estrita de Chaves no Navegador</p>
            <p className="text-emerald-700">
              Utilize exclusivamente a chave pública (<code className="font-mono">anon</code> ou{' '}
              <code className="font-mono">sb_publishable_*</code>). Chaves administrativas (
              <code className="font-mono">service_role</code> / <code className="font-mono">sb_secret_*</code>) são bloqueadas automaticamente no cliente e devem ficar apenas nos Secrets das Edge Functions.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{statusMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>Endereço do Projeto (URL)</span>
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://seu-projeto.supabase.co"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span>Chave Pública de Acesso (anon / sb_publishable)</span>
            </label>
            <input
              type="password"
              value={anonKey}
              onChange={(e) => {
                setAnonKey(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Nunca informe a chave privada service_role ou sb_secret_ no navegador.
            </p>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />
              <span>Ambiente isolado por organização</span>
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Todas as permissões de equipe, prontuários e agendamentos respeitam o isolamento e a licença ativa da clínica autenticada.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleResetToDemo}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{confirmReset ? 'Confirmar limpeza local?' : 'Limpar Credenciais Locais'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm transition"
              >
                {isSaved ? 'Conectado!' : 'Salvar Conexão'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
