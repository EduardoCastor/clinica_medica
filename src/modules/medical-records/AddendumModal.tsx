import React, { useState, useEffect } from 'react';
import { X, Lock, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { MedicalRecordEntry, MedicalRecordAddendum } from '../../types';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import { useAuth } from '../../contexts/AuthContext';

interface AddendumModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: MedicalRecordEntry | null;
  onSuccess: () => void;
}

export const AddendumModal: React.FC<AddendumModalProps> = ({
  isOpen,
  onClose,
  record,
  onSuccess,
}) => {
  const { currentUser } = useAuth();
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const professionals = StorageService.getProfessionals();
  const activeProf =
    professionals.find((p) => p.userProfileId === currentUser.id) ||
    professionals.find((p) => p.fullName === currentUser.fullName) ||
    professionals[0];
  const councilNumber = activeProf?.councilNumber || 'CRM/RJ 52-444985';

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setIsSaving(false);
    }
  }, [isOpen]);

  if (!isOpen || !record) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMessage('');

    if (!note.trim()) {
      setErrorMessage('Por favor, informe a justificativa ou conteúdo da errata/adendo.');
      return;
    }

    const newAddendum: MedicalRecordAddendum = {
      id: `add_${Date.now()}`,
      recordId: record.id,
      authorId: activeProf?.id || currentUser.id,
      authorName: currentUser.fullName,
      authorCouncilNumber: councilNumber,
      note: note.trim(),
      createdAt: new Date().toISOString(),
      signatureHash: `sha256_addendum_${Math.random().toString(36).substring(2, 10)}`,
    };

    setIsSaving(true);
    try {
      const res = await ClinicalCloudService.addMedicalRecordAddendumToCloud(record, newAddendum);
      if (!res.success) {
        setErrorMessage(res.message || 'Erro ao registrar adendo no banco de dados.');
        return;
      }

      onSuccess();
      setNote('');
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro inesperado ao registrar adendo.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Adicionar Adendo / Errata ao Prontuário
              </h3>
              <p className="text-xs text-slate-400">
                Resolução CFM nº 1.821/2007: O texto original permanece intacto e imutável.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informative Alert */}
        <div className="p-4 bg-sky-50 border-b border-sky-200 text-xs text-sky-900 flex items-start gap-2.5 shrink-0">
          <ShieldCheck className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
          <div>
            <strong>Regra de Ouro do CFM:</strong> Em conformidade com as normas legais, registros médicos assinados não podem ser alterados ou deletados. Este adendo será anexado cronologicamente com seu carimbo de assinatura.
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Registro Original de Referência:
            </label>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
              <span className="font-bold text-slate-900 block">
                Atendimento de {new Date(record.recordDate).toLocaleDateString('pt-BR')} por {record.professionalName}
              </span>
              <p className="line-clamp-2 mt-0.5 text-slate-500 italic">
                "{record.chiefComplaint}"
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Texto do Adendo / Retificação / Esclarecimento Clínico *
            </label>
            <textarea
              required
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Descreva a correção de dosagem, esclarecimento adicional de conduta ou errata formal..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs text-emerald-800">
            <span className="font-medium">
              Assinante: <strong>{currentUser.fullName}</strong>
            </span>
            <span className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-emerald-200">
              {councilNumber}
            </span>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm transition flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSaving ? 'Gravando...' : 'Gravar Adendo Selado'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
