import React, { useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Eye,
  FileText,
  MapPin,
  Pencil,
  X,
  MousePointerClick,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Patient } from '../../types';
import { StorageService } from '../../services/storage';
import { ClinicalCloudService } from '../../services/clinicalCloudService';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { PatientFormModal } from './PatientFormModal';
import { PatientDetailsModal } from './PatientDetailsModal';

interface PatientsModuleProps {
  onNavigateToSchedule?: (patient: Patient) => void;
  onNavigateToRecord?: (patient: Patient) => void;
}

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, a, input, select, textarea, [role="button"]'));
};

export const PatientsModule: React.FC<PatientsModuleProps> = ({
  onNavigateToSchedule,
  onNavigateToRecord,
}) => {
  const { activeBranchId, branches } = useTenant();
  const { isImpersonating } = useAuth();
  const [patients, setPatients] = useState<Patient[]>(() => StorageService.getPatients(activeBranchId));
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sharingFilter, setSharingFilter] = useState<string>('all');

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedPatientForEdit, setSelectedPatientForEdit] = useState<Patient | null>(null);
  const [selectedPatientForDetails, setSelectedPatientForDetails] = useState<Patient | null>(null);

  const loadPatients = async () => {
    setIsLoadingPatients(true);
    setSyncError('');
    try {
      const res = await ClinicalCloudService.fetchPatientsFromCloud(activeBranchId);
      setPatients(res.patients);
      if (res.error) {
        setSyncError(res.error);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Erro ao sincronizar pacientes.');
    } finally {
      setIsLoadingPatients(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setPatients(StorageService.getPatients(activeBranchId));
    setIsLoadingPatients(true);
    setSyncError('');
    ClinicalCloudService.fetchPatientsFromCloud(activeBranchId)
      .then((res) => {
        if (cancelled) return;
        setPatients(res.patients);
        if (res.error) setSyncError(res.error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPatients(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const refreshList = (savedPatient?: Patient) => {
    if (savedPatient) {
      setSelectedPatientId(savedPatient.id);
    }
    setPatients(StorageService.getPatients(activeBranchId));
    void loadPatients();
  };

  const openEditModal = (patient: Patient) => {
    setSelectedPatientId(patient.id);
    setSelectedPatientForEdit(patient);
    setIsFormOpen(true);
  };

  const handleRowClick = (e: React.MouseEvent, patient: Patient) => {
    if (isInteractiveTarget(e.target)) return;
    setSelectedPatientId(patient.id);
  };

  const handleRowDoubleClick = (e: React.MouseEvent, patient: Patient) => {
    if (isInteractiveTarget(e.target)) return;
    openEditModal(patient);
  };

  const handleRowKeyDown = (e: React.KeyboardEvent, patient: Patient) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedPatientId(patient.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      openEditModal(patient);
    }
  };

  const filteredPatients = patients.filter(p => {
    if (sharingFilter !== 'all' && p.sharingMode !== sharingFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase().replace(/\D/g, '');
      const qText = searchQuery.toLowerCase();
      const matchName = p.fullName.toLowerCase().includes(qText);
      const matchCpf = q.length > 0 && p.documentCpf.replace(/\D/g, '').includes(q);
      const matchPhone = q.length > 0 && p.phone.replace(/\D/g, '').includes(q);
      if (!matchName && !matchCpf && !matchPhone) return false;
    }
    return true;
  });

  const selectedPatient =
    filteredPatients.find(p => p.id === selectedPatientId) ||
    patients.find(p => p.id === selectedPatientId) ||
    null;

  const stickyOffsetClass = isImpersonating ? 'top-[6.25rem]' : 'top-[4.25rem]';

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Gestão de Pacientes
            </h1>
            <span className="text-xs font-semibold text-sky-700 bg-sky-50 px-2.5 py-0.5 rounded-full border border-sky-200 inline-flex items-center gap-1.5">
              {isLoadingPatients && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>{patients.length} Pacientes Cadastrados</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Cadastro completo, controle de duplicidades por CPF e regras de compartilhamento entre filiais.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadPatients()}
            disabled={isLoadingPatients}
            title="Atualizar lista de pacientes"
            className="p-2 text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingPatients ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedPatientForEdit(null);
              setIsFormOpen(true);
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Cadastrar Novo Paciente</span>
          </button>
        </div>
      </div>

      {syncError && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Aviso de sincronização com o banco de dados: {syncError}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">

        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            aria-label="Pesquisar pacientes por nome, CPF ou telefone"
            placeholder="Pesquisar por Nome, CPF ou Telefone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <select
            aria-label="Filtrar por modelo de compartilhamento"
            value={sharingFilter}
            onChange={(e) => setSharingFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium text-slate-700"
          >
            <option value="all">Todos os Modelos de Compartilhamento</option>
            <option value="model_b_shared">Modelo B: Compartilhado entre Filiais</option>
            <option value="model_a_exclusive">Modelo A: Exclusivo da Filial</option>
          </select>
        </div>

      </div>

      {/* Sticky Selected Patient Actions Bar (Always visible without scrolling) */}
      {selectedPatient && (
        <div
          role="region"
          aria-label={`Ações para o paciente selecionado ${selectedPatient.fullName}`}
          className={`sticky ${stickyOffsetClass} z-30 p-3 sm:px-4 bg-white/95 backdrop-blur-md rounded-2xl border border-sky-300 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3`}
        >
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
              {selectedPatient.fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                  Selecionado
                </span>
                <span className="text-sm font-bold text-slate-900 truncate">
                  {selectedPatient.fullName}
                </span>
                {selectedPatient.allergies && selectedPatient.allergies.length > 0 && (
                  <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded border border-rose-200">
                    ⚠️ {selectedPatient.allergies.length} Alergia(s)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                CPF: <span className="font-mono text-slate-700">{selectedPatient.documentCpf}</span> · {selectedPatient.phone}
                {selectedPatient.healthPlanType === 'convenio'
                  ? ` · ${selectedPatient.healthPlanOperator || 'Convênio'}`
                  : ' · Particular'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <button
              type="button"
              onClick={() => openEditModal(selectedPatient)}
              aria-label={`Editar cadastro de ${selectedPatient.fullName}`}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Editar Paciente</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedPatientForDetails(selectedPatient)}
              aria-label={`Ver cadastro completo de ${selectedPatient.fullName}`}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Ver Cadastro</span>
            </button>

            {onNavigateToRecord && (
              <button
                type="button"
                onClick={() => onNavigateToRecord(selectedPatient)}
                className="px-3 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Prontuário (PEP)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setSelectedPatientId(null)}
              aria-label="Limpar seleção de paciente"
              title="Limpar seleção"
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Subtle Quick-Edit Hint */}
      <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <MousePointerClick className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span>
            Clique em um paciente para fixar as ações no topo · <strong>Duplo clique</strong> (ou <kbd className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 border border-slate-200 rounded">F2</kbd>) na linha para editar diretamente.
          </span>
        </div>
        <span className="hidden sm:inline text-slate-400 shrink-0">
          {filteredPatients.length} {filteredPatients.length === 1 ? 'resultado' : 'resultados'}
        </span>
      </div>

      {/* Desktop Patients Table (md and up) */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Paciente</th>
                <th className="py-3 px-4">Documento / CPF</th>
                <th className="py-3 px-4">Contato</th>
                <th className="py-3 px-4">Filial de Referência</th>
                <th className="py-3 px-4">Compartilhamento</th>
                <th className="py-3 px-4 text-right sticky right-0 bg-slate-50 border-l border-slate-200 z-10">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Nenhum paciente localizado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredPatients.map((p) => {
                  const branch = branches.find(b => b.id === p.originBranchId);
                  const isSelected = selectedPatientId === p.id;
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      aria-selected={isSelected}
                      aria-label={`Paciente ${p.fullName}, CPF ${p.documentCpf}. Pressione Enter para selecionar ou F2 para editar.`}
                      title="Clique para selecionar · Duplo clique ou F2 para editar"
                      onClick={(e) => handleRowClick(e, p)}
                      onDoubleClick={(e) => handleRowDoubleClick(e, p)}
                      onKeyDown={(e) => handleRowKeyDown(e, p)}
                      className={`group cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${
                        isSelected
                          ? 'bg-sky-50/90'
                          : 'bg-white hover:bg-slate-50/80'
                      }`}
                    >

                      {/* Name & Clinical Tags */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${isSelected ? 'text-sky-950' : 'text-slate-900'}`}>
                            {p.fullName}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded transition-opacity ${
                              isSelected
                                ? 'text-sky-700 bg-sky-100/80 opacity-100'
                                : 'text-slate-400 bg-slate-100 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                            }`}
                          >
                            <Pencil className="w-2.5 h-2.5" />
                            <span>Duplo clique edita</span>
                          </span>
                          {p.allergies && p.allergies.length > 0 && (
                            <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded border border-rose-200" title={`Alergias: ${p.allergies.join(', ')}`}>
                              ⚠️ {p.allergies.length} Alergia(s)
                            </span>
                          )}
                        </div>
                        {p.socialName && (
                          <div className="text-[11px] text-sky-700 italic">Nome Social: {p.socialName}</div>
                        )}
                        <span className="text-[11px] text-slate-500">
                          {p.birthDate ? `${new Date(p.birthDate + 'T00:00:00').toLocaleDateString('pt-BR')} · ${p.gender}` : p.gender}
                          {p.bloodType && p.bloodType !== 'desconhecido' && ` · Tipo ${p.bloodType}`}
                        </span>
                      </td>

                      {/* CPF & Convênio */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-mono text-slate-700 font-medium">{p.documentCpf}</div>
                        <span className="text-[10px] text-slate-500">
                          {p.healthPlanType === 'convenio' ? `${p.healthPlanOperator || 'Convênio'}` : 'Particular'}
                        </span>
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="text-slate-800 font-medium block">{p.phone}</span>
                        <span className="text-[11px] text-slate-400 block">{p.email || 'Sem e-mail'}</span>
                      </td>

                      {/* Branch */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-800 font-medium">
                          <MapPin className="w-3.5 h-3.5 text-sky-600" />
                          <span>{branch?.name || 'Matriz'}</span>
                        </div>
                      </td>

                      {/* Sharing Mode */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {p.sharingMode === 'model_b_shared' ? (
                          <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
                            Modelo B: Compartilhado
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                            Modelo A: Exclusivo
                          </span>
                        )}
                      </td>

                      {/* Actions (Sticky Right so Editar never scrolls off-screen horizontally) */}
                      <td
                        className={`py-3.5 px-4 text-right whitespace-nowrap sticky right-0 border-l transition-colors ${
                          isSelected
                            ? 'bg-sky-50 border-sky-200'
                            : 'bg-white group-hover:bg-slate-50 border-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPatientId(p.id);
                              setSelectedPatientForDetails(p);
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-lg transition"
                            title="Ver Cadastro Completo"
                            aria-label={`Ver cadastro completo de ${p.fullName}`}
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {onNavigateToRecord && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPatientId(p.id);
                                onNavigateToRecord(p);
                              }}
                              onDoubleClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition flex items-center gap-1"
                              title="Abrir no Prontuário Eletrônico (PEP)"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Prontuário (PEP)</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(p);
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            aria-label={`Editar cadastro de ${p.fullName}`}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition flex items-center gap-1 ${
                              isSelected
                                ? 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                            }`}
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Editar</span>
                          </button>
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

      {/* Responsive Mobile Cards (< md) so Editar & actions require zero horizontal scroll */}
      <div className="md:hidden space-y-3">
        {filteredPatients.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
            Nenhum paciente localizado com os filtros selecionados.
          </div>
        ) : (
          filteredPatients.map((p) => {
            const branch = branches.find(b => b.id === p.originBranchId);
            const isSelected = selectedPatientId === p.id;
            return (
              <div
                key={p.id}
                tabIndex={0}
                aria-selected={isSelected}
                aria-label={`Paciente ${p.fullName}, CPF ${p.documentCpf}. Pressione Enter para selecionar ou F2 para editar.`}
                onClick={(e) => handleRowClick(e, p)}
                onDoubleClick={(e) => handleRowDoubleClick(e, p)}
                onKeyDown={(e) => handleRowKeyDown(e, p)}
                className={`rounded-2xl border p-4 shadow-xs transition-colors cursor-pointer space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  isSelected
                    ? 'bg-sky-50/70 border-sky-300'
                    : 'bg-white border-slate-200 hover:bg-slate-50/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm text-slate-900">{p.fullName}</span>
                      {p.allergies && p.allergies.length > 0 && (
                        <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded border border-rose-200">
                          ⚠️ {p.allergies.length} Alergia(s)
                        </span>
                      )}
                    </div>
                    {p.socialName && (
                      <div className="text-[11px] text-sky-700 italic">Nome Social: {p.socialName}</div>
                    )}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {p.birthDate ? `${new Date(p.birthDate + 'T00:00:00').toLocaleDateString('pt-BR')} · ${p.gender}` : p.gender}
                      {p.bloodType && p.bloodType !== 'desconhecido' && ` · Tipo ${p.bloodType}`}
                    </p>
                  </div>

                  {p.sharingMode === 'model_b_shared' ? (
                    <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200 shrink-0">
                      Compartilhado
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 shrink-0">
                      Exclusivo
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-2 border-t border-slate-100">
                  <div>
                    <span className="text-slate-400 block">CPF / Modalidade</span>
                    <span className="font-mono font-medium text-slate-800 block">{p.documentCpf}</span>
                    <span>{p.healthPlanType === 'convenio' ? `${p.healthPlanOperator || 'Convênio'}` : 'Particular'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Contato / Filial</span>
                    <span className="font-medium text-slate-800 block">{p.phone}</span>
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <MapPin className="w-3 h-3 text-sky-600 shrink-0" />
                      <span className="truncate">{branch?.name || 'Matriz'}</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(p);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-label={`Editar cadastro de ${p.fullName}`}
                    className="flex-1 min-w-[110px] px-3 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition flex items-center justify-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPatientId(p.id);
                      setSelectedPatientForDetails(p);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-label={`Ver cadastro completo de ${p.fullName}`}
                    className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center justify-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Cadastro</span>
                  </button>

                  {onNavigateToRecord && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPatientId(p.id);
                        onNavigateToRecord(p);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="px-3 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition flex items-center justify-center gap-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>PEP</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Patient Form Modal */}
      <PatientFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        existingPatient={selectedPatientForEdit}
        onSaveSuccess={refreshList}
      />

      {/* Patient Details Modal */}
      <PatientDetailsModal
        isOpen={Boolean(selectedPatientForDetails)}
        onClose={() => setSelectedPatientForDetails(null)}
        patient={selectedPatientForDetails}
        onEdit={(p) => openEditModal(p)}
        onNewAppointment={(p) => {
          if (onNavigateToSchedule) onNavigateToSchedule(p);
        }}
        onOpenRecord={(p) => {
          if (onNavigateToRecord) onNavigateToRecord(p);
        }}
      />

    </div>
  );
};
