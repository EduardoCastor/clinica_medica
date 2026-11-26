import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Lock,
  Loader2,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { ClinicLoginScreen } from '../clinic/ClinicLoginScreen';
import { StorageService } from '../../services/storage';
import { getSupabase } from '../../services/supabaseClient';
import {
  AttendanceCloudService,
  getDefaultCallPanelSettings,
} from '../../services/attendanceCloudService';
import {
  buildPatientVoiceAnnouncementText,
  formatCallPanelPatientName,
  formatCountdownMmSs,
  formatElapsedHms,
  formatFullDateSaoPaulo,
  formatTimeSaoPaulo,
  formatTimeWithSecondsSaoPaulo,
  getAttendanceCallEventKey,
  getAutoStartRemainingSeconds,
  resolvePhysicianPanelSnapshot,
} from '../../services/attendanceQueueUtils';
import {
  triggerPatientCallAlert,
  unlockCallAudioContext,
} from '../../services/callAudioService';
import {
  Appointment,
  AttendanceCallRecord,
  CallPanelSettings,
  PatientNameDisplayMode,
} from '../../types';

type RealtimeConnectionState = 'connected' | 'reconnecting' | 'offline';

function parseDisplayQueryParams(): {
  orgId: string;
  branchId: string;
  professionalId: string;
  roomId: string;
  nameMode?: PatientNameDisplayMode;
} {
  if (typeof window === 'undefined') {
    return { orgId: '', branchId: 'all', professionalId: 'all', roomId: '' };
  }
  const sp = new URLSearchParams(window.location.search);
  const rawNameMode = sp.get('nameMode');
  const validNameMode: PatientNameDisplayMode | undefined =
    rawNameMode === 'full' || rawNameMode === 'first_last' || rawNameMode === 'initials'
      ? rawNameMode
      : undefined;

  return {
    orgId: (sp.get('orgId') || '').trim(),
    branchId: (sp.get('branchId') || 'all').trim() || 'all',
    professionalId: (sp.get('professionalId') || 'all').trim() || 'all',
    roomId: (sp.get('roomId') || '').trim(),
    nameMode: validNameMode,
  };
}

