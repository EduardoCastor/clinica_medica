import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign,
  Calendar,
  Plus,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
  Search,
  FileSpreadsheet,
  Tags,
  Stethoscope,
  Edit2,
  Printer,
  Ban,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  FilterX,
} from 'lucide-react';
import {
  FinancialCategory,
  FinancialComputedStatus,
  FinancialTransaction,
  FinancialTransactionType,
  Patient,
  Service,
} from '../../types';
import { StorageService } from '../../services/storage';
import { FinancialCloudService } from '../../services/financialCloudService';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import {
  ORIGIN_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  computeFinancialEffectiveStatus,
  formatCurrencyPtBr,
  formatDatePtBr,
  getFinancialStatusLabel,
  getMonthStartEndYmd,
  getSaoPauloTodayYmd,
  isYmdWithinRange,
  normalizeDateToSaoPauloYmd,
} from '../../services/financialDateUtils';
import {
  exportConsolidatedFinancialToXlsx,
  exportPayablesToXlsx,
  exportReceivablesToXlsx,
} from '../../services/financialExcelExport';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  DocumentPrintModal,
  PrintableDocumentType,
} from '../../components/medical-documents/DocumentPrintModal';
import { FinancialTransactionModal } from './FinancialTransactionModal';
import { FinancialCategoriesModal } from './FinancialCategoriesModal';
import { BillClinicalOriginModal } from './BillClinicalOriginModal';
import {
  FinancialCancelOrDeleteModal,
  FinancialSettleModal,
} from './FinancialSettleAndCancelModals';

export interface FinancialDeepLink {
  transactionId?: string;
  tab?: FinancialTransactionType;
}

interface FinancialModuleProps {
  initialDeepLink?: FinancialDeepLink | null;
  onClearDeepLink?: () => void;
}

type StatusFilterOption = 'all' | FinancialComputedStatus;
type SortOption = 'due_asc' | 'due_desc' | 'issue_desc' | 'amount_desc';

