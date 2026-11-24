import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Plus,
  Trash2,
  ClipboardList,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Search,
  CheckSquare,
  Square,
  RefreshCw,
  Settings2,
  Power,
  Tag,
} from 'lucide-react';
import { Patient, LabOrder, LabOrderItem, LabExamCatalogItem } from '../../types';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';

interface LabOrderFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient | null;
  medicalRecordId?: string;
  onSuccess: (order: LabOrder) => void;
}

interface StagedCustomExam {
  tempId: string;
  examName: string;
  examType: LabOrderItem['examType'];
}

function normalizeExamText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export const LabOrderFormModal: React.FC<LabOrderFormModalProps> = ({
  isOpen,
  onClose,
  patient,
  medicalRecordId,
  onSuccess,
}) => {
  const {
    currentUser,
    currentRole,
    canCreateInMenu,
    canEditInMenu,
    canAdminMenu,
  } = useAuth();
  const { organization, activeBranchId, branches } = useTenant();

  const canManageCatalog =
    currentRole !== 'patient' &&
    (canCreateInMenu('medical_records') ||
      canEditInMenu('medical_records') ||
      canAdminMenu('medical_records') ||
      canEditInMenu('settings') ||
      canAdminMenu('settings'));

  const [clinicalIndication, setClinicalIndication] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectionFeedback, setSelectionFeedback] = useState<{
    type: 'info' | 'warning';
    text: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Catálogo do Supabase
  const [catalogItems, setCatalogItems] = useState<LabExamCatalogItem[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);

  // Manutenção do catálogo (RBAC)
  const [isManagingCatalog, setIsManagingCatalog] = useState(false);
  const [newCatalogExamName, setNewCatalogExamName] = useState('');
  const [newCatalogExamType, setNewCatalogExamType] =
    useState<LabExamCatalogItem['examType']>('laboratorial');
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [togglingCatalogId, setTogglingCatalogId] = useState<string | null>(null);
  const [catalogManageMessage, setCatalogManageMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Outros Exames (personalizados)
  const [customExamName, setCustomExamName] = useState('');
  const [customExamType, setCustomExamType] =
    useState<LabOrderItem['examType']>('laboratorial');
  const [stagedCustomExams, setStagedCustomExams] = useState<StagedCustomExam[]>([]);

  // Relação final do pedido médico
  const [items, setItems] = useState<Array<Omit<LabOrderItem, 'id'>>>([]);

  const professionals = StorageService.getProfessionals();
  const activeProf =
    professionals.find((p) => p.userProfileId === currentUser.id) ||
    professionals.find((p) => p.fullName === currentUser.fullName) ||
    professionals[0];
  const councilNumber = activeProf?.councilNumber || 'CRM/RJ 52-444985';

  const resolvedOrgId = patient?.organizationId || organization.id;

  const loadCatalog = useCallback(
    async (includeInactive: boolean) => {
      setIsLoadingCatalog(true);
      setCatalogError(null);
      const res = await ClinicalCloudService.fetchLabExamCatalogFromCloud(
        resolvedOrgId,
        includeInactive
      );
      if (res.error) {
        setCatalogError(res.error);
        setCatalogItems([]);
      } else {
        setCatalogItems(res.items);
      }
      setIsLoadingCatalog(false);
    },
    [resolvedOrgId]
  );

  useEffect(() => {
    if (isOpen) {
      setClinicalIndication('');
      setNotes('');
      setErrorMessage('');
      setSelectionFeedback(null);
      setIsSaving(false);
      setSearchQuery('');
      setSelectedCatalogIds([]);
      setCustomExamName('');
      setCustomExamType('laboratorial');
      setStagedCustomExams([]);
      setItems([]);
      setIsManagingCatalog(false);
      setNewCatalogExamName('');
      setNewCatalogExamType('laboratorial');
      setCatalogManageMessage(null);
      void loadCatalog(false);
    }
  }, [isOpen, loadCatalog]);

  const activeCatalogItems = useMemo(
    () => catalogItems.filter((item) => item.isActive),
    [catalogItems]
  );

  const normalizedSearch = useMemo(() => normalizeExamText(searchQuery), [searchQuery]);

  const filteredActiveCatalog = useMemo(() => {
    if (!normalizedSearch) return activeCatalogItems;
    return activeCatalogItems.filter((item) =>
      normalizeExamText(item.name).includes(normalizedSearch)
    );
  }, [activeCatalogItems, normalizedSearch]);

  const filteredAllCatalog = useMemo(() => {
    if (!normalizedSearch) return catalogItems;
    return catalogItems.filter((item) =>
      normalizeExamText(item.name).includes(normalizedSearch)
    );
  }, [catalogItems, normalizedSearch]);

  const existingOrderExamKeys = useMemo(() => {
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const item of items) {
      keys.add(normalizeExamText(item.examName));
      if (item.catalogExamId) ids.add(item.catalogExamId);
    }
    return { keys, ids };
  }, [items]);

  const selectedCatalogObjects = useMemo(() => {
    const map = new Map(activeCatalogItems.map((c) => [c.id, c]));
    return selectedCatalogIds
      .map((id) => map.get(id))
      .filter((c): c is LabExamCatalogItem => Boolean(c));
  }, [activeCatalogItems, selectedCatalogIds]);

  if (!isOpen || !patient) return null;

  const isCatalogExamAlreadyInOrder = (exam: LabExamCatalogItem): boolean =>
    existingOrderExamKeys.ids.has(exam.id) ||
    existingOrderExamKeys.keys.has(normalizeExamText(exam.name));

  const toggleCatalogSelection = (exam: LabExamCatalogItem) => {
    setSelectionFeedback(null);
    if (isCatalogExamAlreadyInOrder(exam)) {
      setSelectionFeedback({
        type: 'warning',
        text: `O exame "${exam.name}" já faz parte do pedido médico.`,
      });
      return;
    }

    setSelectedCatalogIds((prev) =>
      prev.includes(exam.id) ? prev.filter((id) => id !== exam.id) : [...prev, exam.id]
    );
  };

  const handleUnselectCatalogId = (id: string) => {
    setSelectedCatalogIds((prev) => prev.filter((item) => item !== id));
  };

  const handleStageCustomExam = () => {
    setSelectionFeedback(null);
    const trimmed = customExamName.trim();
    if (!trimmed) {
      setSelectionFeedback({
        type: 'warning',
        text: 'Digite o nome do exame personalizado antes de incluir.',
      });
      return;
    }

    const norm = normalizeExamText(trimmed);
    const duplicateInOrder = existingOrderExamKeys.keys.has(norm);
    const duplicateInStagedCustom = stagedCustomExams.some(
      (c) => normalizeExamText(c.examName) === norm
    );
    const duplicateInSelectedCatalog = selectedCatalogObjects.some(
      (c) => normalizeExamText(c.name) === norm
    );

    if (duplicateInOrder || duplicateInStagedCustom || duplicateInSelectedCatalog) {
      setSelectionFeedback({
        type: 'warning',
        text: `O exame "${trimmed}" já foi selecionado ou incluído neste pedido.`,
      });
      return;
    }

    setStagedCustomExams((prev) => [
      ...prev,
      {
        tempId: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        examName: trimmed,
        examType: customExamType,
      },
    ]);
    setCustomExamName('');
  };

  const handleRemoveStagedCustom = (tempId: string) => {
    setStagedCustomExams((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  const handleAddAllSelectedToOrder = () => {
    setSelectionFeedback(null);
    setErrorMessage('');

    const newItems: Array<Omit<LabOrderItem, 'id'>> = [];
    const seenKeys = new Set<string>(existingOrderExamKeys.keys);
    const seenIds = new Set<string>(existingOrderExamKeys.ids);
    const skippedDuplicates: string[] = [];

    // 1. Exames selecionados do catálogo
    for (const exam of selectedCatalogObjects) {
      const norm = normalizeExamText(exam.name);
      if (seenIds.has(exam.id) || seenKeys.has(norm)) {
        skippedDuplicates.push(exam.name);
        continue;
      }
      seenIds.add(exam.id);
      seenKeys.add(norm);
      newItems.push({
        examName: exam.name,
        examType: exam.examType || 'laboratorial',
        urgency: 'rotina',
        observations: exam.defaultObservations || '',
        catalogExamId: exam.id,
        isCustom: false,
      });
    }

    // 2. Exames personalizados já listados em Outros Exames
    for (const custom of stagedCustomExams) {
      const norm = normalizeExamText(custom.examName);
      if (seenKeys.has(norm)) {
        skippedDuplicates.push(custom.examName);
        continue;
      }
      seenKeys.add(norm);
      newItems.push({
        examName: custom.examName,
        examType: custom.examType || 'laboratorial',
        urgency: 'rotina',
        observations: '',
        isCustom: true,
      });
    }

    // 3. Caso haja texto digitado diretamente no campo Outros Exames ao clicar em "Adicionar ao Pedido"
    const directCustomTrimmed = customExamName.trim();
    if (directCustomTrimmed) {
      const norm = normalizeExamText(directCustomTrimmed);
      if (seenKeys.has(norm)) {
        skippedDuplicates.push(directCustomTrimmed);
      } else {
        seenKeys.add(norm);
        newItems.push({
          examName: directCustomTrimmed,
          examType: customExamType || 'laboratorial',
          urgency: 'rotina',
          observations: '',
          isCustom: true,
        });
      }
    }

    if (newItems.length === 0) {
      if (skippedDuplicates.length > 0) {
        setSelectionFeedback({
          type: 'warning',
          text: `Os seguintes exames já estavam no pedido: ${skippedDuplicates.join(', ')}.`,
        });
      } else {
        setSelectionFeedback({
          type: 'warning',
          text: 'Selecione ao menos um exame no catálogo ou digite um exame em "Outros Exames".',
        });
      }
      return;
    }

    setItems((prev) => [...prev, ...newItems]);
    setSelectedCatalogIds([]);
    setStagedCustomExams([]);
    if (directCustomTrimmed) {
      setCustomExamName('');
    }

    if (skippedDuplicates.length > 0) {
      setSelectionFeedback({
        type: 'warning',
        text: `${newItems.length} exame(s) adicionado(s). Duplicados ignorados: ${skippedDuplicates.join(', ')}.`,
      });
    } else {
      setSelectionFeedback({
        type: 'info',
        text: `${newItems.length} exame(s) adicionado(s) ao pedido médico.`,
      });
    }
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (
    index: number,
    field: keyof Omit<LabOrderItem, 'id'>,
    value: string
  ) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleToggleManageCatalog = () => {
    if (!canManageCatalog) return;
    const next = !isManagingCatalog;
    setIsManagingCatalog(next);
    setCatalogManageMessage(null);
    void loadCatalog(next);
  };

  const handleCreateCatalogExam = async () => {
    if (!canManageCatalog || isSavingCatalog) return;
    setCatalogManageMessage(null);
    const trimmed = newCatalogExamName.trim();
    if (!trimmed) {
      setCatalogManageMessage({
        type: 'error',
        text: 'Informe o nome do exame para cadastrar no catálogo.',
      });
      return;
    }

    setIsSavingCatalog(true);
    const res = await ClinicalCloudService.createLabExamCatalogItemInCloud({
      organizationId: resolvedOrgId,
      name: trimmed,
      examType: newCatalogExamType,
    });
    setIsSavingCatalog(false);

    if (!res.success || !res.item) {
      setCatalogManageMessage({
        type: 'error',
        text: res.error || 'Não foi possível cadastrar o exame no catálogo.',
      });
      return;
    }

    setNewCatalogExamName('');
    setCatalogManageMessage({
      type: 'success',
      text: `Exame "${res.item.name}" cadastrado no catálogo.`,
    });
    await loadCatalog(isManagingCatalog);
  };

  const handleToggleCatalogActive = async (item: LabExamCatalogItem) => {
    if (!canManageCatalog || togglingCatalogId) return;
    setTogglingCatalogId(item.id);
    setCatalogManageMessage(null);
    const nextActive = !item.isActive;
    const res = await ClinicalCloudService.toggleLabExamCatalogItemActiveInCloud(
      item.id,
      nextActive
    );
    setTogglingCatalogId(null);

    if (!res.success || !res.item) {
      setCatalogManageMessage({
        type: 'error',
        text: res.error || 'Erro ao atualizar status do exame no catálogo.',
      });
      return;
    }

    if (!nextActive) {
      setSelectedCatalogIds((prev) => prev.filter((id) => id !== item.id));
    }

    setCatalogItems((prev) => prev.map((c) => (c.id === item.id ? res.item! : c)));
    setCatalogManageMessage({
      type: 'success',
      text: `Exame "${item.name}" ${nextActive ? 'reativado' : 'desativado'} no catálogo.`,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMessage('');

    if (!clinicalIndication.trim()) {
      setErrorMessage(
        'A indicação / justificativa clínica é obrigatória para emissão da solicitação de exames.'
      );
      return;
    }

    if (items.length === 0) {
      const hasPending =
        selectedCatalogIds.length > 0 ||
        stagedCustomExams.length > 0 ||
        customExamName.trim().length > 0;
      setErrorMessage(
        hasPending
          ? 'Você possui exames selecionados/digitados. Clique em "Adicionar ao Pedido" para incluí-los na relação final antes de emitir.'
          : 'Selecione ao menos um exame do Catálogo de Exames ou adicione um item em Outros Exames.'
      );
      return;
    }

    const hasEmpty = items.some((it) => !it.examName.trim());
    if (hasEmpty) {
      setErrorMessage('Informe o nome de todos os exames solicitados.');
      return;
    }

    const orderId = `order_${Date.now()}`;
    const resolvedBranchId =
      activeBranchId !== 'all'
        ? activeBranchId
        : patient.originBranchId || branches[0]?.id || '';

    const order: LabOrder = {
      id: orderId,
      organizationId: patient.organizationId || organization.id || '',
      branchId: resolvedBranchId,
      patientId: patient.id,
      medicalRecordId,
      patientName: patient.fullName,
      patientCpf: patient.documentCpf,
      professionalId: activeProf?.id || currentUser.id,
      professionalName: currentUser.fullName,
      professionalCouncil: councilNumber,
      orderDate: new Date().toISOString().split('T')[0],
      clinicalIndication: clinicalIndication.trim(),
      items: items.map((it, idx) => ({ ...it, id: `item_${orderId}_${idx}` })),
      notes,
      isSigned: true,
      signatureHash: `sha256_order_${Math.random().toString(36).substring(2, 12)}`,
      status: 'requested',
      createdAt: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      const res = await ClinicalCloudService.saveLabOrderToCloud(order, patient);
      if (!res.success || !res.order) {
        setErrorMessage(res.message || 'Erro ao gravar pedido de exames no banco de dados.');
        return;
      }

      onSuccess(res.order);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro inesperado ao emitir solicitação de exames.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const pendingToAddCount =
    selectedCatalogIds.length +
    stagedCustomExams.length +
    (customExamName.trim() ? 1 : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Solicitação de Exames Laboratoriais e Imagem
              </h3>
              <p className="text-xs text-slate-400">
                Paciente: {patient.fullName} (CPF: {patient.documentCpf})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg"
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

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Indicação Clínica */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Justificativa / Indicação Clínica * (Exigência CFM e Convênios Médicos)
            </label>
            <textarea
              required
              rows={2}
              value={clinicalIndication}
              onChange={(e) => setClinicalIndication(e.target.value)}
              placeholder="Ex: Investigação de síndrome metabólica, resistência insulínica, função tireoidiana e perfil hormonal."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Área 1: Catálogo de Exames + Área 2: Outros Exames */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Catálogo de Exames */}
            <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Catálogo de Exames ({activeCatalogItems.length})
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Pesquise e selecione múltiplos exames cadastrados.
                  </p>
                </div>

                {canManageCatalog && (
                  <button
                    type="button"
                    onClick={handleToggleManageCatalog}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition flex items-center gap-1 ${
                      isManagingCatalog
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>{isManagingCatalog ? 'Voltar à Seleção' : 'Gerenciar Catálogo'}</span>
                  </button>
                )}
              </div>

              {/* Barra de Pesquisa */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar exame pelo nome (ex: TSH, Testo, Vitamina)..."
                  className="w-full pl-8 pr-8 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title="Limpar pesquisa"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Painel de Manutenção Futura do Catálogo (RBAC) */}
              {isManagingCatalog && canManageCatalog && (
                <div className="p-3 bg-white border border-sky-200 rounded-lg space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-800">
                    Incluir Novo Exame no Catálogo
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newCatalogExamName}
                      onChange={(e) => setNewCatalogExamName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCreateCatalogExam();
                        }
                      }}
                      placeholder="Nome exato do exame..."
                      className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <select
                      value={newCatalogExamType}
                      onChange={(e) =>
                        setNewCatalogExamType(
                          e.target.value as LabExamCatalogItem['examType']
                        )
                      }
                      className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="laboratorial">Laboratorial</option>
                      <option value="imagem">Imagem</option>
                      <option value="outros">Outros</option>
                    </select>
                    <button
                      type="button"
                      disabled={isSavingCatalog}
                      onClick={() => void handleCreateCatalogExam()}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {isSavingCatalog ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>Cadastrar</span>
                    </button>
                  </div>
                  {catalogManageMessage && (
                    <p
                      className={`text-[11px] font-medium ${
                        catalogManageMessage.type === 'error'
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {catalogManageMessage.text}
                    </p>
                  )}
                </div>
              )}

              {/* Estados do Catálogo (Carregando / Erro / Lista) */}
              {isLoadingCatalog ? (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500 bg-white rounded-lg border border-slate-200">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                  <span>Carregando catálogo de exames do Supabase...</span>
                </div>
              ) : catalogError ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{catalogError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadCatalog(isManagingCatalog)}
                    className="px-3 py-1 bg-white border border-rose-300 text-rose-700 font-semibold rounded-md hover:bg-rose-100 inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Tentar novamente</span>
                  </button>
                </div>
              ) : isManagingCatalog && canManageCatalog ? (
                <div className="max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {filteredAllCatalog.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Nenhum exame encontrado para &quot;{searchQuery}&quot;.
                    </div>
                  ) : (
                    filteredAllCatalog.map((exam) => (
                      <div
                        key={exam.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-medium truncate ${
                              exam.isActive
                                ? 'text-slate-800'
                                : 'text-slate-400 line-through'
                            }`}
                          >
                            {exam.name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                              exam.isActive
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {exam.isActive ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={togglingCatalogId === exam.id}
                          onClick={() => void handleToggleCatalogActive(exam)}
                          className={`px-2 py-1 text-[11px] font-semibold rounded border transition inline-flex items-center gap-1 shrink-0 ${
                            exam.isActive
                              ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100'
                              : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {togglingCatalogId === exam.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Power className="w-3 h-3" />
                          )}
                          <span>{exam.isActive ? 'Desativar' : 'Reativar'}</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {filteredActiveCatalog.length === 0 ? (
                    <div className="col-span-full py-6 text-center text-xs text-slate-400">
                      {activeCatalogItems.length === 0
                        ? 'Nenhum exame ativo no catálogo.'
                        : `Nenhum exame encontrado para "${searchQuery}".`}
                    </div>
                  ) : (
                    filteredActiveCatalog.map((exam) => {
                      const alreadyAdded = isCatalogExamAlreadyInOrder(exam);
                      const isChecked = selectedCatalogIds.includes(exam.id);
                      return (
                        <label
                          key={exam.id}
                          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition ${
                            alreadyAdded
                              ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                              : isChecked
                              ? 'bg-sky-50 border-sky-300 text-sky-900 font-semibold cursor-pointer'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-sky-300 hover:bg-slate-50 cursor-pointer'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked || alreadyAdded}
                              disabled={alreadyAdded}
                              onChange={() => toggleCatalogSelection(exam)}
                              className="sr-only"
                            />
                            {alreadyAdded ? (
                              <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : isChecked ? (
                              <CheckSquare className="w-4 h-4 text-sky-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className="truncate">{exam.name}</span>
                          </span>
                          {alreadyAdded && (
                            <span className="text-[9px] font-bold uppercase text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">
                              No pedido
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
              )}

              {/* Visualização dos Exames Selecionados no Catálogo antes de adicionar */}
              {selectedCatalogObjects.length > 0 && (
                <div className="p-2.5 bg-white border border-sky-200 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sky-900">
                      Selecionados no catálogo ({selectedCatalogObjects.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCatalogIds([])}
                      className="text-[11px] text-slate-500 hover:text-rose-600 font-medium"
                    >
                      Limpar seleção
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCatalogObjects.map((exam) => (
                      <span
                        key={exam.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-[11px] font-medium text-sky-900"
                      >
                        <span>{exam.name}</span>
                        <button
                          type="button"
                          onClick={() => handleUnselectCatalogId(exam.id)}
                          className="text-sky-600 hover:text-rose-600"
                          title={`Remover ${exam.name} da seleção`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Área 2: Outros Exames (Personalizados) */}
            <div className="lg:col-span-5 bg-amber-50/40 border border-amber-200 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Outros Exames
                  </h4>
                  <p className="text-[11px] text-slate-600">
                    Informe exames que não estejam no catálogo. A descrição informada será preservada integralmente.
                  </p>
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    value={customExamName}
                    onChange={(e) => {
                      setCustomExamName(e.target.value);
                      setSelectionFeedback(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleStageCustomExam();
                      }
                    }}
                    placeholder="Ex: Vitamina A, Ultrassonografia com Doppler..."
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />

                  <div className="flex gap-2">
                    <select
                      value={customExamType}
                      onChange={(e) =>
                        setCustomExamType(e.target.value as LabOrderItem['examType'])
                      }
                      className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="laboratorial">Laboratorial</option>
                      <option value="imagem">Imagem / USG / RX</option>
                      <option value="outros">Bioimpedância / Outros</option>
                    </select>

                    <button
                      type="button"
                      onClick={handleStageCustomExam}
                      className="px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition inline-flex items-center gap-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Incluir Exame</span>
                    </button>
                  </div>
                </div>

                {/* Lista de exames personalizados aguardando adição */}
                {stagedCustomExams.length > 0 && (
                  <div className="p-2.5 bg-white border border-amber-200 rounded-lg space-y-1.5">
                    <span className="text-[11px] font-bold text-amber-900 block">
                      Outros exames a adicionar ({stagedCustomExams.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {stagedCustomExams.map((custom) => (
                        <span
                          key={custom.tempId}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-medium text-amber-950"
                        >
                          <span>{custom.examName}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedCustom(custom.tempId)}
                            className="text-amber-700 hover:text-rose-600"
                            title={`Remover ${custom.examName}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Botão Unificado: Adicionar ao Pedido */}
              <div className="pt-2 border-t border-amber-200/70 space-y-2">
                {selectionFeedback && (
                  <div
                    className={`p-2 rounded-lg text-[11px] font-medium border ${
                      selectionFeedback.type === 'warning'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-sky-50 border-sky-200 text-sky-900'
                    }`}
                  >
                    {selectionFeedback.text}
                  </div>
                )}

                <button
                  type="button"
                  disabled={pendingToAddCount === 0}
                  onClick={handleAddAllSelectedToOrder}
                  className="w-full py-2 px-4 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:text-slate-500 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>
                    Adicionar ao Pedido
                    {pendingToAddCount > 0 ? ` (${pendingToAddCount})` : ''}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Relação Única Final do Pedido Médico */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Exames Solicitados no Pedido ({items.length})
              </span>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setItems([])}
                  className="text-[11px] font-semibold text-rose-600 hover:text-rose-800"
                >
                  Limpar relação
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="p-5 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
                Nenhum exame adicionado ao pedido até o momento. Selecione itens no{' '}
                <strong>Catálogo de Exames</strong> ou informe em <strong>Outros Exames</strong>{' '}
                e clique em <strong>Adicionar ao Pedido</strong>.
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((item, index) => (
                  <div
                    key={`${item.catalogExamId || 'custom'}_${index}_${item.examName}`}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-900">
                          {index + 1}. {item.examName}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                            item.isCustom
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-sky-50 text-sky-800 border-sky-200'
                          }`}
                        >
                          <Tag className="w-2.5 h-2.5" />
                          <span>{item.isCustom ? 'Personalizado' : 'Catálogo'}</span>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="text-rose-600 hover:text-rose-800 text-xs flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remover</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-3">
                        <select
                          value={item.examType}
                          onChange={(e) => handleItemChange(index, 'examType', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                          <option value="laboratorial">Laboratorial</option>
                          <option value="imagem">Imagem / USG / RX</option>
                          <option value="outros">Bioimpedância / Outros</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <select
                          value={item.urgency}
                          onChange={(e) => handleItemChange(index, 'urgency', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                          <option value="rotina">Rotina</option>
                          <option value="urgente">Urgente</option>
                        </select>
                      </div>

                      <div className="sm:col-span-7">
                        <input
                          type="text"
                          value={item.observations || ''}
                          onChange={(e) =>
                            handleItemChange(index, 'observations', e.target.value)
                          }
                          placeholder="Instruções de preparo (opcional, ex: Jejum 8h, coleta pela manhã)"
                          className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-600"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Instruções Gerais ao Laboratório ou Paciente
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Retorno de resultados previsto para 15 dias após a coleta."
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs text-emerald-900">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>
                Assinatura Digital ICP-Brasil:{' '}
                <strong>
                  {currentUser.fullName} ({councilNumber})
                </strong>
              </span>
            </div>
            <span className="text-[11px] font-mono text-emerald-700">
              Data: {new Date().toLocaleDateString('pt-BR')}
            </span>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200">
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
              className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>{isSaving ? 'Emitindo Pedido...' : 'Emitir Pedido de Exames'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
