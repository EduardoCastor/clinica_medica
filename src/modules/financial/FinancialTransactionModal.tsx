import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Link2 } from 'lucide-react';
import {
  Branch,
  FinancialCategory,
  FinancialPaymentMethod,
  FinancialTransaction,
  FinancialTransactionType,
  Patient,
  Professional,
  Service,
} from '../../types';
import { FinancialCloudService, isUuid } from '../../services/financialCloudService';
import {
  ORIGIN_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  getSaoPauloTodayYmd,
} from '../../services/financialDateUtils';

interface FinancialTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType: FinancialTransactionType;
  editingTransactionId?: string | null;
  organizationId: string;
  activeBranchId: string;
  branches: Branch[];
  categories: FinancialCategory[];
  patients: Patient[];
  professionals: Professional[];
  services: Service[];
  onSaved: () => Promise<void> | void;
}

export const FinancialTransactionModal: React.FC<FinancialTransactionModalProps> = ({
  isOpen,
  onClose,
  defaultType,
  editingTransactionId,
  organizationId,
  activeBranchId,
  branches,
  categories,
  patients,
  professionals,
  services,
  onSaved,
}) => {
  const isEditing = Boolean(editingTransactionId);
  const [isLoadingFresh, setIsLoadingFresh] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [txType, setTxType] = useState<FinancialTransactionType>(defaultType);
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [treatmentName, setTreatmentName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<FinancialPaymentMethod>('pix');
  const [installments, setInstallments] = useState(1);
  const [status, setStatus] = useState<'pending' | 'paid' | 'cancelled'>('pending');
  const [issueDate, setIssueDate] = useState(getSaoPauloTodayYmd());
  const [dueDate, setDueDate] = useState(getSaoPauloTodayYmd());
  const [paymentDate, setPaymentDate] = useState(getSaoPauloTodayYmd());
  const [notes, setNotes] = useState('');

  // Preserved metadata from existing record
  const [loadedTx, setLoadedTx] = useState<FinancialTransaction | null>(null);

  const filteredCategories = categories.filter(
    (c) => c.categoryType === txType && (c.isActive || c.id === categoryId)
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setErrorMsg('');

    const today = getSaoPauloTodayYmd();
    const defaultBranch =
      activeBranchId && activeBranchId !== 'all' ? activeBranchId : branches[0]?.id || '';

    if (editingTransactionId) {
      setIsLoadingFresh(true);
      FinancialCloudService.fetchFinancialTransactionByIdFromCloud(editingTransactionId)
        .then((res) => {
          if (cancelled) return;
          if (res.error || !res.transaction) {
            setErrorMsg(res.error || 'Não foi possível carregar o lançamento no Supabase.');
            return;
          }
          const tx = res.transaction;
          setLoadedTx(tx);
          setTxType(tx.type);
          setBranchId(tx.branchId || defaultBranch);
          setCategoryId(tx.categoryId || '');
          setPatientId(tx.patientId || '');
          setProfessionalId(tx.professionalId || '');
          setServiceId(tx.serviceId || '');
          setTreatmentName(tx.treatmentName || '');
          setSupplierName(tx.supplierName || '');
          setDescription(tx.description);
          setAmountInput(tx.amount > 0 ? String(tx.amount) : '');
          setPaymentMethod(tx.paymentMethod);
          setInstallments(tx.installments || 1);
          setStatus(tx.status);
          setIssueDate(tx.issueDate || today);
          setDueDate(tx.dueDate || today);
          setPaymentDate(tx.paymentDate || today);
          setNotes(tx.notes || '');
        })
        .finally(() => {
          if (!cancelled) setIsLoadingFresh(false);
        });
    } else {
      setLoadedTx(null);
      setTxType(defaultType);
      setBranchId(defaultBranch);
      const firstCat = categories.find((c) => c.categoryType === defaultType && c.isActive);
      setCategoryId(firstCat?.id || '');
      setPatientId('');
      setProfessionalId(defaultType === 'receivable' ? professionals[0]?.id || '' : '');
      setServiceId('');
      setTreatmentName('');
      setSupplierName('');
      setDescription('');
      setAmountInput('');
      setPaymentMethod(defaultType === 'payable' ? 'boleto' : 'pix');
      setInstallments(1);
      setStatus('pending');
      setIssueDate(today);
      setDueDate(today);
      setPaymentDate(today);
      setNotes('');
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, editingTransactionId, defaultType, activeBranchId, branches, categories, professionals]);

  // Adjust default category when switching receivable <-> payable during new creation
  const handleChangeTxType = (nextType: FinancialTransactionType) => {
    if (isEditing) return;
    setTxType(nextType);
    const matchingCat = categories.find((c) => c.categoryType === nextType && c.isActive);
    setCategoryId(matchingCat?.id || '');
    setPaymentMethod(nextType === 'payable' ? 'boleto' : 'pix');
    if (nextType === 'payable') {
      setPatientId('');
      setServiceId('');
      setTreatmentName('');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isLoadingFresh) return;
    setErrorMsg('');

    const parsedAmount = Number(amountInput.replace(',', '.'));
    if (!description.trim()) {
      setErrorMsg('Informe a descrição do lançamento.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Informe um valor válido maior que zero.');
      return;
    }
    if (!issueDate) {
      setErrorMsg('Informe a data de emissão/lançamento.');
      return;
    }
    if (!dueDate) {
      setErrorMsg('Informe a data de vencimento.');
      return;
    }
    if (status === 'paid' && !paymentDate) {
      setErrorMsg(
        txType === 'receivable'
          ? 'Informe a data de recebimento para lançar como Recebido.'
          : 'Informe a data de pagamento para lançar como Pago.'
      );
      return;
    }

    const branch = branches.find((b) => b.id === branchId) || branches[0];
    const selectedCat = categories.find((c) => c.id === categoryId);
    const selectedPatient = patientId ? patients.find((p) => p.id === patientId) : undefined;
    const selectedProf = professionalId
      ? professionals.find((p) => p.id === professionalId)
      : undefined;
    const selectedService = serviceId ? services.find((s) => s.id === serviceId) : undefined;

    const payload: FinancialTransaction = {
      id: loadedTx?.id || `fin_${Date.now()}`,
      organizationId: loadedTx?.organizationId || organizationId,
      branchId: branch?.id || loadedTx?.branchId || '',
      branchName: branch?.name || loadedTx?.branchName || 'Unidade',
      categoryId: selectedCat?.id || loadedTx?.categoryId,
      categoryName:
        selectedCat?.name ||
        loadedTx?.categoryName ||
        (txType === 'payable' ? 'Outras despesas' : 'Outras Receitas'),
      originType:
        loadedTx?.originType ||
        (txType === 'payable' ? 'expense' : selectedService ? 'treatment' : 'manual'),
      patientId: txType === 'receivable' ? selectedPatient?.id || loadedTx?.patientId : undefined,
      patientName:
        txType === 'receivable' ? selectedPatient?.fullName || loadedTx?.patientName : undefined,
      appointmentId: loadedTx?.appointmentId,
      medicalRecordId: loadedTx?.medicalRecordId,
      professionalId:
        txType === 'receivable'
          ? selectedProf?.id || loadedTx?.professionalId
          : undefined,
      professionalName:
        txType === 'receivable'
          ? selectedProf?.fullName || loadedTx?.professionalName
          : undefined,
      serviceId:
        txType === 'receivable' ? selectedService?.id || loadedTx?.serviceId : undefined,
      treatmentName:
        txType === 'receivable'
          ? selectedService?.name || treatmentName.trim() || loadedTx?.treatmentName
          : undefined,
      supplierName: txType === 'payable' ? supplierName.trim() || undefined : undefined,
      description: description.trim(),
      amount: Number(parsedAmount.toFixed(2)),
      type: txType,
      paymentMethod,
      installments: Math.max(1, Number(installments || 1)),
      status,
      issueDate,
      dueDate,
      paymentDate: status === 'paid' ? paymentDate : undefined,
      paidAt: status === 'paid' ? `${paymentDate}T12:00:00-03:00` : undefined,
      receiptNumber:
        loadedTx?.receiptNumber ||
        (txType === 'receivable'
          ? `REC-${issueDate.slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`
          : `PAG-${issueDate.slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`),
      notes: notes.trim() || undefined,
      idempotencyKey: loadedTx?.idempotencyKey,
      cancelledAt: loadedTx?.cancelledAt,
      cancellationReason: loadedTx?.cancellationReason,
      createdAt: loadedTx?.createdAt || new Date().toISOString(),
    };

    setIsSaving(true);
    const res = await FinancialCloudService.saveFinancialTransactionToCloud(payload);
    setIsSaving(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Erro ao salvar lançamento financeiro no Supabase.');
      return;
    }

    await onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">
              {isEditing
                ? `Editar ${txType === 'payable' ? 'Conta a Pagar' : 'Conta a Receber'}`
                : txType === 'payable'
                  ? 'Nova Despesa (Conta a Pagar)'
                  : 'Novo Recebimento (Conta a Receber)'}
            </h3>
            <p className="text-[11px] text-slate-400">
              Persistência real no Supabase · Fuso oficial America/Sao_Paulo
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {isLoadingFresh ? (
            <div className="py-10 flex items-center justify-center gap-2 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
              <span>Carregando dados atualizados do Supabase...</span>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {loadedTx && (loadedTx.appointmentId || loadedTx.medicalRecordId || loadedTx.originType) && (
                <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-sky-900 flex items-center gap-2 text-[11px]">
                  <Link2 className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>
                    Origem: <strong>{ORIGIN_TYPE_LABELS[loadedTx.originType || 'manual']}</strong>
                    {loadedTx.appointmentId ? ` · Vinculado à consulta (${loadedTx.appointmentId.slice(0, 8)})` : ''}
                    {loadedTx.treatmentName ? ` · Tratamento: ${loadedTx.treatmentName}` : ''}
                  </span>
                </div>
              )}

              {!isEditing && (
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => handleChangeTxType('receivable')}
                    className={`py-2 rounded-lg font-bold transition ${
                      txType === 'receivable'
                        ? 'bg-white text-sky-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Conta a Receber (Receita)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeTxType('payable')}
                    className={`py-2 rounded-lg font-bold transition ${
                      txType === 'payable'
                        ? 'bg-white text-rose-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Conta a Pagar (Despesa)
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Unidade / Filial *</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Categoria *</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">
                      {txType === 'payable' ? 'Outras despesas' : 'Outras Receitas'}
                    </option>
                    {filteredCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {!c.isActive ? ' (Inativa)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {txType === 'receivable' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Paciente (opcional)
                    </label>
                    <select
                      value={patientId}
                      onChange={(e) => setPatientId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Sem vínculo / Avulso</option>
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.fullName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Profissional (opcional)
                    </label>
                    <select
                      value={professionalId}
                      onChange={(e) => setProfessionalId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Clínica / Geral</option>
                      {professionals.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.fullName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Serviço / Tratamento (opcional)
                    </label>
                    <select
                      value={serviceId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setServiceId(nextId);
                        const srv = services.find((s) => s.id === nextId);
                        if (srv) {
                          setTreatmentName(srv.name);
                          if (!description.trim() || !isEditing) {
                            setDescription(srv.name);
                          }
                          if (srv.price > 0 && (!amountInput || !isEditing)) {
                            setAmountInput(String(srv.price));
                          }
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Lançamento avulso / manual</option>
                      {services
                        .filter((s) => isUuid(s.id) || s.id === serviceId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.price > 0 ? `(R$ ${s.price.toFixed(2)})` : '(Sem valor)'}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Fornecedor / Favorecido
                  </label>
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="Ex: Enel, Imobiliária, Laboratório, Fornecedor de insumos..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    txType === 'payable'
                      ? 'Ex: Aluguel Consultório - Competência Nov/2026'
                      : 'Ex: Consulta Endocrinologia / Sessão Soroterapia'
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
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

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Parcelas</label>
                  <input
                    type="number"
                    min="1"
                    max="36"
                    value={installments}
                    onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Data de Emissão *
                  </label>
                  <input
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Data de Vencimento *
                  </label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Situação *</label>
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as 'pending' | 'paid' | 'cancelled')
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="pending">Pendente</option>
                    <option value="paid">
                      {txType === 'receivable' ? 'Recebido (Quitado)' : 'Pago (Quitado)'}
                    </option>
                    {isEditing && <option value="cancelled">Cancelado</option>}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {txType === 'receivable' ? 'Data Recebimento' : 'Data Pagamento'}
                    {status === 'paid' ? ' *' : ''}
                  </label>
                  <input
                    type="date"
                    disabled={status !== 'paid'}
                    required={status === 'paid'}
                    value={status === 'paid' ? paymentDate : ''}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Observações</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalhes adicionais, número de nota fiscal, código de barras, observações..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={onClose}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSaving ? 'Salvando...' : isEditing ? 'Salvar Alterações' : 'Cadastrar Lançamento'}</span>
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