export const PublicAttendanceDisplayPage: React.FC = () => {
  const { organization, clinic, branches, activeBranchId } = useTenant();
  const {
    isAuthenticated,
    isAuthLoading,
    isSuperAdmin,
    canViewMenu,
    canConsultMenu,
    currentUser,
  } = useAuth();

  const queryParams = useMemo(() => parseDisplayQueryParams(), []);

  const displayRootRef = useRef<HTMLDivElement | null>(null);
  const hasHydratedRef = useRef(false);
  const announcedEventKeysRef = useRef<Set<string>>(new Set());
  const wasDisconnectedRef = useRef(false);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calls, setCalls] = useState<AttendanceCallRecord[]>([]);
  const [settings, setSettings] = useState<CallPanelSettings>(() =>
    getDefaultCallPanelSettings(organization.id, queryParams.branchId)
  );
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connected'
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenHint, setFullscreenHint] = useState('');
  const [isLocalMuted, setIsLocalMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [callHighlightActive, setCallHighlightActive] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);

  const isTenantMismatch = Boolean(
    isAuthenticated &&
      queryParams.orgId &&
      organization.id &&
      queryParams.orgId !== organization.id &&
      !isSuperAdmin
  );

  const isAuthorizedForPanel =
    isAuthenticated &&
    (isSuperAdmin || canViewMenu('call_panel') || canConsultMenu('call_panel'));

  const resolvedOrgId =
    isSuperAdmin && queryParams.orgId ? queryParams.orgId : organization.id;
  const resolvedBranchId = queryParams.branchId || activeBranchId || 'all';

  const professionals = useMemo(
    () => StorageService.getProfessionals().filter((p) => p.isActive !== false),
    [catalogVersion]
  );

  const rooms = useMemo(
    () => StorageService.getRooms().filter((r) => r.isActive !== false),
    [catalogVersion]
  );

  const effectiveProfessionalId = useMemo(() => {
    if (queryParams.professionalId) return queryParams.professionalId;
    if (settings.defaultProfessionalId) return settings.defaultProfessionalId;
    return 'all';
  }, [queryParams.professionalId, settings.defaultProfessionalId]);

  const effectiveNameMode: PatientNameDisplayMode =
    queryParams.nameMode || settings.patientNameDisplayMode || 'full';

  const loadDisplayData = useCallback(async () => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;
    setLoadError('');
    try {
      const [aptRes, cloudRes] = await Promise.all([
        StorageService.fetchAppointmentsFromCloudDetailed(),
        AttendanceCloudService.fetchCallPanelSnapshot(resolvedOrgId, resolvedBranchId),
      ]);

      setAppointments(aptRes.appointments);
      setCalls(cloudRes.calls);
      if (cloudRes.settings) {
        setSettings(cloudRes.settings);
      }

      const errs: string[] = [];
      if (aptRes.error) errs.push(aptRes.error);
      if (cloudRes.error) errs.push(cloudRes.error);
      if (errs.length > 0) {
        setLoadError(errs.join(' · '));
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Erro ao atualizar dados do painel.'
      );
    } finally {
      setIsInitialLoading(false);
    }
  }, [isAuthorizedForPanel, isTenantMismatch, resolvedOrgId, resolvedBranchId]);

  // Initial load + catalog hydration
  useEffect(() => {
    const onStorageUpdate = () => setCatalogVersion((v) => v + 1);
    window.addEventListener('medsync_storage_update', onStorageUpdate);
    return () => window.removeEventListener('medsync_storage_update', onStorageUpdate);
  }, []);

  useEffect(() => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) {
      setIsInitialLoading(false);
      return;
    }
    setIsInitialLoading(true);
    void StorageService.hydrateClinicCoreCatalogFromCloud(resolvedOrgId).finally(() => {
      setCatalogVersion((v) => v + 1);
      void loadDisplayData();
    });
  }, [isAuthorizedForPanel, isTenantMismatch, resolvedOrgId, loadDisplayData]);

  // 1-second clock & timer tick
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) {
        setFullscreenHint('');
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Browser online/offline listeners + resync upon reconnect
  useEffect(() => {
    const handleOnline = () => {
      setConnectionState('reconnecting');
      void loadDisplayData().then(() => {
        setConnectionState('connected');
        wasDisconnectedRef.current = false;
      });
    };
    const handleOffline = () => {
      wasDisconnectedRef.current = true;
      setConnectionState('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadDisplayData]);

  // Supabase Realtime + automatic reconnection & resync
  useEffect(() => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;

    const supabase = getSupabase();
    const fallbackTimer = window.setInterval(() => {
      void loadDisplayData();
    }, 15000);

    if (!supabase) {
      return () => window.clearInterval(fallbackTimer);
    }

    const channel = supabase
      .channel(`tv-display-${resolvedOrgId}-${resolvedBranchId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_calls',
          filter: `organization_id=eq.${resolvedOrgId}`,
        },
        () => {
          void loadDisplayData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_call_events',
          filter: `organization_id=eq.${resolvedOrgId}`,
        },
        () => {
          void loadDisplayData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `organization_id=eq.${resolvedOrgId}`,
        },
        () => {
          void loadDisplayData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_panel_settings',
          filter: `organization_id=eq.${resolvedOrgId}`,
        },
        () => {
          void loadDisplayData();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('connected');
          if (wasDisconnectedRef.current) {
            wasDisconnectedRef.current = false;
            void loadDisplayData();
          }
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          wasDisconnectedRef.current = true;
          setConnectionState(
            typeof navigator !== 'undefined' && !navigator.onLine
              ? 'offline'
              : 'reconnecting'
          );
        }
      });

    return () => {
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [
    isAuthorizedForPanel,
    isTenantMismatch,
    resolvedOrgId,
    resolvedBranchId,
    loadDisplayData,
  ]);

  const snapshot = useMemo(
    () =>
      resolvePhysicianPanelSnapshot(appointments, calls, {
        organizationId: resolvedOrgId,
        branchId: resolvedBranchId,
        professionalId: effectiveProfessionalId,
      }),
    [appointments, calls, resolvedOrgId, resolvedBranchId, effectiveProfessionalId]
  );

  // Event-ID deduplicated chime & voice announcement on incoming call
  useEffect(() => {
    if (isInitialLoading) return;

    const activeCalled = snapshot.activeCalled;
    const eventKey = getAttendanceCallEventKey(activeCalled);

    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      if (eventKey) {
        announcedEventKeysRef.current.add(eventKey);
      }
      return;
    }

    if (!activeCalled || !eventKey) return;
    if (announcedEventKeysRef.current.has(eventKey)) return;

    announcedEventKeysRef.current.add(eventKey);
    // Keep session Set bounded
    if (announcedEventKeysRef.current.size > 200) {
      const oldest = announcedEventKeysRef.current.values().next().value;
      if (oldest) announcedEventKeysRef.current.delete(oldest);
    }

    setCallHighlightActive(true);
    const timer = window.setTimeout(() => setCallHighlightActive(false), 4000);

    if (!isLocalMuted) {
      const speechText = buildPatientVoiceAnnouncementText({
        patientName: formatCallPanelPatientName(
          activeCalled.patientName,
          effectiveNameMode
        ),
        roomName: activeCalled.roomName,
        professionalName: activeCalled.professionalName,
      });

      void triggerPatientCallAlert({
        soundEnabled: settings.soundEnabled,
        voiceEnabled: settings.voiceEnabled,
        chimeVolume: settings.chimeVolume,
        speechText,
      });
    }

    return () => window.clearTimeout(timer);
  }, [
    isInitialLoading,
    snapshot.activeCalled,
    effectiveNameMode,
    isLocalMuted,
    settings.soundEnabled,
    settings.voiceEnabled,
    settings.chimeVolume,
  ]);

  const handleToggleFullscreen = async () => {
    setFullscreenHint('');
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const target = displayRootRef.current || document.documentElement;
      if (target?.requestFullscreen) {
        await target.requestFullscreen();
      } else {
        setFullscreenHint(
          'Seu navegador não suporta tela cheia automática. Pressione F11 para expandir.'
        );
      }
    } catch {
      setFullscreenHint(
        'O navegador bloqueou a tela cheia automática. Pressione F11 para exibir em tela inteira.'
      );
    }
  };

  const handleToggleAudioUnlockOrMute = async () => {
    const unlocked = await unlockCallAudioContext();
    setAudioUnlocked(unlocked);
    if (audioUnlocked) {
      setIsLocalMuted((prev) => !prev);
    } else {
      setIsLocalMuted(false);
    }
  };

  // Auth loading state
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-slate-600 gap-3 text-sm font-semibold">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
        <span>Autenticando painel de exibição...</span>
      </div>
    );
  }

  // Unauthenticated session -> secure clinic login (no patient data exposed)
  if (!isAuthenticated) {
    return <ClinicLoginScreen />;
  }

  // Tenant isolation or RBAC guard
  if (isTenantMismatch || !isAuthorizedForPanel) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-extrabold text-slate-900">
            Acesso não autorizado ao painel
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            {isTenantMismatch
              ? 'O endereço deste painel pertence a uma clínica diferente da sua sessão autenticada.'
              : `O perfil (${currentUser.fullName}) não possui permissão para visualizar o painel de chamada.`}
          </p>
        </div>
      </div>
    );
  }

  const branchName =
    resolvedBranchId === 'all'
      ? 'Todas as Unidades'
      : branches.find((b) => b.id === resolvedBranchId)?.name || '';

  const matchedProfessional =
    effectiveProfessionalId !== 'all'
      ? professionals.find((p) => p.id === effectiveProfessionalId) || null
      : null;

  const matchedRoom = queryParams.roomId
    ? rooms.find((r) => r.id === queryParams.roomId) || null
    : settings.defaultRoomId
    ? rooms.find((r) => r.id === settings.defaultRoomId) || null
    : null;

  const scopeDescription =
    effectiveProfessionalId === 'all'
      ? 'Recepção Geral · Todos os Médicos'
      : matchedProfessional?.fullName ||
        (settings.physicianDisplayLabel &&
        (!settings.defaultProfessionalId ||
          settings.defaultProfessionalId === effectiveProfessionalId)
          ? settings.physicianDisplayLabel
          : 'Consultório');

  const displayedCall = snapshot.activeCalled || snapshot.activeInProgress;
  const isCalledState = Boolean(snapshot.activeCalled);
  const isInProgressState = Boolean(!snapshot.activeCalled && snapshot.activeInProgress);

  const calledRemainingSec = snapshot.activeCalled
    ? getAutoStartRemainingSeconds(
        snapshot.activeCalled.calledAt,
        snapshot.activeCalled.autoStartDelaySeconds,
        nowMs
      )
    : 0;

  const displayedPhysicianName = displayedCall
    ? effectiveProfessionalId !== 'all' &&
      settings.physicianDisplayLabel &&
      (!settings.defaultProfessionalId ||
        settings.defaultProfessionalId === displayedCall.professionalId)
      ? settings.physicianDisplayLabel
      : displayedCall.professionalName
    : '';

  const soundActive = !isLocalMuted && (settings.soundEnabled || settings.voiceEnabled);

  return (
    <div
      ref={displayRootRef}
      data-testid="public-attendance-display"
      className="min-h-screen lg:h-screen w-screen lg:overflow-hidden bg-white text-slate-900 flex flex-col lg:flex-row select-none"
    >
      {/* ÁREA PRINCIPAL (75%) — Fundo Branco Predominante */}
      <main
        className={`w-full lg:w-[75%] flex-1 lg:h-full flex flex-col justify-between px-6 py-5 sm:px-10 sm:py-8 xl:px-14 xl:py-10 transition-colors duration-500 ${
          callHighlightActive ? 'bg-emerald-50/70' : 'bg-white'
        }`}
      >
        {/* Identificação discreta da clínica + controles de TV discretos */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
            <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-800 truncate">
              {clinic.tradeName || organization.name}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-slate-400">
              {branchName ? `${branchName} · ` : ''}
              {scopeDescription}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {connectionState !== 'connected' && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold"
              >
                <WifiOff className="w-3.5 h-3.5" />
                <span>
                  {connectionState === 'offline'
                    ? 'Sem conexão · Aguardando rede'
                    : 'Reconectando em tempo real...'}
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={() => void handleToggleAudioUnlockOrMute()}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                soundActive
                  ? 'border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
              title={
                !audioUnlocked
                  ? 'Clique para garantir áudio e voz liberados neste navegador'
                  : isLocalMuted
                  ? 'Som silenciado nesta tela'
                  : 'Som e voz ativos'
              }
            >
              {soundActive ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
              <span>
                {!audioUnlocked && soundActive
                  ? 'Ativar Voz'
                  : soundActive
                  ? 'Som Ativo'
                  : 'Mudo'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 transition"
              title={isFullscreen ? 'Sair da Tela Cheia' : 'Abrir em Tela Cheia'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
              <span>{isFullscreen ? 'Sair Tela Cheia' : 'Tela Cheia'}</span>
            </button>
          </div>
        </div>

        {/* Bloco Central — Chamado / Em Atendimento / Aguardando */}
        <div className="flex-1 flex flex-col justify-center py-6 sm:py-8 min-h-0">
          {isInitialLoading ? (
            <div className="flex items-center gap-3 text-slate-500 text-base font-semibold">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span>Sincronizando painel de atendimento...</span>
            </div>
          ) : displayedCall ? (
            <div className="space-y-6 xl:space-y-8">
              {/* Indicador Verde Claro/Escuro de Estado */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2.5 text-sm sm:text-base xl:text-lg font-black uppercase tracking-[0.12em] text-emerald-700">
                  <span className="w-3.5 h-3.5 rounded-xs bg-emerald-600 shrink-0" />
                  <span>
                    {isCalledState ? 'CHAMANDO PACIENTE' : 'EM ATENDIMENTO'}
                  </span>
                </span>
                {isCalledState && displayedCall.callCount > 1 && (
                  <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900">
                    Rechamada #{displayedCall.callCount}
                  </span>
                )}
              </div>

              {/* Nome do Paciente em destaque absoluto */}
              <h1
                data-testid="display-active-patient-name"
                className="text-[clamp(2.5rem,5.4vw,5.75rem)] font-black tracking-tight text-slate-950 leading-[1.06] break-words"
              >
                {formatCallPanelPatientName(
                  displayedCall.patientName,
                  effectiveNameMode
                )}
              </h1>

              {/* Médico, Sala/Consultório e Horário/Temporizador */}
              <div className="pt-6 xl:pt-8 border-t border-slate-200 flex flex-wrap items-center justify-between gap-6">
                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  <div>
                    <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">
                      Profissional
                    </p>
                    <p className="text-[clamp(1.25rem,2.1vw,2.25rem)] font-extrabold text-slate-800 leading-tight mt-0.5">
                      {displayedPhysicianName}
                    </p>
                  </div>

                  <div className="bg-emerald-600 text-white px-5 py-3 xl:px-7 xl:py-3.5 rounded-xl">
                    <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-emerald-100">
                      Dirigir-se para
                    </p>
                    <p
                      data-testid="display-active-room-name"
                      className="text-[clamp(1.35rem,2.3vw,2.45rem)] font-black leading-tight mt-0.5"
                    >
                      {displayedCall.roomName || matchedRoom?.name || 'Consultório 01'}
                    </p>
                  </div>
                </div>

                {/* Horário de início / chamada e temporizador */}
                <div className="text-left sm:text-right">
                  {isInProgressState ? (
                    <>
                      <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">
                        Iniciado às {formatTimeSaoPaulo(displayedCall.startedAt)}
                      </p>
                      <p className="text-[clamp(1.5rem,2.5vw,2.75rem)] font-black font-mono tabular-nums text-emerald-700 mt-0.5">
                        {formatElapsedHms(displayedCall.startedAt, nowMs)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">
                        Chamado às {formatTimeSaoPaulo(displayedCall.calledAt)}
                      </p>
                      <p className="text-[clamp(1.35rem,2.2vw,2.35rem)] font-black font-mono tabular-nums text-emerald-700 mt-0.5">
                        {formatCountdownMmSs(calledRemainingSec)}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-4xl">
              <div className="inline-flex items-center gap-2.5 text-sm sm:text-base font-extrabold uppercase tracking-[0.14em] text-emerald-700">
                <span className="w-3 h-3 rounded-xs bg-emerald-600" />
                <span>PAINEL DE CHAMADA ATIVO</span>
              </div>
              <h1
                data-testid="display-idle-heading"
                className="text-[clamp(2.25rem,4.4vw,4.5rem)] font-black tracking-tight text-slate-800 leading-[1.08]"
              >
                AGUARDANDO PRÓXIMA CHAMADA
              </h1>
              <p className="text-base sm:text-xl font-medium text-slate-500">
                {scopeDescription}
                {matchedRoom ? ` · ${matchedRoom.name}` : ''}
              </p>
            </div>
          )}
        </div>

        {/* Avisos operacionais ocasionais (erro de carga ou dica F11) */}
        {(loadError || fullscreenHint) && (
          <div className="pt-2 flex flex-wrap items-center gap-3">
            {fullscreenHint && (
              <p className="text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
                {fullscreenHint}
              </p>
            )}
            {loadError && (
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{loadError}</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* COLUNA LATERAL (25%) — Verde Institucional Suave */}
      <aside className="w-full lg:w-[25%] lg:h-full bg-[#ECFDF5] border-t lg:border-t-0 lg:border-l border-emerald-200/80 px-6 py-6 xl:px-8 xl:py-8 flex flex-col justify-between gap-6">
        <div className="space-y-6 xl:space-y-8">
          {/* BLOCO 1 — ÚLTIMO PACIENTE ATENDIDO (Identificação Vermelha) */}
          <section aria-label="Último Paciente Atendido" className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-xs bg-rose-600 shrink-0" />
              <h2 className="text-xs xl:text-sm font-black uppercase tracking-[0.1em] text-rose-700">
                ÚLTIMO PACIENTE ATENDIDO
              </h2>
            </div>

            {snapshot.lastCompleted ? (
              <div className="space-y-1.5">
                <p
                  data-testid="display-last-patient-name"
                  className="text-xl xl:text-2xl 2xl:text-[1.75rem] font-black text-slate-900 leading-snug break-words"
                >
                  {formatCallPanelPatientName(
                    snapshot.lastCompleted.patientName,
                    effectiveNameMode
                  )}
                </p>
                <p className="text-xs xl:text-sm font-bold text-slate-700">
                  {snapshot.lastCompleted.professionalName}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs xl:text-sm font-semibold text-slate-600">
                  <span>{snapshot.lastCompleted.roomName}</span>
                  {snapshot.lastCompleted.endedAt && (
                    <span className="font-mono tabular-nums font-bold text-rose-700">
                      {formatTimeSaoPaulo(snapshot.lastCompleted.endedAt)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-500">
                Nenhum atendimento concluído hoje.
              </p>
            )}
          </section>

          <div className="border-t border-emerald-200/90" />

          {/* BLOCO 2 — PRÓXIMO PACIENTE NA FILA (Identificação Amarela) */}
          <section aria-label="Próximo Paciente na Fila" className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-xs bg-amber-500 shrink-0" />
              <h2 className="text-xs xl:text-sm font-black uppercase tracking-[0.1em] text-amber-800">
                PRÓXIMO PACIENTE NA FILA
              </h2>
            </div>

            {snapshot.nextPatient ? (
              <div className="space-y-1.5">
                <p
                  data-testid="display-next-patient-name"
                  className="text-xl xl:text-2xl 2xl:text-[1.75rem] font-black text-slate-900 leading-snug break-words"
                >
                  {formatCallPanelPatientName(
                    snapshot.nextPatient.patientName,
                    effectiveNameMode
                  )}
                </p>
                <p className="text-xs xl:text-sm font-bold text-slate-700">
                  {snapshot.nextPatient.professionalName}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs xl:text-sm font-semibold text-slate-600">
                  <span>
                    {snapshot.nextPatient.roomName ||
                      matchedRoom?.name ||
                      'Consultório 01'}
                  </span>
                  <span className="font-mono tabular-nums font-bold text-amber-800">
                    {formatTimeSaoPaulo(snapshot.nextPatient.startTime)}
                  </span>
                </div>
                {snapshot.waitingCount > 1 && (
                  <p className="text-xs font-semibold text-emerald-800 pt-1">
                    + {snapshot.waitingCount - 1}{' '}
                    {snapshot.waitingCount - 1 === 1
                      ? 'paciente aguardando'
                      : 'pacientes aguardando'}
                  </p>
                )}
              </div>
            ) : (
              <p
                data-testid="display-empty-next-queue"
                className="text-sm xl:text-base font-semibold text-slate-600"
              >
                Não há pacientes aguardando.
              </p>
            )}
          </section>
        </div>

        {/* Data e hora atual integradas discretamente na composição */}
        <div className="pt-4 border-t border-emerald-200/90 space-y-0.5">
          <p className="text-xs xl:text-sm font-semibold text-emerald-900/75 capitalize">
            {formatFullDateSaoPaulo(new Date(nowMs))}
          </p>
          <p className="text-2xl xl:text-3xl font-black font-mono tabular-nums text-slate-900">
            {formatTimeWithSecondsSaoPaulo(new Date(nowMs))}
          </p>
        </div>
      </aside>
    </div>
  );
};
