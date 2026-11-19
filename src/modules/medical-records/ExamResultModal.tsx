import React, { useState, useEffect } from 'react';
import { X, ClipboardCheck, AlertCircle, Upload, FileText, Loader2 } from 'lucide-react';
import { Patient, ExamResult } from '../../types';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';

interface ExamResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient | null;
  medicalRecordId?: string;
  onSuccess: () => void;
}

export const ExamResultModal: React.FC<ExamResultModalProps> = ({
  isOpen,
  onClose,
  patient,
  medicalRecordId,
  onSuccess,
}) => {
  const { currentUser } = useAuth();
  const { organization, activeBranchId, branches } = useTenant();

  const [examName, setExamName] = useState('');
  const [examCategory, setExamCategory] = useState<'laboratorial' | 'imagem' | 'outros'>('laboratorial');
  const [performedDate, setPerformedDate] = useState(new Date().toISOString().split('T')[0]);
  const [laboratoryName, setLaboratoryName] = useState('Laboratório Fleury');
  const [reportSummary, setReportSummary] = useState('');
  const [referenceValues, setReferenceValues] = useState('');
  const [status, setStatus] = useState<'performed' | 'evaluated' | 'critical'>('evaluated');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const professionals = StorageService.getProfessionals();
  const activeProf =
    professionals.find((p) => p.userProfileId === currentUser.id) ||
    professionals.find((p) => p.fullName === currentUser.fullName) ||
    professionals[0];

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setIsSaving(false);
    }
  }, [isOpen]);

  if (!isOpen || !patient) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMessage('');

    if (!examName.trim() || !reportSummary.trim()) {
      setErrorMessage('Por favor, informe o nome do exame e o laudo/conclusão.');
      return;
    }

    const resolvedBranchId =
      activeBranchId !== 'all'
        ? activeBranchId
        : patient.originBranchId || branches[0]?.id || 'branch_cf_centro';

    const newResult: ExamResult = {
      id: `exam_res_${Date.now()}`,
      organizationId: patient.organizationId || organization.id || 'org_mureb_01',
      branchId: resolvedBranchId,
      patientId: patient.id,
      medicalRecordId,
      professionalId: activeProf?.id || currentUser.id,
      examName: examName.trim(),
      examCategory,
      performedDate,
      laboratoryName: laboratoryName.trim(),
      reportSummary: reportSummary.trim(),
      referenceValues: referenceValues.trim() || undefined,
      status,
      attachmentUrl: attachmentUrl.trim() || undefined,
      evaluatedByProfessionalName: status === 'evaluated' ? currentUser.fullName : undefined,
      evaluatedAt: status === 'evaluated' ? new Date().toISOString() : undefined,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      const res = await ClinicalCloudService.saveExamResultToCloud(newResult, patient, selectedFile);
      if (!res.success) {
        setErrorMessage(res.message || 'Erro ao gravar resultado de exame no banco de dados.');
        return;
      }

      onSuccess();
      setExamName('');
      setReportSummary('');
      setReferenceValues('');
      setAttachmentUrl('');
      setSelectedFile(null);
      setNotes('');
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro inesperado ao salvar resultado de exame.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8 max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/20 text-teal-400 rounded-lg">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Registrar Resultado / Laudo de Exame
              </h3>
              <p className="text-xs text-slate-400">
                Paciente: {patient.fullName}
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

        {errorMessage && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome do Exame *
              </label>
              <input
                type="text"
                required
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                placeholder="Ex: Curva Glicêmica, PCR-us, Ultrassom"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Categoria
              </label>
              <select
                value={examCategory}
                onChange={(e) => setExamCategory(e.target.value as 'laboratorial' | 'imagem' | 'outros')}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="laboratorial">Laboratorial (Sangue/Urina)</option>
                <option value="imagem">Imagem (USG/RX/Ressonância)</option>
                <option value="outros">Bioimpedância / Funcional</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Data de Realização
              </label>
              <input
                type="date"
                value={performedDate}
                onChange={(e) => setPerformedDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Laboratório / Clínica Executante
              </label>
              <input
                type="text"
                value={laboratoryName}
                onChange={(e) => setLaboratoryName(e.target.value)}
                placeholder="Ex: Fleury, Dasa, Alta, Própria Clínica"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Conclusão do Laudo / Valores Encontrados *
            </label>
            <textarea
              required
              rows={3}
              value={reportSummary}
              onChange={(e) => setReportSummary(e.target.value)}
              placeholder="Descreva os achados clínicos, taxas laboratoriais ou conclusão diagnóstica..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Valores de Referência / Notas Técnicas
            </label>
            <input
              type="text"
              value={referenceValues}
              onChange={(e) => setReferenceValues(e.target.value)}
              placeholder="Ex: Valor normal < 1.0 mg/L; Índice HOMA-IR de normalidade < 2.0"
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Status da Avaliação Médica
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'performed' | 'evaluated' | 'critical')}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold"
              >
                <option value="evaluated">Avaliado pelo Médico (Concluído)</option>
                <option value="critical">Alterado / Crítico (Requer Atenção)</option>
                <option value="performed">Realizado (Aguardando Parecer)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Link Externo do Laudo (Opcional)
              </label>
              <input
                type="text"
                value={attachmentUrl}
                onChange={(e) => setAttachmentUrl(e.target.value)}
                placeholder="https://... (opcional)"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-600"
              />
            </div>
          </div>

          {/* Upload de PDF / Imagem para Storage Privado */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-2">
            <label className="block text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-sky-600" />
              <span>Anexar Arquivo do Laudo (PDF, JPG, PNG ou WEBP - máx. 15 MB)</span>
            </label>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-white file:text-slate-700 hover:file:bg-slate-100 cursor-pointer"
            />
            {selectedFile && (
              <div className="flex items-center justify-between text-[11px] text-teal-800 bg-teal-50 px-2.5 py-1.5 rounded-lg border border-teal-200">
                <span className="flex items-center gap-1.5 font-medium truncate">
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{selectedFile.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-rose-600 hover:underline font-semibold ml-2 shrink-0"
                >
                  Remover
                </button>
              </div>
            )}
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
              <span>{isSaving ? 'Enviando e Salvando...' : 'Salvar Resultado no Prontuário'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
