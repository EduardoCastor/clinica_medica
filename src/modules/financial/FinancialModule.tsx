import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  Calendar,
  Plus,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { FinancialTransaction, Patient } from '../../types';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import { useTenant } from '../../contexts/TenantContext';
import {
  DocumentPrintModal,
  PrintableDocumentType,
} from '../../components/medical-documents/DocumentPrintModal';

export const FinancialModule: React.FC = () => {
  const { activeBranchId, branches, organization } = useTenant();

  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const professionals = StorageService.getProfessionals();
  const services = StorageService.getServices();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [updatingTxId, setUpdatingTxId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending' | 'cancelled'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [printableDoc, setPrintableDoc] = useState<PrintableDocumentType | null>(null);

  // New Transaction Form State
  const [patientId, setPatientId] = useState('');
  const [professionalId, setProfessionalId] = useState(professionals[0]?.id || '');
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [description, setDescription] = useState(services[0]?.name || 'Consulta Médica');
  const [amount, setAmount] = useState(services[0]?.price || 850);
  const [paymentMethod, setPaymentMethod] = useState<
    'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'
  >('pix');
  const [installments, setInstallments] = useState(1);
  const [txStatus, setTxStatus] = useState<'paid' | 'pending'>('paid');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [branchId, setBranchId] = useState(
    activeBranchId === 'all' ? branches[0]?.id || '' : activeBranchId
  );

  const refreshFinancial = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [finRes, patRes] = await Promise.all([
        StorageService.fetchFinancialFromCloud(activeBranchId, organization.id),
        ClinicalCloudService.fetchPatientsFromCloud(activeBranchId),
      ]);
      setTransactions(finRes.transactions);
      if (finRes.error) {
        setLoadError(finRes.error);
      }
      setPatients(patRes.patients);
      setPatientId((prev) => prev || patRes.patients[0]?.id || '');
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Erro ao carregar movimentações financeiras.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, organization.id]);

  useEffect(() => {
    void refreshFinancial();
  }, [refreshFinancial]);

  useEffect(() => {
    setBranchId(activeBranchId === 'all' ? branches[0]?.id || '' : activeBranchId);
  }, [activeBranchId, branches]);

  const filteredTransactions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return transactions.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.description.toLowerCase().includes(q) ||
        (t.patientName || '').toLowerCase().includes(q) ||
        (t.receiptNumber || '').toLowerCase().includes(q) ||
        (t.professionalName || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, statusFilter, searchTerm]);

  // Metrics
  const paidTransactions = transactions.filter((t) => t.status === 'paid');
  const totalReceived = paidTransactions.reduce((acc, curr) => acc + curr.amount, 0);
  const totalPending = transactions
    .filter((t) => t.status === 'pending')
    .reduce((acc, curr) => acc + curr.amount, 0);

  const handleOpenForm = () => {
    setActionError('');
    setProfessionalId((prev) => prev || professionals[0]?.id || '');
    setServiceId((prev) => prev || services[0]?.id || '');
    setPatientId((prev) => prev || patients[0]?.id || '');
    setBranchId(activeBranchId === 'all' ? branches[0]?.id || '' : activeBranchId);
    setDueDate(new Date().toISOString().split('T')[0]);
    setTxStatus('paid');
    setIsFormOpen(true);
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setActionError('');

    if (!description.trim() || Number(amount) <= 0) {
      setActionError('Informe a descrição do serviço e um valor maior que zero.');
      return;
    }

    const patient = patients.find((p) => p.id === patientId);
    const professional = professionals.find((p) => p.id === professionalId);
    const branch = branches.find((b) => b.id === branchId) || branches[0];

    const newTx: FinancialTransaction = {
      id: `fin_${Date.now()}`,
      organizationId: organization.id || '',
      branchId: branch?.id || '',
      branchName: branch?.name || 'Unidade',
      patientId: patient?.id,
      patientName: patient?.fullName,
      professionalId: professional?.id,
      professionalName: professional?.fullName,
      serviceId: serviceId || undefined,
      description: description.trim(),
      amount: Number(amount),
      type: 'receivable',
      paymentMethod,
      installments,
      status: txStatus,
      dueDate,
      paidAt: txStatus === 'paid' ? new Date().toISOString() : undefined,
      receiptNumber: `REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: new Date().toISOString(),
    };

    setIsSaving(true);
    const res = await StorageService.saveFinancialTransactionToCloud(newTx);
    setIsSaving(false);
    if (!res.success) {
      setActionError(res.error || 'Erro ao gravar lançamento financeiro no Supabase.');
      return;
    }

    setIsFormOpen(false);
    await refreshFinancial();
  };

  const handleMarkAsPaid = async (txId: string) => {
    setActionError('');
    setUpdatingTxId(txId);
    const res = await StorageService.updateFinancialTransactionStatusInCloud(txId, 'paid');
    setUpdatingTxId(null);
    if (!res.success) {
      setActionError(res.error || 'Não foi possível dar baixa neste lançamento.');
      return;
    }
    await refreshFinancial();
  };

  const openReceiptPrint = (t: FinancialTransaction) => {
    const matchedPatient = t.patientId ? patients.find((p) => p.id === t.patientId) : undefined;
    setPrintableDoc({
      type: 'financial_receipt',
      data: t,
      patientName: t.patientName || matchedPatient?.fullName,
      patientCpf: matchedPatient?.documentCpf,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Módulo Financeiro & Faturamento da Clínica
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Controle de contas a receber, faturamento por filial/profissional, formas de pagamento e emissão de recibos digitais.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void refreshFinancial()}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            onClick={handleOpenForm}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Recebimento</span>
          </button>
        </div>
      </div>

      {(loadError || actionError) && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError || loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void refreshFinancial()}
            className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-rose-200 rounded-lg hover:bg-rose-100 inline-flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Faturamento Total Recebido</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-sm font-semibold text-slate-600">R$</span>
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {isLoading
                ? '—'
                : totalReceived.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-[11px] text-emerald-600 font-medium mt-1">
            {paidTransactions.length}{' '}
            {paidTransactions.length === 1 ? 'recebimento conciliado' : 'recebimentos conciliados'}
          </p>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Contas a Receber (Pendentes)</span>
            <Calendar className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-sm font-semibold text-slate-600">R$</span>
            <span className="text-2xl font-extrabold text-amber-600 tabular-nums">
              {isLoading
                ? '—'
                : totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-[11px] text-amber-700 font-medium mt-1">
            Parcelas e consultas a faturar
          </p>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Ticket Médio (Quitados)</span>
            <TrendingUp className="w-4 h-4 text-sky-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-sm font-semibold text-slate-600">R$</span>
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
              {isLoading
                ? '—'
                : paidTransactions.length > 0
                  ? (totalReceived / paidTransactions.length).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : '0,00'}
            </span>
          </div>
          <p className="text-[11px] text-sky-600 font-medium mt-1">
            Consultas & Sessões Terapêuticas
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por paciente, recibo, descrição ou profissional..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'all' | 'paid' | 'pending' | 'cancelled')
          }
          className="px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <option value="all">Todos os Status</option>
          <option value="paid">Quitados (Pagos)</option>
          <option value="pending">Pendentes</option>
          <option value="cancelled">Cancelados</option>
        </select>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Histórico de Lançamentos Financeiros</h3>
          <span className="text-xs text-slate-400">{filteredTransactions.length} registros</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Recibo / Data</th>
                <th className="py-3 px-4">Descrição do Serviço</th>
                <th className="py-3 px-4">Paciente</th>
                <th className="py-3 px-4">Profissional & Filial</th>
                <th className="py-3 px-4">Forma & Parcelas</th>
                <th className="py-3 px-4 text-right">Valor Líquido</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                      <span>Carregando lançamentos financeiros do Supabase...</span>
                    </span>
                  </td>
                </tr>
              ) : loadError && transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-rose-600">
                    Não foi possível carregar os lançamentos financeiros.
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Nenhum lançamento financeiro encontrado para o filtro atual.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900 block">
                        {t.receiptNumber || t.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(t.paidAt || t.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-semibold text-slate-800">{t.description}</td>

                    <td className="py-3.5 px-4 font-medium text-slate-700">
                      {t.patientName || 'Cliente Direto'}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="font-medium text-slate-800 block">
                        {t.professionalName || 'Clínica'}
                      </span>
                      <span className="text-[10px] text-slate-400 block">{t.branchName}</span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="font-semibold text-slate-700 uppercase block">
                        {t.paymentMethod}
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        {t.installments > 1
                          ? `${t.installments}x de R$ ${(t.amount / t.installments).toFixed(2)}`
                          : 'À vista'}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="font-bold text-slate-900 block tabular-nums text-sm">
                        R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          t.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : t.status === 'pending'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {t.status === 'paid'
                          ? 'PAGO'
                          : t.status === 'pending'
                            ? 'PENDENTE'
                            : 'CANCELADO'}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {t.status === 'pending' && (
                          <button
                            type="button"
                            disabled={updatingTxId === t.id}
                            onClick={() => void handleMarkAsPaid(t.id)}
                            className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            {updatingTxId === t.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            <span>Quitar</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openReceiptPrint(t)}
                          className="px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition"
                        >
                          Ver Recibo / PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Transaction Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 my-6">
            <h3 className="text-base font-bold text-slate-900">Novo Recebimento / Lançamento</h3>

            <form onSubmit={handleCreateTransaction} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Filial</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Paciente</label>
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="">Sem vínculo / Cliente avulso</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.documentCpf})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Profissional</label>
                  <select
                    value={professionalId}
                    onChange={(e) => setProfessionalId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {professionals.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Serviço</label>
                  <select
                    value={serviceId}
                    onChange={(e) => {
                      setServiceId(e.target.value);
                      const s = services.find((srv) => srv.id === e.target.value);
                      if (s) {
                        setDescription(s.name);
                        setAmount(s.price);
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (R$ {s.price})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Forma</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(
                        e.target.value as
                          | 'pix'
                          | 'credit_card'
                          | 'debit_card'
                          | 'cash'
                          | 'transfer'
                      )
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="pix">Pix Instantâneo</option>
                    <option value="credit_card">Cartão de Crédito</option>
                    <option value="debit_card">Cartão de Débito</option>
                    <option value="cash">Dinheiro</option>
                    <option value="transfer">Transferência / TED</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Parcelas</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={installments}
                    onChange={(e) => setInstallments(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Situação</label>
                  <select
                    value={txStatus}
                    onChange={(e) => setTxStatus(e.target.value as 'paid' | 'pending')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="paid">Pago (Recebido)</option>
                    <option value="pending">Pendente (A Receber)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vencimento</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 text-slate-600 hover:text-slate-800 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSaving ? 'Gravando...' : 'Salvar Lançamento'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Isolated A4 Print Portal for Receipts */}
      <DocumentPrintModal
        isOpen={Boolean(printableDoc)}
        onClose={() => setPrintableDoc(null)}
        document={printableDoc}
      />
    </div>
  );
};
