import React, { useState } from 'react';
import { X, Volume2, Mic, Clock, Save, User, DoorClosed, Play, Loader2 } from 'lucide-react';
import {
  CallPanelSettings,
  PatientNameDisplayMode,
  Professional,
  Room,
} from '../../types';
import { AttendanceCloudService } from '../../services/attendanceCloudService';
import { playClinicCallChime, announcePatientCallSpeech } from '../../services/callAudioService';
import { buildPatientVoiceAnnouncementText } from '../../services/attendanceQueueUtils';

interface CallPanelSettingsModalProps {
  isOpen: boolean;
  settings: CallPanelSettings;
  professionals: Professional[];
  rooms: Room[];
  onClose: () => void;
  onSaved: (updated: CallPanelSettings) => void;
}

export const CallPanelSettingsModal: React.FC<CallPanelSettingsModalProps> = ({
  isOpen,
  settings,
  professionals,
  rooms,
  onClose,
  onSaved,
}) => {
  const [defaultProfessionalId, setDefaultProfessionalId] = useState(
    settings.defaultProfessionalId || ''
  );
  const [defaultRoomId, setDefaultRoomId] = useState(settings.defaultRoomId || '');
  const [physicianDisplayLabel, setPhysicianDisplayLabel] = useState(
    settings.physicianDisplayLabel || ''
  );
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled);
  const [chimeVolume, setChimeVolume] = useState(settings.chimeVolume ?? 0.7);
  const [autoStartDelaySeconds, setAutoStartDelaySeconds] = useState(
    settings.autoStartDelaySeconds ?? 120
  );
  const [patientNameDisplayMode, setPatientNameDisplayMode] =
    useState<PatientNameDisplayMode>(settings.patientNameDisplayMode || 'full');

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleTestChime = () => {
    void playClinicCallChime(chimeVolume);
  };

  const handleTestVoice = () => {
    const profName =
      physicianDisplayLabel.trim() ||
      professionals.find((p) => p.id === defaultProfessionalId)?.fullName ||
      professionals[0]?.fullName ||
      'Dr. Newton Mureb';
    const roomName =
      rooms.find((r) => r.id === defaultRoomId)?.name || rooms[0]?.name || 'Consultório 01';
    announcePatientCallSpeech({
      text: buildPatientVoiceAnnouncementText({
        patientName: 'Maria Silva',
        roomName,
        professionalName: profName,
      }),
      enabled: true,
      volume: chimeVolume || 0.85,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);

    const payload: CallPanelSettings = {
      ...settings,
      defaultProfessionalId: defaultProfessionalId || undefined,
      defaultRoomId: defaultRoomId || undefined,
      physicianDisplayLabel: physicianDisplayLabel.trim() || undefined,
      soundEnabled,
      voiceEnabled,
      chimeVolume: Math.max(0, Math.min(1, Number(chimeVolume))),
      autoStartDelaySeconds: Math.max(
        15,
        Math.min(1800, Math.round(Number(autoStartDelaySeconds) || 120))
      ),
      patientNameDisplayMode,
    };

    const res = await AttendanceCloudService.saveCallPanelSettings(payload);
    setIsSaving(false);

    if (!res.success || !res.settings) {
      setError(res.error || 'Não foi possível salvar as configurações no Supabase.');
      return;
    }

    onSaved(res.settings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-4">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              Configurações do Painel de Chamada
            </h2>
            <p className="text-xs text-slate-500">
              Preferências de médico, sala, alertas sonoros, voz e início automático persistidas no Supabase.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition"
            aria-label="Fechar configurações"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl font-medium">
              {error}
            </div>
          )}

          {/* Médico & Sala Padrão */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
                <User className="w-3.5 h-3.5 text-sky-600" />
                <span>Médico Padrão do Painel</span>
              </label>
              <select
                value={defaultProfessionalId}
                onChange={(e) => setDefaultProfessionalId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">Selecionar manualmente no painel</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
                <DoorClosed className="w-3.5 h-3.5 text-sky-600" />
                <span>Sala / Consultório Padrão</span>
              </label>
              <select
                value={defaultRoomId}
                onChange={(e) => setDefaultRoomId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">Usar sala do agendamento</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Nome de Exibição do Médico no Painel (opcional)
              </label>
              <input
                type="text"
                value={physicianDisplayLabel}
                onChange={(e) => setPhysicianDisplayLabel(e.target.value)}
                placeholder="Ex: Dr. Newton Mureb"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Exibição do Nome do Paciente
              </label>
              <select
                value={patientNameDisplayMode}
                onChange={(e) =>
                  setPatientNameDisplayMode(e.target.value as PatientNameDisplayMode)
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="full">Nome completo (Ex: Maria Souza Oliveira)</option>
                <option value="first_last">Primeiro e último nome (Ex: Maria Oliveira)</option>
                <option value="initials">Primeiro nome + iniciais (Ex: Maria S. O.)</option>
              </select>
            </div>
          </div>

          {/* Temporizador de início automático */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <div>
                  <p className="font-bold text-slate-900">
                    Tempo para Início Automático do Atendimento
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Após a chamada, se o botão INICIAR não for clicado, inicia automaticamente após este prazo (padrão: 120s).
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number"
                  min={15}
                  max={1800}
                  step={5}
                  value={autoStartDelaySeconds}
                  onChange={(e) => setAutoStartDelaySeconds(Number(e.target.value) || 120)}
                  className="w-20 px-2.5 py-1.5 text-center font-bold border border-slate-300 rounded-lg bg-white"
                />
                <span className="text-slate-600 font-semibold">seg</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[60, 120, 180, 300].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAutoStartDelaySeconds(preset)}
                  className={`px-2.5 py-1 rounded-lg font-semibold border transition ${
                    autoStartDelaySeconds === preset
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {preset}s ({Math.round(preset / 60)} min)
                </button>
              ))}
            </div>
          </div>

          {/* Áudio & Voz */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <Volume2 className="w-4 h-4 text-sky-600" />
                <span className="font-bold text-slate-800">Som de Chamada Ativo (Campainha)</span>
              </label>

              <button
                type="button"
                onClick={handleTestChime}
                className="px-3 py-1.5 text-[11px] font-semibold bg-white border border-slate-300 rounded-lg hover:bg-slate-100 inline-flex items-center gap-1 self-start"
              >
                <Play className="w-3 h-3 text-sky-600" />
                <span>Testar Campainha</span>
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-slate-700">Volume do Alerta Sonoro</span>
                <span className="font-mono font-bold text-slate-700">
                  {Math.round(chimeVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={chimeVolume}
                onChange={(e) => setChimeVolume(Number(e.target.value))}
                className="w-full accent-sky-600"
              />
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <Mic className="w-4 h-4 text-emerald-600" />
                <span className="font-bold text-slate-800">
                  Chamada por Voz (Síntese pt-BR do Navegador)
                </span>
              </label>

              <button
                type="button"
                onClick={handleTestVoice}
                className="px-3 py-1.5 text-[11px] font-semibold bg-white border border-slate-300 rounded-lg hover:bg-slate-100 inline-flex items-center gap-1 self-start"
              >
                <Play className="w-3 h-3 text-emerald-600" />
                <span>Testar Voz</span>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{isSaving ? 'Salvando...' : 'Salvar Configurações'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
