import React, { useState } from 'react';
import { X, Plus, Edit2, Power, Loader2, AlertCircle, Check } from 'lucide-react';
import { FinancialCategory, FinancialTransactionType } from '../../types';
import { FinancialCloudService } from '../../services/financialCloudService';

interface FinancialCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  categories: FinancialCategory[];
  initialTab?: FinancialTransactionType;
  canEditCategories: boolean;
  onUpdated: () => Promise<void> | void;
}

export const FinancialCategoriesModal: React.FC<FinancialCategoriesModalProps> = ({
  isOpen,
  onClose,
  organizationId,
  categories,
  initialTab = 'payable',
  canEditCategories,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<FinancialTransactionType>(initialTab);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const list = categories.filter((c) => c.categoryType === activeTab);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditCategories || isCreating) return;
    setErrorMsg('');
    setIsCreating(true);
    const res = await FinancialCloudService.saveFinancialCategoryToCloud({
      organizationId,
      name: newName,
      categoryType: activeTab,
    });
    setIsCreating(false);
    if (!res.success) {
      setErrorMsg(res.error || 'Erro ao criar categoria.');
      return;
    }
    setNewName('');
    await onUpdated();
  };

  const handleSaveRename = async (cat: FinancialCategory) => {
    if (!canEditCategories) return;
    setErrorMsg('');
    setBusyId(cat.id);
    const res = await FinancialCloudService.saveFinancialCategoryToCloud({
      id: cat.id,
      organizationId: cat.organizationId || organizationId,
      name: editingName,
      categoryType: cat.categoryType,
      isActive: cat.isActive,
    });
    setBusyId(null);
    if (!res.success) {
      setErrorMsg(res.error || 'Erro ao renomear categoria.');
      return;
    }
    setEditingId(null);
    await onUpdated();
  };

  const handleToggleActive = async (cat: FinancialCategory) => {
    if (!canEditCategories) return;
    setErrorMsg('');
    setBusyId(cat.id);
    const res = await FinancialCloudService.toggleFinancialCategoryActiveInCloud(
      cat.id,
      !cat.isActive,
      cat.organizationId || organizationId
    );
    setBusyId(null);
    if (!res.success) {
      setErrorMsg(res.error || 'Erro ao alterar status da categoria.');
      return;
    }
    await onUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">Categorias Financeiras</h3>
            <p className="text-[11px] text-slate-400">
              Gerencie os tipos de receitas e despesas diretamente pelo sistema (persistido no Supabase).
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

        <div className="p-6 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setActiveTab('receivable');
                setEditingId(null);
                setErrorMsg('');
              }}
              className={`py-2 rounded-lg font-bold transition ${
                activeTab === 'receivable'
                  ? 'bg-white text-sky-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Categorias de Receitas ({categories.filter((c) => c.categoryType === 'receivable').length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('payable');
                setEditingId(null);
                setErrorMsg('');
              }}
              className={`py-2 rounded-lg font-bold transition ${
                activeTab === 'payable'
                  ? 'bg-white text-rose-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Categorias de Despesas ({categories.filter((c) => c.categoryType === 'payable').length})
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {canEditCategories && (
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  activeTab === 'payable'
                    ? 'Nova categoria de despesa (ex: Taxas bancárias, Seguro clínica)...'
                    : 'Nova categoria de receita (ex: Pacote Emagrecimento, Laudo)...'
                }
                className="flex-1 px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                disabled={isCreating || newName.trim().length < 2}
                className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {isCreating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Adicionar</span>
              </button>
            </form>
          )}

          <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
            {list.length === 0 ? (
              <p className="p-6 text-center text-slate-400">
                Nenhuma categoria cadastrada para este tipo.
              </p>
            ) : (
              list.map((cat) => (
                <div
                  key={cat.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                >
                  {editingId === cat.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border border-sky-300 rounded-lg"
                        autoFocus
                      />
                      <button
                        type="button"
                        disabled={busyId === cat.id}
                        onClick={() => void handleSaveRename(cat)}
                        className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold inline-flex items-center gap-1"
                      >
                        {busyId === cat.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        <span>Salvar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1.5 text-slate-500 hover:text-slate-800"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`font-semibold truncate ${
                            cat.isActive ? 'text-slate-800' : 'text-slate-400 line-through'
                          }`}
                        >
                          {cat.name}
                        </span>
                        {!cat.isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold">
                            Inativa
                          </span>
                        )}
                      </div>

                      {canEditCategories && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(cat.id);
                              setEditingName(cat.name);
                            }}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition"
                            title="Renomear categoria"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busyId === cat.id}
                            onClick={() => void handleToggleActive(cat)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition ${
                              cat.isActive
                                ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                                : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            }`}
                            title={cat.isActive ? 'Desativar categoria' : 'Reativar categoria'}
                          >
                            {busyId === cat.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Power className="w-3 h-3" />
                            )}
                            <span>{cat.isActive ? 'Desativar' : 'Reativar'}</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