export const FinancialModule: React.FC<FinancialModuleProps> = ({
  initialDeepLink,
  onClearDeepLink,
}) => {
  const { activeBranchId, branches, organization, clinic } = useTenant();
  const {
    canConsultMenu,
    canCreateInMenu,
    canEditInMenu,
    canDeleteInMenu,
    canAdminMenu,
  } = useAuth();

  const canConsult = canConsultMenu('financial');
  const canCreate = canCreateInMenu('financial');
  const canEdit = canEditInMenu('financial');
  const canHardDelete = canDeleteInMenu('financial') || canAdminMenu('financial');
  const canManageCategories = canEdit || canAdminMenu('financial');

  const professionals = StorageService.getProfessionals();

  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Active Tab & Highlighted Deep Link
  const [activeTab, setActiveTab] = useState<FinancialTransactionType>('receivable');
  const [highlightedTxId, setHighlightedTxId] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [patientFilter, setPatientFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const [payTo, setPayTo] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('due_asc');

  // Modals
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txModalDefaultType, setTxModalDefaultType] =
    useState<FinancialTransactionType>('receivable');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [isBillOriginOpen, setIsBillOriginOpen] = useState(false);
  const [settlingTx, setSettlingTx] = useState<FinancialTransaction | null>(null);
  const [cancelOrDeleteTx, setCancelOrDeleteTx] = useState<FinancialTransaction | null>(null);
  const [printableDoc, setPrintableDoc] = useState<PrintableDocumentType | null>(null);

  const todayYmd = getSaoPauloTodayYmd();
  const currentMonthRange = useMemo(() => getMonthStartEndYmd(todayYmd), [todayYmd]);

  const refreshFinancial = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [finRes, catRes, srvRes, patRes] = await Promise.all([
        FinancialCloudService.fetchFinancialFromCloud(activeBranchId, organization.id),
        FinancialCloudService.fetchFinancialCategoriesFromCloud(organization.id),
        FinancialCloudService.fetchServicesFromCloud(organization.id),
        ClinicalCloudService.fetchPatientsFromCloud(activeBranchId).catch((err) => ({
          patients: [] as Patient[],
          error: err instanceof Error ? err.message : undefined,
        })),
      ]);

      setTransactions(finRes.transactions);
      setCategories(catRes.categories);
      setServices(srvRes.services);
      setPatients(patRes.patients);

      const errors: string[] = [];
      if (finRes.error) errors.push(finRes.error);
      if (catRes.error) errors.push(catRes.error);
      if (srvRes.error) errors.push(srvRes.error);
      if (errors.length > 0) {
        setLoadError(errors.join(' · '));
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Erro ao carregar dados financeiros do Supabase.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeBranchId, organization.id]);

  useEffect(() => {
    void refreshFinancial();
  }, [refreshFinancial]);

  // Handle Deep-Link from Dashboard
  useEffect(() => {
    if (!initialDeepLink) return;
    if (initialDeepLink.tab) {
      setActiveTab(initialDeepLink.tab);
    }
    if (initialDeepLink.transactionId) {
      const found = transactions.find((t) => t.id === initialDeepLink.transactionId);
      if (found && !initialDeepLink.tab) {
        setActiveTab(found.type);
      }
      setHighlightedTxId(initialDeepLink.transactionId);
      setStatusFilter('all');
      setCategoryFilter('all');
      setPatientFilter('all');
      setBranchFilter('all');
      setSearchTerm('');
      setDueFrom('');
      setDueTo('');
      setPayFrom('');
      setPayTo('');
    }
    onClearDeepLink?.();
  }, [initialDeepLink, transactions, onClearDeepLink]);

  useEffect(() => {
    if (!highlightedTxId) return;
    const timer = window.setTimeout(() => setHighlightedTxId(null), 7000);
    return () => window.clearTimeout(timer);
  }, [highlightedTxId]);

  const applyCommonFilters = useCallback(
    (list: FinancialTransaction[], targetType: FinancialTransactionType, includeTypeSpecific = true) => {
      const q = searchTerm.trim().toLowerCase();

      const filtered = list.filter((tx) => {
        if (tx.type !== targetType) return false;

        if (activeBranchId === 'all' && branchFilter !== 'all' && tx.branchId !== branchFilter) {
          return false;
        }

        if (includeTypeSpecific) {
          if (categoryFilter !== 'all') {
            const cat = categories.find((c) => c.id === categoryFilter);
            const matchesId = tx.categoryId === categoryFilter;
            const matchesName =
              cat && (tx.categoryName || '').toLowerCase() === cat.name.toLowerCase();
            if (!matchesId && !matchesName) return false;
          }
          if (targetType === 'receivable' && patientFilter !== 'all' && tx.patientId !== patientFilter) {
            return false;
          }
        }

        const effective = computeFinancialEffectiveStatus(tx, todayYmd);
        if (statusFilter !== 'all' && effective !== statusFilter) {
          return false;
        }

        if (dueFrom || dueTo) {
          if (!isYmdWithinRange(tx.dueDate, dueFrom || undefined, dueTo || undefined)) {
            return false;
          }
        }

        if (payFrom || payTo) {
          const payYmd = tx.status === 'paid' ? tx.paymentDate || tx.paidAt : undefined;
          if (!isYmdWithinRange(payYmd, payFrom || undefined, payTo || undefined)) {
            return false;
          }
        }

        if (q) {
          const haystacks = [
            tx.description,
            tx.patientName,
            tx.supplierName,
            tx.professionalName,
            tx.receiptNumber,
            tx.categoryName,
            tx.treatmentName,
            tx.branchName,
            tx.notes,
          ];
          if (!haystacks.some((val) => (val || '').toLowerCase().includes(q))) {
            return false;
          }
        }

        return true;
      });

      return filtered.sort((a, b) => {
        const dueA = normalizeDateToSaoPauloYmd(a.dueDate) || '9999-12-31';
        const dueB = normalizeDateToSaoPauloYmd(b.dueDate) || '9999-12-31';
        const issueA = normalizeDateToSaoPauloYmd(a.issueDate || a.createdAt) || '0000-01-01';
        const issueB = normalizeDateToSaoPauloYmd(b.issueDate || b.createdAt) || '0000-01-01';

        switch (sortBy) {
          case 'due_desc':
            return dueB.localeCompare(dueA);
          case 'issue_desc':
            return issueB.localeCompare(issueA);
          case 'amount_desc':
            return b.amount - a.amount;
          case 'due_asc':
          default:
            return dueA.localeCompare(dueB);
        }
      });
    },
    [
      searchTerm,
      activeBranchId,
      branchFilter,
      categoryFilter,
      categories,
      patientFilter,
      todayYmd,
      statusFilter,
      dueFrom,
      dueTo,
      payFrom,
      payTo,
      sortBy,
    ]
  );

  const visibleTransactions = useMemo(
    () => applyCommonFilters(transactions, activeTab, true),
    [applyCommonFilters, transactions, activeTab]
  );

  const filteredReceivablesForConsolidated = useMemo(
    () => applyCommonFilters(transactions, 'receivable', activeTab === 'receivable'),
    [applyCommonFilters, transactions, activeTab]
  );

  const filteredPayablesForConsolidated = useMemo(
    () => applyCommonFilters(transactions, 'payable', activeTab === 'payable'),
    [applyCommonFilters, transactions, activeTab]
  );

  // Summary Metrics per Tab & Badge Counts
  const tabMetrics = useMemo(() => {
    const computeSummary = (type: FinancialTransactionType) => {
      const subset = transactions.filter((t) => t.type === type);
      let pendingToExpire = 0;
      let pendingCount = 0;
      let overdueTotal = 0;
      let overdueCount = 0;
      let paidMonthTotal = 0;
      let paidMonthCount = 0;

      for (const tx of subset) {
        const eff = computeFinancialEffectiveStatus(tx, todayYmd);
        if (eff === 'pending') {
          pendingToExpire += tx.amount;
          pendingCount += 1;
        } else if (eff === 'overdue') {
          overdueTotal += tx.amount;
          overdueCount += 1;
        } else if (eff === 'paid') {
          const payYmd = normalizeDateToSaoPauloYmd(tx.paymentDate || tx.paidAt);
          if (payYmd && isYmdWithinRange(payYmd, currentMonthRange.start, currentMonthRange.end)) {
            paidMonthTotal += tx.amount;
            paidMonthCount += 1;
          }
        }
      }

      return {
        totalCount: subset.length,
        pendingToExpire,
        pendingCount,
        overdueTotal,
        overdueCount,
        paidMonthTotal,
        paidMonthCount,
      };
    };

    return {
      receivable: computeSummary('receivable'),
      payable: computeSummary('payable'),
    };
  }, [transactions, todayYmd, currentMonthRange]);

  const activeSummary = tabMetrics[activeTab];

  const filteredActiveTotal = useMemo(
    () =>
      visibleTransactions
        .filter((t) => t.status !== 'cancelled')
        .reduce((acc, cur) => acc + cur.amount, 0),
    [visibleTransactions]
  );

  const activeCategoriesForTab = useMemo(
    () => categories.filter((c) => c.categoryType === activeTab),
    [categories, activeTab]
  );

  const hasAnyFilter =
    Boolean(searchTerm.trim()) ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    patientFilter !== 'all' ||
    branchFilter !== 'all' ||
    Boolean(dueFrom) ||
    Boolean(dueTo) ||
    Boolean(payFrom) ||
    Boolean(payTo);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setPatientFilter('all');
    setBranchFilter('all');
    setDueFrom('');
    setDueTo('');
    setPayFrom('');
    setPayTo('');
  };

  const handleOpenNewModal = (type: FinancialTransactionType) => {
    if (!canCreate) return;
    setActionError('');
    setEditingTxId(null);
    setTxModalDefaultType(type);
    setIsTxModalOpen(true);
  };

  const handleOpenEditModal = (tx: FinancialTransaction) => {
    if (!canEdit) return;
    setActionError('');
    setEditingTxId(tx.id);
    setTxModalDefaultType(tx.type);
    setIsTxModalOpen(true);
  };

  const handleExportCurrentTab = async () => {
    if (isExporting) return;
    setActionError('');
    setIsExporting(true);
    try {
      const clinicTitle = clinic.tradeName || clinic.legalName || 'MedSync';
      if (activeTab === 'receivable') {
        await exportReceivablesToXlsx(visibleTransactions, clinicTitle);
      } else {
        await exportPayablesToXlsx(visibleTransactions, clinicTitle);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao gerar arquivo Excel (.xlsx).');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportConsolidated = async () => {
    if (isExporting) return;
    setActionError('');
    setIsExporting(true);
    try {
      const clinicTitle = clinic.tradeName || clinic.legalName || 'MedSync';
      await exportConsolidatedFinancialToXlsx(
        filteredReceivablesForConsolidated,
        filteredPayablesForConsolidated,
        clinicTitle
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao gerar Excel consolidado (.xlsx).');
    } finally {
      setIsExporting(false);
    }
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

  const statusBadge = (tx: FinancialTransaction) => {
    const effective = computeFinancialEffectiveStatus(tx, todayYmd);
    const label = getFinancialStatusLabel(effective, tx.type).toUpperCase();
    switch (effective) {
      case 'paid':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            {label}
          </span>
        );
      case 'overdue':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            {label}
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200 line-through">
            {label}
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            {label}
          </span>
        );
    }
  };

  if (!canConsult) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-8 bg-white rounded-2xl border border-slate-200 shadow-xs text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-bold text-slate-900">Acesso Financeiro Não Autorizado</h2>
        <p className="text-xs text-slate-500">
          Seu perfil atual não possui permissão de consulta para o módulo financeiro.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Financeiro — Contas a Receber & Contas a Pagar
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Controle de obrigações e faturamento da clínica no Supabase · Datas em horário oficial de Brasília (BRT).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void refreshFinancial()}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCategoriesOpen(true)}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition inline-flex items-center gap-1.5"
          >
            <Tags className="w-3.5 h-3.5 text-sky-600" />
            <span>Categorias</span>
          </button>

          <button
            type="button"
            disabled={isExporting || isLoading}
            onClick={() => void handleExportCurrentTab()}
            className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition inline-flex items-center gap-1.5 disabled:opacity-50"
            title="Exportar lançamentos filtrados da aba atual para Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Exportar Aba (.xlsx)</span>
          </button>

          <button
            type="button"
            disabled={isExporting || isLoading}
            onClick={() => void handleExportConsolidated()}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition inline-flex items-center gap-1.5 disabled:opacity-50"
            title="Exportar planilha consolidada (Contas a Receber + Contas a Pagar) respeitando filtros"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Consolidado (.xlsx)</span>
          </button>

          {canCreate && activeTab === 'receivable' && (
            <button
              type="button"
              onClick={() => setIsBillOriginOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition inline-flex items-center gap-1.5"
            >
              <Stethoscope className="w-3.5 h-3.5" />
              <span>Faturar Consulta / Tratamento</span>
            </button>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={() => handleOpenNewModal(activeTab)}
              className={`px-4 py-2 text-xs font-semibold text-white rounded-xl shadow-xs transition inline-flex items-center gap-1.5 ${
                activeTab === 'payable'
                  ? 'bg-slate-900 hover:bg-slate-800'
                  : 'bg-sky-600 hover:bg-sky-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>{activeTab === 'payable' ? 'Nova Despesa' : 'Novo Recebimento'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-slate-200/70 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('receivable');
              setCategoryFilter('all');
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition inline-flex items-center gap-2 ${
              activeTab === 'receivable'
                ? 'bg-white text-sky-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
            <span>Contas a Receber ({tabMetrics.receivable.totalCount})</span>
            {tabMetrics.receivable.overdueCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                {tabMetrics.receivable.overdueCount} vencida(s)
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('payable');
              setCategoryFilter('all');
              setPatientFilter('all');
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition inline-flex items-center gap-2 ${
              activeTab === 'payable'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowUpRight className="w-4 h-4 text-rose-600" />
            <span>Contas a Pagar ({tabMetrics.payable.totalCount})</span>
            {tabMetrics.payable.overdueCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                {tabMetrics.payable.overdueCount} vencida(s)
              </span>
            )}
          </button>
        </div>

        <span className="text-[11px] text-slate-500 font-medium">
          Data base (Brasília): <strong className="text-slate-800">{formatDatePtBr(todayYmd)}</strong>
        </span>
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

      {/* Summary Strip for Active Tab (real persisted values only) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">
              {activeTab === 'receivable' ? 'A Receber (A Vencer)' : 'A Pagar (A Vencer)'}
            </span>
            <Calendar className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : formatCurrencyPtBr(activeSummary.pendingToExpire)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {activeSummary.pendingCount}{' '}
            {activeSummary.pendingCount === 1 ? 'lançamento em aberto' : 'lançamentos em aberto'}
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-rose-200/80 shadow-xs">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-xs font-semibold">
              {activeTab === 'receivable' ? 'Receitas Vencidas' : 'Despesas Vencidas'}
            </span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-rose-700 tabular-nums">
            {isLoading ? '—' : formatCurrencyPtBr(activeSummary.overdueTotal)}
          </div>
          <p className="text-[11px] text-rose-600 mt-1">
            {activeSummary.overdueCount}{' '}
            {activeSummary.overdueCount === 1 ? 'título vencido' : 'títulos vencidos'}
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">
              {activeTab === 'receivable' ? 'Recebido no Mês' : 'Pago no Mês'}
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-emerald-700 tabular-nums">
            {isLoading ? '—' : formatCurrencyPtBr(activeSummary.paidMonthTotal)}
          </div>
          <p className="text-[11px] text-emerald-700 mt-1">
            {activeSummary.paidMonthCount}{' '}
            {activeSummary.paidMonthCount === 1 ? 'baixa neste mês' : 'baixas neste mês'}
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Total Filtrado (Ativo)</span>
            <DollarSign className="w-4 h-4 text-sky-600" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : formatCurrencyPtBr(filteredActiveTotal)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {visibleTransactions.length} registro(s) no filtro atual
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={
                activeTab === 'receivable'
                  ? 'Buscar paciente, descrição, recibo, categoria ou profissional...'
                  : 'Buscar despesa, fornecedor, código, categoria ou observação...'
              }
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <select
            aria-label="Filtrar por situação"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilterOption)}
            className="px-3 py-2 font-semibold border border-slate-200 rounded-xl bg-slate-50"
          >
            <option value="all">Todas as Situações</option>
            <option value="pending">Pendente (A Vencer)</option>
            <option value="overdue">Vencido</option>
            <option value="paid">{activeTab === 'receivable' ? 'Recebido' : 'Pago'}</option>
            <option value="cancelled">Cancelado</option>
          </select>

          <select
            aria-label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50"
          >
            <option value="all">Todas as Categorias</option>
            {activeCategoriesForTab.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {activeTab === 'receivable' ? (
            <select
              aria-label="Filtrar por paciente"
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50"
            >
              <option value="all">Todos os Pacientes</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          ) : (
            <select
              aria-label="Ordenar lançamentos"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50"
            >
              <option value="due_asc">Vencimento (Mais antigo)</option>
              <option value="due_desc">Vencimento (Mais recente)</option>
              <option value="issue_desc">Emissão (Mais recente)</option>
              <option value="amount_desc">Maior Valor</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          {activeBranchId === 'all' && branches.length > 1 && (
            <select
              aria-label="Filtrar por filial"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl bg-slate-50"
            >
              <option value="all">Todas as Filiais</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500">Vencimento:</span>
            <input
              type="date"
              aria-label="Vencimento inicial"
              value={dueFrom}
              onChange={(e) => setDueFrom(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg"
            />
            <span className="text-slate-400">até</span>
            <input
              type="date"
              aria-label="Vencimento final"
              value={dueTo}
              onChange={(e) => setDueTo(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500">
              {activeTab === 'receivable' ? 'Recebimento:' : 'Pagamento:'}
            </span>
            <input
              type="date"
              aria-label="Data de baixa inicial"
              value={payFrom}
              onChange={(e) => setPayFrom(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg"
            />
            <span className="text-slate-400">até</span>
            <input
              type="date"
              aria-label="Data de baixa final"
              value={payTo}
              onChange={(e) => setPayTo(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg"
            />
          </div>

          {activeTab === 'receivable' && (
            <select
              aria-label="Ordenar lançamentos"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl bg-slate-50"
            >
              <option value="due_asc">Vencimento (Mais antigo)</option>
              <option value="due_desc">Vencimento (Mais recente)</option>
              <option value="issue_desc">Emissão (Mais recente)</option>
              <option value="amount_desc">Maior Valor</option>
            </select>
          )}

          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1 ml-auto"
            >
              <FilterX className="w-3.5 h-3.5" />
              <span>Limpar Filtros</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            {activeTab === 'receivable'
              ? 'Lançamentos de Contas a Receber'
              : 'Lançamentos de Contas a Pagar'}
          </h3>
          <span className="text-xs text-slate-500">
            {visibleTransactions.length}{' '}
            {visibleTransactions.length === 1 ? 'lançamento' : 'lançamentos'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Código / Datas</th>
                <th className="py-3 px-4">Descrição & Categoria</th>
                <th className="py-3 px-4">
                  {activeTab === 'receivable' ? 'Paciente & Origem' : 'Fornecedor & Unidade'}
                </th>
                <th className="py-3 px-4">Forma</th>
                <th className="py-3 px-4 text-right">Valor & Situação</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                      <span>Carregando lançamentos reais do Supabase...</span>
                    </span>
                  </td>
                </tr>
              ) : loadError && transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-rose-600">
                    Não foi possível carregar os dados financeiros. Clique em "Tentar novamente".
                  </td>
                </tr>
              ) : visibleTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    {activeTab === 'receivable'
                      ? 'Nenhuma conta a receber encontrada para o filtro selecionado.'
                      : 'Nenhuma conta a pagar encontrada para o filtro selecionado.'}
                  </td>
                </tr>
              ) : (
                visibleTransactions.map((tx) => {
                  const isHighlighted = highlightedTxId === tx.id;
                  const effective = computeFinancialEffectiveStatus(tx, todayYmd);
                  const isPaid = tx.status === 'paid';
                  const isCancelled = tx.status === 'cancelled';

                  return (
                    <tr
                      key={tx.id}
                      className={`transition ${
                        isHighlighted
                          ? 'bg-sky-50/90 ring-2 ring-inset ring-sky-400'
                          : effective === 'overdue'
                            ? 'bg-rose-50/30 hover:bg-rose-50/50'
                            : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900 block">
                          {tx.receiptNumber || tx.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          Emissão: {formatDatePtBr(tx.issueDate || tx.createdAt)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold block ${
                            effective === 'overdue' ? 'text-rose-700' : 'text-slate-600'
                          }`}
                        >
                          Venc.: {formatDatePtBr(tx.dueDate)}
                        </span>
                        {isPaid && (tx.paymentDate || tx.paidAt) && (
                          <span className="text-[10px] text-emerald-700 font-semibold block">
                            {tx.type === 'receivable' ? 'Receb.:' : 'Pago:'}{' '}
                            {formatDatePtBr(tx.paymentDate || tx.paidAt)}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 max-w-[260px]">
                        <span className="font-bold text-slate-900 block truncate" title={tx.description}>
                          {tx.description}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {tx.categoryName ||
                              (tx.type === 'payable' ? 'Outras despesas' : 'Outras Receitas')}
                          </span>
                          {tx.treatmentName && (
                            <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                              {tx.treatmentName}
                            </span>
                          )}
                        </div>
                        {tx.cancellationReason && (
                          <p
                            className="text-[10px] text-rose-600 italic mt-1 truncate"
                            title={tx.cancellationReason}
                          >
                            Cancelamento: {tx.cancellationReason}
                          </p>
                        )}
                        {!tx.cancellationReason && tx.notes && (
                          <p
                            className="text-[10px] text-slate-500 italic mt-1 truncate"
                            title={tx.notes}
                          >
                            {tx.notes}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-4 max-w-[220px]">
                        {tx.type === 'receivable' ? (
                          <>
                            <span className="font-semibold text-slate-800 block truncate">
                              {tx.patientName || 'Cliente Direto / Avulso'}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                                {ORIGIN_TYPE_LABELS[tx.originType || (tx.appointmentId ? 'appointment' : 'manual')]}
                              </span>
                              <span className="text-[10px] text-slate-500 truncate">
                                {tx.branchName}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-800 block truncate">
                              {tx.supplierName || 'Fornecedor não informado'}
                            </span>
                            <span className="text-[10px] text-slate-500 block mt-0.5 truncate">
                              {tx.branchName}
                            </span>
                          </>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-semibold text-slate-700 block">
                          {PAYMENT_METHOD_LABELS[tx.paymentMethod] || tx.paymentMethod}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          {tx.installments > 1
                            ? `${tx.installments}x de ${formatCurrencyPtBr(tx.amount / tx.installments)}`
                            : 'À vista'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span
                          className={`font-extrabold block tabular-nums text-sm ${
                            isCancelled
                              ? 'text-slate-400 line-through'
                              : tx.type === 'payable'
                                ? 'text-rose-700'
                                : 'text-slate-900'
                          }`}
                        >
                          {formatCurrencyPtBr(tx.amount)}
                        </span>
                        <div className="mt-1">{statusBadge(tx)}</div>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {canEdit && tx.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => setSettlingTx(tx)}
                              className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{tx.type === 'receivable' ? 'Receber' : 'Pagar'}</span>
                            </button>
                          )}

                          {canEdit && !isCancelled && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(tx)}
                              className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition"
                              title="Editar lançamento"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {tx.type === 'receivable' && (
                            <button
                              type="button"
                              onClick={() => openReceiptPrint(tx)}
                              className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition"
                              title="Imprimir recibo / PDF"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {(canEdit || canHardDelete) && !isCancelled && (
                            <button
                              type="button"
                              onClick={() => setCancelOrDeleteTx(tx)}
                              className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                              title={
                                canHardDelete && !isPaid && !tx.appointmentId && !tx.medicalRecordId
                                  ? 'Cancelar ou Excluir'
                                  : 'Cancelar lançamento'
                              }
                            >
                              {canHardDelete && !isPaid && !tx.appointmentId && !tx.medicalRecordId ? (
                                <Trash2 className="w-3.5 h-3.5" />
                              ) : (
                                <Ban className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Transaction Modal */}
      <FinancialTransactionModal
        isOpen={isTxModalOpen}
        onClose={() => {
          setIsTxModalOpen(false);
          setEditingTxId(null);
        }}
        defaultType={txModalDefaultType}
        editingTransactionId={editingTxId}
        organizationId={organization.id}
        activeBranchId={activeBranchId}
        branches={branches}
        categories={categories}
        patients={patients}
        professionals={professionals}
        services={services}
        onSaved={refreshFinancial}
      />

      {/* Manage Categories Modal */}
      <FinancialCategoriesModal
        isOpen={isCategoriesOpen}
        onClose={() => setIsCategoriesOpen(false)}
        organizationId={organization.id}
        categories={categories}
        initialTab={activeTab}
        canEditCategories={canManageCategories}
        onUpdated={refreshFinancial}
      />

      {/* Bill Appointment or Treatment Modal */}
      <BillClinicalOriginModal
        isOpen={isBillOriginOpen}
        onClose={() => setIsBillOriginOpen(false)}
        organizationId={organization.id}
        activeBranchId={activeBranchId}
        branches={branches}
        categories={categories}
        patients={patients}
        professionals={professionals}
        services={services}
        onBilled={refreshFinancial}
      />

      {/* Settle Modal (demands explicit paymentDate) */}
      <FinancialSettleModal
        transaction={settlingTx}
        onClose={() => setSettlingTx(null)}
        onSettled={refreshFinancial}
      />

      {/* Cancel or Hard Delete Modal */}
      <FinancialCancelOrDeleteModal
        transaction={cancelOrDeleteTx}
        canHardDelete={canHardDelete}
        onClose={() => setCancelOrDeleteTx(null)}
        onCompleted={refreshFinancial}
      />

      {/* Isolated A4 Print Portal for Receipts */}
      <DocumentPrintModal
        isOpen={Boolean(printableDoc)}
        onClose={() => setPrintableDoc(null)}
        document={printableDoc}
      />
    </div>
  );
};
