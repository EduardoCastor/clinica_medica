import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Loader2, Trash2, Ban } from 'lucide-react';
import { FinancialPaymentMethod, FinancialTransaction } from '../../types';
import { FinancialCloudService } from '../../services/financialCloudService';
import {
  PAYMENT_METHOD_LABELS,
  formatCurrencyPtBr,
  formatDatePtBr,
  getSaoPauloTodayYmd,
} from '../../services/financialDateUtils';

interface FinancialSettleModalProps {
  transaction: FinancialTransaction | null;
  onClose: () => void;
  onSettled: () => Promise<void> | void;
}

export const FinancialSettleModal: React.FC<FinancialSettleModalProps> = ({
  transaction,
  onClose,
  onSettled,
}) => {
  const [paymentDate, setPaymentDate] = useState(getSaoPauloTodayYmd());
  const [paymentMethod, setPaymentMethod] = useState<FinancialPaymentMethod>('pix');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!transaction) return;
    setPaymentDate(getSaoPauloTodayYmd());
    setPaymentMethod(transaction.paymentMethod || 'pix');
    setNotes(transaction.notes || '');
    setErrorMsg('');
  }, [transaction]);

  if (!transaction) return null;

  const isReceivable = transaction.type === 'receivable';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMsg('');

    if (!paymentDate) {
      setErrorMsg(
        isReceivable
          ? 'Informe a data real de recebimento.'
          : 'Informe a data real de pagamento.'
      );
      return;
    }

    setIsSaving(true);
    const res = await FinancialCloudService.settleFinancialTransactionInCloud({
      id: transaction.id,
      paymentDate,
      paymentMethod,
      notes,
    });
    setIsSaving(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Não foi possível confirmar a baixa financeira.');
      return;
    }

    await onSettled();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <h3 className="text-sm font-bold">
              {isReceivable ? 'Confirmar Recebimento' : 'Confirmar Pagamento'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-emerald-100 hover:text-white rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 block">{transaction.description}</span>
            <span className="text-slate-600 block">
              {isReceivable
                ? `Paciente: ${transaction.patientName || 'Não informado'}`
                : `Fornecedor: ${transaction.supplierName || 'Não informado'}`}
            </span>
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500">
                Vencimento: {formatDatePtBr(transaction.dueDate)}
              </span>
              <span className="font-extrabold text-slate-900 text-sm tabular-nums">
                {formatCurrencyPtBr(transaction.amount)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {isReceivable ? 'Data de Recebimento *' : 'Data de Pagamento *'}
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Forma de Pagamento
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as FinancialPaymentMethod)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as FinancialPaymentMethod[]).map((key) => (
                  <option key={key} value={key}>
                    {PAYMENT_METHOD_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Observações da Baixa</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Comprovante, observações..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-3 py-2 text-slate-600 hover:text-slate-900"
            >
              Voltar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isReceivable ? 'Confirmar Recebimento' : 'Confirmar Pagamento'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface FinancialCancelOrDeleteModalProps {
  transaction: FinancialTransaction | null;
  canHardDelete: boolean;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

export const FinancialCancelOrDeleteModal: React.FC<FinancialCancelOrDeleteModalProps> = ({
  transaction,
  canHardDelete,
  onClose,
  onCompleted,
}) => {
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!transaction) return;
    setReason('');
    setErrorMsg('');
  }, [transaction]);

  if (!transaction) return null;

  const isPaid = transaction.status === 'paid';
  const hasClinicalLink = Boolean(transaction.appointmentId || transaction.medicalRecordId);
  const allowsHardDelete = canHardDelete && !isPaid && !hasClinicalLink;

  const handleLogicalCancel = async () => {
    if (isBusy) return;
    setErrorMsg('');
    if (reason.trim().length < 3) {
      setErrorMsg('Informe o motivo do cancelamento (mínimo 3 caracteres).');
      return;
    }

    setIsBusy(true);
    const res = await FinancialCloudService.cancelFinancialTransactionInCloud({
      id: transaction.id,
      reason,
    });
    setIsBusy(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Erro ao cancelar lançamento.');
      return;
    }
    await onCompleted();
    onClose();
  };

  const handlePhysicalDelete = async () => {
    if (isBusy || !allowsHardDelete) return;
    setErrorMsg('');
    setIsBusy(true);
    const res = await FinancialCloudService.deleteFinancialTransactionInCloud(transaction.id);
    setIsBusy(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Não foi possível excluir o lançamento.');
      return;
    }
    await onCompleted();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <h3 className="text-sm font-bold">Cancelar ou Excluir Lançamento</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 block">{transaction.description}</span>
            <div className="flex items-center justify-between text-slate-600">
              <span>Vencimento: {formatDatePtBr(transaction.dueDate)}</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatCurrencyPtBr(transaction.amount)}
              </span>
            </div>
          </div>

          {(isPaid || hasClinicalLink) && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] leading-relaxed">
              <strong>Proteção de integridade:</strong>{' '}
              {isPaid
                ? 'Lançamentos já quitados não podem ser apagados fisicamente.'
                : 'Este lançamento possui vínculo clínico (consulta/prontuário).'}
              {' '}Para manter a rastreabilidade e preservar o histórico clínico, utilize o{' '}
              <strong>Cancelamento Lógico</strong> abaixo.
            </div>
          )}

          {transaction.status !== 'cancelled' && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Motivo do Cancelamento Lógico *
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex: Lançamento em duplicidade, paciente desistiu, ajuste de cobrança..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
            {allowsHardDelete ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handlePhysicalDelete()}
                className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir Definitivamente</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={onClose}
                className="px-3 py-2 text-slate-600 hover:text-slate-900"
              >
                Voltar
              </button>
              {transaction.status !== 'cancelled' && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleLogicalCancel()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Ban className="w-3.5 h-3.5" />
                  )}
                  <span>Confirmar Cancelamento</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
