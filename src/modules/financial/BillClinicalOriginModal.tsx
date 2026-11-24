import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Calendar, Stethoscope, CheckCircle2 } from 'lucide-react';
import {
  Appointment,
  Branch,
  FinancialCategory,
  FinancialPaymentMethod,
  Patient,
  Professional,
  Service,
} from '../../types';
import {
  BillableAppointmentItem,
  FinancialCloudService,
  isUuid,
} from '../../services/financialCloudService';
import {
  PAYMENT_METHOD_LABELS,
  formatCurrencyPtBr,
  formatDatePtBr,
  getSaoPauloTodayYmd,
  normalizeDateToSaoPauloYmd,
} from '../../services/financialDateUtils';

interface BillClinicalOriginModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  activeBranchId: string;
  branches: Branch[];
  categories: FinancialCategory[];
  patients: Patient[];
  professionals: Professional[];
  services: Service[];
  preselectedAppointment?: Appointment | null;
  onBilled: () => Promise<void> | void;
}

export const BillClinicalOriginModal: React.FC<BillClinicalOriginModalProps> = ({
  isOpen,
  onClose,
  organizationId,
  activeBranchId,
  branches,
  categories,
  patients,
  professionals,
  services,
  preselectedAppointment,
  onBilled,
}) => {
  const [originTab, setOriginTab] = useState<'appointment' | 'treatment'>('appointment');
  const [isLoadingApts, setIsLoadingApts] = useState(false);
  const [billableApts, setBillableApts] = useState<BillableAppointmentItem[]>([]);
  const [selectedAptId, setSelectedAptId] = useState('');

  // Treatment fields
  const [patientId, setPatientId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [branchId, setBranchId] = useState('');

  // Billing details
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [issueDate, setIssueDate] = useState(getSaoPauloTodayYmd());
  const [dueDate, setDueDate] = useState(getSaoPauloTodayYmd());
  const [status, setStatus] = useState<'pending' | 'paid'>('pending');
  const [paymentDate, setPaymentDate] = useState(getSaoPauloTodayYmd());
  const [paymentMethod, setPaymentMethod] = useState<FinancialPaymentMethod>('pix');
  const [installments, setInstallments] = useState(1);
  const [notes, setNotes] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const receivableCats = categories.filter(
    (c) => c.categoryType === 'receivable' && c.isActive
  );

  const cloudServices = services.filter((s) => isUuid(s.id));
  const selectableServices = cloudServices.length > 0 ? cloudServices : services;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setErrorMsg('');
    const today = getSaoPauloTodayYmd();
    const defaultBranch =
      activeBranchId && activeBranchId !== 'all' ? activeBranchId : branches[0]?.id || '';

    setBranchId(defaultBranch);
    setIssueDate(today);
    setDueDate(today);
    setPaymentDate(today);
    setStatus('pending');
    setPaymentMethod('pix');
    setInstallments(1);
    setNotes('');

    const defaultConsultCat =
      receivableCats.find((c) => c.normalizedName.includes('consulta')) || receivableCats[0];
    setCategoryId(defaultConsultCat?.id || '');

    if (preselectedAppointment) {
      setOriginTab('appointment');
      setSelectedAptId(preselectedAppointment.id);
      setBranchId(preselectedAppointment.branchId || defaultBranch);
      const matchedSrv = services.find(
        (s) =>
          s.id === preselectedAppointment.serviceId ||
          s.name.toLowerCase() === (preselectedAppointment.serviceName || '').toLowerCase()
      );
      setDescription(
        `${preselectedAppointment.serviceName || 'Consulta Médica'} - ${preselectedAppointment.patientName}`
      );
      setAmountInput(matchedSrv && matchedSrv.price > 0 ? String(matchedSrv.price) : '');
      const aptYmd = normalizeDateToSaoPauloYmd(preselectedAppointment.startTime) || today;
      setIssueDate(aptYmd);
      setDueDate(aptYmd);
    } else {
      setOriginTab('appointment');
      setSelectedAptId('');
      setDescription('');
      setAmountInput('');
    }

    setPatientId(patients[0]?.id || '');
    setProfessionalId(professionals[0]?.id || '');
    setServiceId(selectableServices[0]?.id || '');

    setIsLoadingApts(true);
    FinancialCloudService.fetchBillableAppointmentsFromCloud(organizationId, activeBranchId)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setErrorMsg(res.error);
          return;
        }
        setBillableApts(res.items);
        if (!preselectedAppointment) {
          const firstUnbilled = res.items.find((it) => !it.existingFinancialTx);
          if (firstUnbilled) {
            applyAppointmentSelection(firstUnbilled);
          }
        } else {
          const matched = res.items.find(
            (it) => it.appointment.id === preselectedAppointment.id
          );
          if (matched) applyAppointmentSelection(matched);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingApts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, preselectedAppointment]);

  const applyAppointmentSelection = (item: BillableAppointmentItem) => {
    const apt = item.appointment;
    setSelectedAptId(apt.id);
    setBranchId(apt.branchId || branchId);
    const matchedSrv = services.find(
      (s) => s.id === apt.serviceId || s.name.toLowerCase() === (apt.serviceName || '').toLowerCase()
    );
    const realPrice = item.servicePrice > 0 ? item.servicePrice : matchedSrv?.price || 0;
    setDescription(`${apt.serviceName || 'Consulta Médica'} - ${apt.patientName}`);
    setAmountInput(realPrice > 0 ? String(realPrice) : '');
    const aptYmd = normalizeDateToSaoPauloYmd(apt.startTime) || getSaoPauloTodayYmd();
    setIssueDate(aptYmd);
    setDueDate(aptYmd);
    const consultCat = receivableCats.find((c) => c.normalizedName.includes('consulta'));
    if (consultCat) setCategoryId(consultCat.id);
  };

  const handleSwitchOriginTab = (next: 'appointment' | 'treatment') => {
    setOriginTab(next);
    setErrorMsg('');
    if (next === 'treatment') {
      const srv = selectableServices.find((s) => s.id === serviceId) || selectableServices[0];
      if (srv) {
        setServiceId(srv.id);
        setDescription(srv.name);
        setAmountInput(srv.price > 0 ? String(srv.price) : '');
      }
      const trtCat = receivableCats.find((c) => c.normalizedName.includes('tratamento'));
      if (trtCat) setCategoryId(trtCat.id);
    } else {
      const selectedItem = billableApts.find((it) => it.appointment.id === selectedAptId);
      if (selectedItem) {
        applyAppointmentSelection(selectedItem);
      } else {
        const firstUnbilled = billableApts.find((it) => !it.existingFinancialTx);
        if (firstUnbilled) applyAppointmentSelection(firstUnbilled);
      }
    }
  };

  if (!isOpen) return null;

  const selectedAptItem = billableApts.find((it) => it.appointment.id === selectedAptId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMsg('');

    const parsedAmount = Number(amountInput.replace(',', '.'));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg(
        'O serviço selecionado não possui valor definido ou o valor é inválido. Informe o valor real a cobrar.'
      );
      return;
    }

    if (status === 'paid' && !paymentDate) {
      setErrorMsg('Informe a data de recebimento para lançar já quitado.');
      return;
    }

    const selectedCat = categories.find((c) => c.id === categoryId);

    if (originTab === 'appointment') {
      if (!selectedAptItem) {
        setErrorMsg('Selecione uma consulta válida para faturar.');
        return;
      }
      if (selectedAptItem.existingFinancialTx) {
        setErrorMsg(
          `Esta consulta já possui cobrança ativa (${selectedAptItem.existingFinancialTx.receiptNumber || selectedAptItem.existingFinancialTx.id.slice(0, 8)}). Duplicidade bloqueada por idempotência.`
        );
        return;
      }

      const apt = selectedAptItem.appointment;
      const targetBranch = branches.find((b) => b.id === (apt.branchId || branchId)) || branches[0];

      setIsSaving(true);
      const res = await FinancialCloudService.createReceivableFromClinicalOrigin({
        originType: 'appointment',
        organizationId: apt.organizationId || organizationId,
        branchId: targetBranch?.id || '',
        branchName: targetBranch?.name || apt.branchName || 'Unidade',
        patientId: apt.patientId,
        patientName: apt.patientName,
        professionalId: apt.professionalId,
        professionalName: apt.professionalName,
        appointmentId: apt.id,
        serviceId: apt.serviceId,
        treatmentName: apt.serviceName,
        categoryId: selectedCat?.id,
        categoryName: selectedCat?.name || 'Consulta Médica',
        description: description.trim() || `${apt.serviceName || 'Consulta Médica'} - ${apt.patientName}`,
        amount: parsedAmount,
        issueDate,
        dueDate,
        status,
        paymentDate: status === 'paid' ? paymentDate : undefined,
        paymentMethod,
        installments,
        notes: notes.trim() || undefined,
        idempotencyKey: `apt:${apt.id}`,
      });
      setIsSaving(false);

      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível gerar a cobrança desta consulta.');
        return;
      }
      await onBilled();
      onClose();
      return;
    }

    // Treatment billing
    const pat = patients.find((p) => p.id === patientId);
    if (!pat) {
      setErrorMsg('Selecione o paciente vinculado ao tratamento.');
      return;
    }
    const srv = selectableServices.find((s) => s.id === serviceId);
    if (!srv) {
      setErrorMsg('Selecione o tratamento/procedimento.');
      return;
    }
    const prof = professionals.find((p) => p.id === professionalId);
    const branch = branches.find((b) => b.id === branchId) || branches[0];

    setIsSaving(true);
    const res = await FinancialCloudService.createReceivableFromClinicalOrigin({
      originType: 'treatment',
      organizationId,
      branchId: branch?.id || '',
      branchName: branch?.name || 'Unidade',
      patientId: pat.id,
      patientName: pat.fullName,
      professionalId: prof?.id,
      professionalName: prof?.fullName,
      serviceId: isUuid(srv.id) ? srv.id : undefined,
      treatmentName: srv.name,
      categoryId: selectedCat?.id,
      categoryName: selectedCat?.name || 'Tratamento / Procedimento',
      description: description.trim() || `${srv.name} - ${pat.fullName}`,
      amount: parsedAmount,
      issueDate,
      dueDate,
      status,
      paymentDate: status === 'paid' ? paymentDate : undefined,
      paymentMethod,
      installments,
      notes: notes.trim() || undefined,
      idempotencyKey: `trt:${organizationId}:${pat.id}:${srv.id}:${issueDate}`,
    });
    setIsSaving(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Não foi possível gerar a cobrança deste tratamento.');
      return;
    }

    await onBilled();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">Faturar Consulta ou Tratamento</h3>
            <p className="text-[11px] text-slate-400">
              Geração controlada de Contas a Receber com prevenção automática de duplicidade (idempotência).
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
          {!preselectedAppointment && (
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => handleSwitchOriginTab('appointment')}
                className={`py-2 rounded-lg font-bold transition inline-flex items-center justify-center gap-1.5 ${
                  originTab === 'appointment'
                    ? 'bg-white text-sky-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Cobrar Consulta (Agenda)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchOriginTab('treatment')}
                className={`py-2 rounded-lg font-bold transition inline-flex items-center justify-center gap-1.5 ${
                  originTab === 'treatment'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Stethoscope className="w-3.5 h-3.5" />
                <span>Cobrar Tratamento / Procedimento</span>
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {originTab === 'appointment' ? (
            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Consulta Realizada / Agendada *
                </label>
                {isLoadingApts ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                    <span>Buscando consultas no Supabase...</span>
                  </div>
                ) : (
                  <select
                    value={selectedAptId}
                    disabled={Boolean(preselectedAppointment)}
                    onChange={(e) => {
                      const found = billableApts.find(
                        (it) => it.appointment.id === e.target.value
                      );
                      if (found) applyAppointmentSelection(found);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="">Selecione uma consulta...</option>
                    {billableApts.map((it) => {
                      const apt = it.appointment;
                      const dtLabel = formatDatePtBr(apt.startTime);
                      const billedTag = it.existingFinancialTx
                        ? ` [JÁ FATURADO - ${formatCurrencyPtBr(it.existingFinancialTx.amount)}]`
                        : '';
                      return (
                        <option key={apt.id} value={apt.id}>
                          {dtLabel} · {apt.patientName} · {apt.serviceName || 'Consulta'} ({apt.status}){billedTag}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {selectedAptItem?.existingFinancialTx && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Esta consulta já possui lançamento financeiro ativo (
                    <strong>{selectedAptItem.existingFinancialTx.receiptNumber || 'Registrado'}</strong> ·{' '}
                    {formatCurrencyPtBr(selectedAptItem.existingFinancialTx.amount)}).
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Paciente *</label>
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Selecione o paciente...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tratamento / Procedimento *
                </label>
                <select
                  value={serviceId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setServiceId(nextId);
                    const srv = selectableServices.find((s) => s.id === nextId);
                    if (srv) {
                      setDescription(srv.name);
                      setAmountInput(srv.price > 0 ? String(srv.price) : '');
                    }
                  }}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {selectableServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.price > 0 ? `(${formatCurrencyPtBr(s.price)})` : '(Informar valor)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Profissional</label>
                <select
                  value={professionalId}
                  onChange={(e) => setProfessionalId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {professionals.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Unidade / Filial</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Descrição *</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Categoria *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                {receivableCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Valor (R$) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Informe o valor real"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Forma de Pagamento</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Data Emissão</label>
              <input
                type="date"
                required
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Data Vencimento</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Situação</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'pending' | 'paid')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="pending">Pendente (A Receber)</option>
                <option value="paid">Recebido (Quitado)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Data Recebimento{status === 'paid' ? ' *' : ''}
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
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informações opcionais para a cobrança..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                isSaving ||
                (originTab === 'appointment' && Boolean(selectedAptItem?.existingFinancialTx))
              }
              className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSaving ? 'Faturando...' : 'Gerar Conta a Receber'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
