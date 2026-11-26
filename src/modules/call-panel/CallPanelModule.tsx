import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  DoorClosed,
  ExternalLink,
  History,
  Loader2,
  Maximize2,
  Megaphone,
  Minimize2,
  Monitor,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Stethoscope,
  Users,
  Volume2,
  VolumeX,
  XCircle,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { StorageService } from '../../services/storage';
import { getSupabase } from '../../services/supabaseClient';
import { DomainResolver } from '../../services/domainResolver';
import {
  AttendanceCloudService,
  ensureSupabaseRealtimeAuth,
  getCallPanelRealtimeBroadcastTopic,
  getDefaultCallPanelSettings,
} from '../../services/attendanceCloudService';
import {
  AUTO_CLOSE_CONFIRMATION_MESSAGE,
  buildAttendanceDisplayUrl,
  buildPatientVoiceAnnouncementText,
  formatCallPanelPatientName,
  formatCountdownMmSs,
  formatDurationHuman,
  formatElapsedHms,
  formatFullDateSaoPaulo,
  formatTimeSaoPaulo,
  formatTimeWithSecondsSaoPaulo,
  getAttendanceCallEventKey,
  getAutoStartRemainingSeconds,
  hasAutoStartElapsed,
  resolvePhysicianPanelSnapshot,
} from '../../services/attendanceQueueUtils';
import {
  triggerPatientCallAlert,
  unlockCallAudioContext,
} from '../../services/callAudioService';
import {
  Appointment,
  AttendanceCallEvent,
  AttendanceCallRecord,
  CallPanelSettings,
} from '../../types';
import { CallPanelSettingsModal } from './CallPanelSettingsModal';
import { AttendanceHistoryTable } from './AttendanceHistoryTable';

interface PendingConfirmModalState {
  type: 'auto_close_before_call' | 'recall' | 'complete' | 'cancel_call';
  title: string;
  message: string;
  confirmLabel: string;
  appointmentId?: string | null;
  attendanceCallId?: string;
}

export const CallPanelModule: React.FC = () => {
  const { activeBranchId, branches, organization, clinic } = useTenant();
  const { currentUser, canCreateInMenu, canEditInMenu, canAdminMenu } = useAuth();

  const canOperatePanel =
    canCreateInMenu('call_panel') ||
    canEditInMenu('call_panel') ||
    canAdminMenu('call_panel');
  const canEditSettings = canEditInMenu('call_panel') || canAdminMenu('call_panel');

  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const autoStartInFlightKeyRef = useRef<string | null>(null);
  const lastAnnouncedEventKeyRef = useRef<string | null>(null);

  const professionals = useMemo(
    () => StorageService.getProfessionals().filter((p) => p.isActive !== false),
    []
  );
  const allRooms = useMemo(
    () => StorageService.getRooms().filter((r) => r.isActive !== false),
    []
  );

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calls, setCalls] = useState<AttendanceCallRecord[]>([]);
  const [events, setEvents] = useState<AttendanceCallEvent[]>([]);
  const [settings, setSettings] = useState<CallPanelSettings>(() =>
    getDefaultCallPanelSettings(organization.id, activeBranchId)
  );

  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string>(() => {
    const matchedUserProf = professionals.find((p) => p.userProfileId === currentUser.id);
    return matchedUserProf?.id || professionals[0]?.id || '';
  });
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [statusFeedback, setStatusFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [pulseActive, setPulseActive] = useState(false);
  const [isTvDisplayMode, setIsTvDisplayMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<'queue' | 'history'>('queue');
  const [confirmModal, setConfirmModal] = useState<PendingConfirmModalState | null>(null);
  const [displayTargetScope, setDisplayTargetScope] = useState<
    'selected' | 'selected_room' | 'room' | 'all'
  >('selected');
  const [popupBlockedUrl, setPopupBlockedUrl] = useState('');

  const availableRooms = useMemo(() => {
    if (activeBranchId && activeBranchId !== 'all') {
      return allRooms.filter((r) => r.branchId === activeBranchId);
    }
    return allRooms;
  }, [allRooms, activeBranchId]);

  const loadAllPanelData = useCallback(async () => {
    setLoadError('');
    try {
      const [aptRes, cloudRes] = await Promise.all([
        StorageService.fetchAppointmentsFromCloudDetailed(),
        AttendanceCloudService.fetchCallPanelSnapshot(organization.id, activeBranchId),
      ]);

      setAppointments(aptRes.appointments);
      setCalls(cloudRes.calls);
      setEvents(cloudRes.events);
      if (cloudRes.settings) {
        setSettings(cloudRes.settings);
      }

      const errs: string[] = [];
      if (aptRes.error) errs.push(`Agenda: ${aptRes.error}`);
      if (cloudRes.error) errs.push(cloudRes.error);
      if (errs.length > 0) {
        setLoadError(errs.join(' · '));
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Erro ao sincronizar dados do painel de chamada.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [organization.id, activeBranchId]);

  useEffect(() => {
    setIsLoading(true);
    void loadAllPanelData();
  }, [loadAllPanelData]);

  // Apply defaults from persisted call_panel_settings when loaded
  useEffect(() => {
    if (
      settings.defaultProfessionalId &&
      professionals.some((p) => p.id === settings.defaultProfessionalId)
    ) {
      setSelectedProfessionalId((prev) => prev || settings.defaultProfessionalId || '');
    } else if (!selectedProfessionalId && professionals[0]?.id) {
      setSelectedProfessionalId(professionals[0].id);
    }
  }, [settings.defaultProfessionalId, professionals, selectedProfessionalId]);

  useEffect(() => {
    if (settings.defaultRoomId && availableRooms.some((r) => r.id === settings.defaultRoomId)) {
      setSelectedRoomId((prev) => prev || settings.defaultRoomId || '');
    } else if (
      (!selectedRoomId || !availableRooms.some((r) => r.id === selectedRoomId)) &&
      availableRooms[0]?.id
    ) {
      setSelectedRoomId(availableRooms[0].id);
    }
  }, [settings.defaultRoomId, availableRooms, selectedRoomId]);

  // 1-second timer tick for live clock, elapsed consultation timer, and DB-timestamp auto-start check
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Supabase Realtime (with JWT auth) + controlled 15s fallback sync
  useEffect(() => {
    const supabase = getSupabase();
    const fallbackTimer = window.setInterval(() => {
      void loadAllPanelData();
    }, 15000);

    if (!supabase || !organization.id) {
      return () => window.clearInterval(fallbackTimer);
    }

    let cancelled = false;
    let dbChannel: ReturnType<typeof supabase.channel> | null = null;
    let broadcastChannel: ReturnType<typeof supabase.channel> | null = null;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    void ensureSupabaseRealtimeAuth().then(() => {
      if (cancelled) return;
      dbChannel = supabase
        .channel(`call-panel-${organization.id}-${activeBranchId || 'all'}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'attendance_calls',
            filter: `organization_id=eq.${organization.id}`,
          },
          () => {
            void loadAllPanelData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'attendance_call_events',
            filter: `organization_id=eq.${organization.id}`,
          },
          () => {
            void loadAllPanelData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'appointments',
            filter: `organization_id=eq.${organization.id}`,
          },
          () => {
            void loadAllPanelData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'call_panel_settings',
            filter: `organization_id=eq.${organization.id}`,
          },
          () => {
            void loadAllPanelData();
          }
        )
        .subscribe();

      broadcastChannel = supabase
        .channel(getCallPanelRealtimeBroadcastTopic(organization.id))
        .on('broadcast', { event: 'attendance_updated' }, () => {
          void loadAllPanelData();
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      window.clearInterval(fallbackTimer);
      authListener.subscription.unsubscribe();
      if (dbChannel) void supabase.removeChannel(dbChannel);
      if (broadcastChannel) void supabase.removeChannel(broadcastChannel);
    };
  }, [organization.id, activeBranchId, loadAllPanelData]);

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const snapshot = useMemo(
    () =>
      resolvePhysicianPanelSnapshot(appointments, calls, {
        organizationId: organization.id,
        branchId: activeBranchId,
        professionalId: selectedProfessionalId,
      }),
    [appointments, calls, organization.id, activeBranchId, selectedProfessionalId]
  );

  const selectedProfessional = useMemo(
    () => professionals.find((p) => p.id === selectedProfessionalId) || null,
    [professionals, selectedProfessionalId]
  );

  const selectedRoom = useMemo(
    () => availableRooms.find((r) => r.id === selectedRoomId) || availableRooms[0] || null,
    [availableRooms, selectedRoomId]
  );

  const physicianDisplayName = useMemo(() => {
    if (
      settings.physicianDisplayLabel &&
      (!settings.defaultProfessionalId ||
        settings.defaultProfessionalId === selectedProfessionalId)
    ) {
      return settings.physicianDisplayLabel;
    }
    return selectedProfessional?.fullName || 'Selecione o Médico';
  }, [settings, selectedProfessionalId, selectedProfessional]);

  // Finite 4-second highlight pulse + sound/voice on new incoming calledAt across synchronized TV screens
  useEffect(() => {
    const activeCalled = snapshot.activeCalled;
    if (!activeCalled || !activeCalled.calledAt) return;

    const eventKey = getAttendanceCallEventKey(activeCalled);
    if (!eventKey) return;
    if (lastAnnouncedEventKeyRef.current === null) {
      // Initial hydration on page open: record key without blasting audio unexpectedly
      lastAnnouncedEventKeyRef.current = eventKey;
      return;
    }
    if (lastAnnouncedEventKeyRef.current === eventKey) return;

    lastAnnouncedEventKeyRef.current = eventKey;
    setPulseActive(true);
    const pulseTimer = window.setTimeout(() => setPulseActive(false), 4000);

    const speechText = buildPatientVoiceAnnouncementText({
      patientName: formatCallPanelPatientName(
        activeCalled.patientName,
        settings.patientNameDisplayMode
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

    return () => window.clearTimeout(pulseTimer);
  }, [
    snapshot.activeCalled,
    settings.patientNameDisplayMode,
    settings.soundEnabled,
    settings.voiceEnabled,
    settings.chimeVolume,
  ]);

  // Automatic start driven by persisted DB timestamp (calledAt + autoStartDelaySeconds)
  useEffect(() => {
    const called = snapshot.activeCalled;
    if (!canOperatePanel || !called || isSubmitting) return;
    if (!hasAutoStartElapsed(called, nowMs)) return;

    const key = `${called.id}:${called.calledAt}`;
    if (autoStartInFlightKeyRef.current === key) return;
    autoStartInFlightKeyRef.current = key;

    void (async () => {
      const res = await AttendanceCloudService.startAttendanceRpc(called.id, 'automatic');
      if (res.success) {
        setStatusFeedback(
          `Atendimento de ${called.patientName} iniciado automaticamente após ${called.autoStartDelaySeconds}s.`
        );
        await loadAllPanelData();
      } else if (res.code !== 'AUTO_START_NOT_DUE') {
        autoStartInFlightKeyRef.current = null;
      }
    })();
  }, [snapshot.activeCalled, nowMs, canOperatePanel, isSubmitting, loadAllPanelData]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (panelRootRef.current?.requestFullscreen) {
        await panelRootRef.current.requestFullscreen();
      } else {
        setIsTvDisplayMode((prev) => !prev);
      }
    } catch {
      setIsTvDisplayMode((prev) => !prev);
    }
  };

  const handleOpenPublicDisplay = () => {
    setPopupBlockedUrl('');
    const targetProfId =
      displayTargetScope === 'all' || displayTargetScope === 'room'
        ? 'all'
        : selectedProfessionalId || 'all';
    const targetRoomId =
      displayTargetScope === 'selected_room' || displayTargetScope === 'room'
        ? selectedRoom?.id || 'all'
        : 'all';
    const simDomain = DomainResolver.isSimulationAllowed()
      ? DomainResolver.getSimulatedDomain()
      : null;

    const url = buildAttendanceDisplayUrl(
      {
        organizationId: organization.id,
        branchId: activeBranchId,
        professionalId: targetProfId,
        roomId: targetRoomId,
        nameMode: settings.patientNameDisplayMode,
        simulatedDomain: simDomain,
      },
      import.meta.env.BASE_URL || '/'
    );

    const opened = window.open(url, '_blank');
    if (opened) {
      opened.opener = null;
      setStatusFeedback('Painel de exibição aberto em nova aba do navegador.');
    } else {
      setPopupBlockedUrl(url);
    }
  };

  const toggleQuickSound = async () => {
    await unlockCallAudioContext();
    const updated: CallPanelSettings = {
      ...settings,
      soundEnabled: !settings.soundEnabled,
    };
    setSettings(updated);
    if (canEditSettings) {
      const res = await AttendanceCloudService.saveCallPanelSettings(updated);
      if (res.success && res.settings) setSettings(res.settings);
    }
  };

  const executeCallPatient = async (params: {
    appointmentId?: string | null;
    confirmAutoClose?: boolean;
    allowRecall?: boolean;
  }) => {
    await unlockCallAudioContext();
    setActionError('');
    setStatusFeedback('');
    setIsSubmitting(true);

    const targetApt = params.appointmentId
      ? appointments.find((a) => a.id === params.appointmentId)
      : snapshot.nextPatient;
    const targetBranch =
      activeBranchId !== 'all'
        ? activeBranchId
        : targetApt?.branchId || branches[0]?.id || null;

    const compatibleRoom =
      selectedRoom && (!targetBranch || selectedRoom.branchId === targetBranch)
        ? selectedRoom.id
        : null;

    const res = await AttendanceCloudService.callPatientRpc({
      organizationId: organization.id,
      branchId: targetBranch,
      professionalId: selectedProfessionalId || targetApt?.professionalId || null,
      roomId: compatibleRoom,
      appointmentId: params.appointmentId ?? null,
      confirmAutoClose: params.confirmAutoClose,
      allowRecall: params.allowRecall,
    });

    setIsSubmitting(false);

    if (!res.success) {
      if (res.code === 'ACTIVE_CONSULTATION_EXISTS') {
        setConfirmModal({
          type: 'auto_close_before_call',
          title: 'Atendimento em andamento detectado',
          message: AUTO_CLOSE_CONFIRMATION_MESSAGE,
          confirmLabel: 'Encerrar Atual e Chamar Próximo',
          appointmentId: params.appointmentId ?? null,
        });
        return;
      }
      if (res.code === 'ALREADY_CALLED_SAME_PATIENT' && res.attendance) {
        setConfirmModal({
          type: 'recall',
          title: 'Chamar Paciente Novamente?',
          message: `O paciente ${res.attendance.patientName} já está sendo chamado na ${res.attendance.roomName}. Deseja repetir a chamada sonora e visual?`,
          confirmLabel: 'Chamar Novamente',
          appointmentId: res.attendance.appointmentId,
        });
        return;
      }
      setActionError(res.error || 'Não foi possível chamar o paciente.');
      return;
    }

    if (res.attendance) {
      const eventKey = `${res.attendance.id}:${res.attendance.calledAt}:${res.attendance.callCount}`;
      lastAnnouncedEventKeyRef.current = eventKey;
      setPulseActive(true);
      window.setTimeout(() => setPulseActive(false), 4000);

      void triggerPatientCallAlert({
        soundEnabled: settings.soundEnabled,
        voiceEnabled: settings.voiceEnabled,
        chimeVolume: settings.chimeVolume,
        speechText: buildPatientVoiceAnnouncementText({
          patientName: formatCallPanelPatientName(
            res.attendance.patientName,
            settings.patientNameDisplayMode
          ),
          roomName: res.attendance.roomName,
          professionalName: res.attendance.professionalName,
        }),
      });

      setStatusFeedback(
        res.autoClosedAttendance
          ? `Atendimento anterior de ${res.autoClosedAttendance.patientName} encerrado e chamada realizada para ${res.attendance.patientName}.`
          : res.eventType === 'recalled'
          ? `Nova chamada realizada para ${res.attendance.patientName} (${res.attendance.roomName}).`
          : `Paciente ${res.attendance.patientName} chamado para ${res.attendance.roomName}.`
      );
    }

    await loadAllPanelData();
  };

  const handleClickCallNext = () => {
    if (!canOperatePanel) return;
    if (snapshot.activeInProgress) {
      setConfirmModal({
        type: 'auto_close_before_call',
        title: 'Atendimento em andamento detectado',
        message: AUTO_CLOSE_CONFIRMATION_MESSAGE,
        confirmLabel: 'Encerrar Atual e Chamar Próximo',
        appointmentId: null,
      });
      return;
    }
    void executeCallPatient({ appointmentId: null });
  };

  const handleClickCallSpecific = (appointmentId: string) => {
    if (!canOperatePanel) return;
    if (snapshot.activeInProgress) {
      setConfirmModal({
        type: 'auto_close_before_call',
        title: 'Atendimento em andamento detectado',
        message: AUTO_CLOSE_CONFIRMATION_MESSAGE,
        confirmLabel: 'Encerrar Atual e Chamar Paciente',
        appointmentId,
      });
      return;
    }
    void executeCallPatient({ appointmentId });
  };

  const handleClickRecall = () => {
    if (!canOperatePanel || !snapshot.activeCalled) return;
    setConfirmModal({
      type: 'recall',
      title: 'Chamar Paciente Novamente?',
      message: `Confirmar nova chamada de ${snapshot.activeCalled.patientName} para ${snapshot.activeCalled.roomName}?`,
      confirmLabel: 'Chamar Novamente',
      appointmentId: snapshot.activeCalled.appointmentId,
    });
  };

  const handleManualStart = async () => {
    if (!canOperatePanel || !snapshot.activeCalled) return;
    await unlockCallAudioContext();
    setActionError('');
    setStatusFeedback('');
    setIsSubmitting(true);

    const res = await AttendanceCloudService.startAttendanceRpc(
      snapshot.activeCalled.id,
      'manual'
    );
    setIsSubmitting(false);

    if (!res.success) {
      setActionError(res.error || 'Não foi possível iniciar o atendimento.');
      return;
    }

    setStatusFeedback(
      `Atendimento de ${snapshot.activeCalled.patientName} iniciado manualmente.`
    );
    await loadAllPanelData();
  };

  const handleRequestComplete = () => {
    if (!canOperatePanel || !snapshot.activeInProgress) return;
    setConfirmModal({
      type: 'complete',
      title: 'Concluir Atendimento',
      message: `Confirmar conclusão do atendimento de ${snapshot.activeInProgress.patientName} (${snapshot.activeInProgress.roomName})? A duração final será gravada no servidor.`,
      confirmLabel: 'Concluir Atendimento',
      attendanceCallId: snapshot.activeInProgress.id,
    });
  };

  const handleRequestCancelCall = () => {
    if (!canOperatePanel || !snapshot.activeCalled) return;
    setConfirmModal({
      type: 'cancel_call',
      title: 'Cancelar Chamada Ativa',
      message: `Deseja cancelar a chamada de ${snapshot.activeCalled.patientName}? O agendamento permanecerá preservado na agenda.`,
      confirmLabel: 'Confirmar Cancelamento',
      attendanceCallId: snapshot.activeCalled.id,
    });
  };

  const handleConfirmModalAction = async () => {
    if (!confirmModal) return;
    const modal = confirmModal;
    setConfirmModal(null);

    if (modal.type === 'auto_close_before_call') {
      await executeCallPatient({
        appointmentId: modal.appointmentId ?? null,
        confirmAutoClose: true,
      });
      return;
    }

    if (modal.type === 'recall') {
      await executeCallPatient({
        appointmentId: modal.appointmentId ?? null,
        allowRecall: true,
      });
      return;
    }

    if (modal.type === 'complete' && modal.attendanceCallId) {
      setIsSubmitting(true);
      setActionError('');
      const res = await AttendanceCloudService.completeAttendanceRpc(modal.attendanceCallId);
      setIsSubmitting(false);
      if (!res.success) {
        setActionError(res.error || 'Não foi possível concluir o atendimento.');
        return;
      }
      setStatusFeedback(
        `Atendimento concluído · Duração registrada: ${formatDurationHuman(
          res.attendance?.durationSeconds
        )}.`
      );
      await loadAllPanelData();
      return;
    }

    if (modal.type === 'cancel_call' && modal.attendanceCallId) {
      setIsSubmitting(true);
      setActionError('');
      const res = await AttendanceCloudService.cancelAttendanceRpc(
        modal.attendanceCallId,
        'Chamada cancelada pelo operador no painel.'
      );
      setIsSubmitting(false);
      if (!res.success) {
        setActionError(res.error || 'Não foi possível cancelar a chamada.');
        return;
      }
      autoStartInFlightKeyRef.current = null;
      setStatusFeedback('Chamada cancelada com segurança. Agendamento preservado.');
      await loadAllPanelData();
    }
  };

  const activeCalledRemainingSeconds = snapshot.activeCalled
    ? getAutoStartRemainingSeconds(
        snapshot.activeCalled.calledAt,
        snapshot.activeCalled.autoStartDelaySeconds,
        nowMs
      )
    : 0;

  const activeBranchName =
    activeBranchId === 'all'
      ? clinic.tradeName || 'Todas as Unidades'
      : branches.find((b) => b.id === activeBranchId)?.name || clinic.tradeName;

  return (
    <div
      ref={panelRootRef}
      className={`space-y-4 ${
        isFullscreen || isTvDisplayMode
          ? 'fixed inset-0 z-40 bg-slate-50 p-5 sm:p-6 overflow-y-auto'
          : ''
      }`}
    >
      {/* ÁREA D — Barra Superior de Informações Operacionais e Controles */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900">
                  Painel de Chamada & Atendimentos
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold">
                  {activeBranchName}
                </span>
              </div>
              <p className="text-xs text-slate-500 capitalize">
                {formatFullDateSaoPaulo(new Date(nowMs))}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white rounded-xl font-mono text-base sm:text-lg font-extrabold tabular-nums">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span>{formatTimeWithSecondsSaoPaulo(new Date(nowMs))}</span>
          </div>

          <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-800 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-amber-600" />
            <span>
              {snapshot.waitingCount}{' '}
              {snapshot.waitingCount === 1 ? 'paciente na fila' : 'pacientes na fila'}
            </span>
          </div>
        </div>

        {/* Seletores e Controles */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
            <Stethoscope className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            <select
              aria-label="Selecionar médico do painel"
              value={selectedProfessionalId}
              onChange={(e) => setSelectedProfessionalId(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none"
            >
              {professionals.length === 0 ? (
                <option value="">Nenhum médico ativo</option>
              ) : (
                professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
            <DoorClosed className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            <select
              aria-label="Selecionar sala de atendimento"
              value={selectedRoom?.id || ''}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none"
            >
              {availableRooms.length === 0 ? (
                <option value="">Consultório 01</option>
              ) : (
                availableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void toggleQuickSound()}
            title={settings.soundEnabled ? 'Som ativo (clique para silenciar)' : 'Som silenciado'}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition ${
              settings.soundEnabled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {settings.soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{settings.soundEnabled ? 'Som On' : 'Mudo'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsTvDisplayMode((prev) => !prev)}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition ${
              isTvDisplayMode
                ? 'bg-sky-600 border-sky-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
            title="Alternar modo simplificado para TV da recepção"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isTvDisplayMode ? 'Modo Operador' : 'Modo TV'}</span>
          </button>

          <div className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50/70 p-0.5">
            <select
              aria-label="Escopo da tela de exibição"
              value={displayTargetScope}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'all' || v === 'selected_room' || v === 'room' || v === 'selected') {
                  setDisplayTargetScope(v);
                }
              }}
              className="text-[11px] font-semibold text-emerald-900 bg-transparent px-2 py-1.5 focus:outline-none"
            >
              <option value="selected">TV: Médico atual</option>
              <option value="selected_room">TV: Médico + Sala atual</option>
              <option value="room">TV: Apenas Sala atual</option>
              <option value="all">TV: Recepção geral</option>
            </select>
            <button
              type="button"
              onClick={handleOpenPublicDisplay}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold tracking-wide inline-flex items-center gap-1.5 shadow-2xs transition"
              title="Abrir painel limpo de chamada em nova página para TV ou monitor da recepção"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>ABRIR PAINEL DE EXIBIÇÃO</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition"
            title="Tela Cheia"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{isFullscreen ? 'Sair Tela Cheia' : 'Tela Cheia'}</span>
          </button>

          {canEditSettings && (
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition"
              title="Configurações do Painel"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Configurações</span>
            </button>
          )}

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void loadAllPanelData()}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition"
            title="Sincronizar agora"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Feedback & Erros Reais */}
      {(loadError || actionError) && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError || loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActionError('');
              void loadAllPanelData();
            }}
            className="px-2.5 py-1 bg-white border border-rose-200 rounded-lg font-semibold hover:bg-rose-100 shrink-0"
          >
            Atualizar
          </button>
        </div>
      )}

      {statusFeedback && !actionError && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusFeedback('')}
            className="text-emerald-700 hover:text-emerald-900 font-bold"
          >
            Fechar
          </button>
        </div>
      )}

      {popupBlockedUrl && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              O navegador bloqueou a abertura automática da nova guia. Permita pop-ups para este site ou abra diretamente pelo botão ao lado.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={popupBlockedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPopupBlockedUrl('')}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir Painel Agora</span>
            </a>
            <button
              type="button"
              onClick={() => setPopupBlockedUrl('')}
              className="px-2 py-1 text-amber-800 hover:text-amber-950 font-semibold"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* LAYOUT ESTRUTURADO DO PAINEL (ÁREA A + ÁREAS B & C) */}
      <div className="grid grid-cols-1 gap-4">
        {/* ÁREA A — Destaque Principal Verde (CHAMADO ou EM ATENDIMENTO) */}
        <div
          className={`rounded-3xl border-2 p-6 sm:p-8 shadow-sm transition-all duration-300 ${
            snapshot.activeCalled
              ? `border-emerald-500 bg-emerald-50/85 ${
                  pulseActive ? 'ring-4 ring-emerald-400/50 animate-pulse motion-reduce:animate-none' : ''
                }`
              : snapshot.activeInProgress
              ? 'border-emerald-600 bg-emerald-50/75'
              : 'border-slate-200 bg-white'
          }`}
        >
          {isLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span>Carregando painel em tempo real...</span>
            </div>
          ) : snapshot.activeCalled ? (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-3 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-extrabold uppercase tracking-wider">
                    <Bell className="w-3.5 h-3.5" />
                    <span>PACIENTE CHAMADO</span>
                  </span>
                  {snapshot.activeCalled.callCount > 1 && (
                    <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 text-xs font-bold border border-amber-200">
                      Rechamada #{snapshot.activeCalled.callCount}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-emerald-800">
                    Chamado às {formatTimeSaoPaulo(snapshot.activeCalled.calledAt)}
                  </span>
                </div>

                <h2 className="text-3xl sm:text-5xl xl:text-6xl font-black tracking-tight text-slate-900 leading-tight break-words">
                  {formatCallPanelPatientName(
                    snapshot.activeCalled.patientName,
                    settings.patientNameDisplayMode
                  )}
                </h2>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:text-lg font-bold text-slate-700">
                  <span className="inline-flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-emerald-700" />
                    <span>{physicianDisplayName}</span>
                  </span>
                  <span className="inline-flex items-center gap-2 text-emerald-900 bg-white px-3.5 py-1 rounded-xl border border-emerald-200 shadow-2xs">
                    <DoorClosed className="w-5 h-5 text-emerald-700" />
                    <span>{snapshot.activeCalled.roomName}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-600">
                    {snapshot.activeCalled.procedureName}
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-emerald-200 p-5 sm:min-w-[280px] text-center shadow-xs space-y-1.5 shrink-0">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700">
                  Início Automático em
                </p>
                <p className="text-4xl sm:text-5xl font-black font-mono tabular-nums text-emerald-700">
                  {formatCountdownMmSs(activeCalledRemainingSeconds)}
                </p>
                <p className="text-[11px] text-slate-500">
                  Aguardando entrada ou clique manual em INICIAR
                </p>
              </div>
            </div>
          ) : snapshot.activeInProgress ? (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-3 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-700 text-white text-xs font-extrabold uppercase tracking-wider">
                    <Play className="w-3.5 h-3.5" />
                    <span>EM ATENDIMENTO</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-white text-emerald-900 text-xs font-bold border border-emerald-200">
                    {snapshot.activeInProgress.startOrigin === 'automatic'
                      ? 'Início Automático'
                      : 'Início Manual'}
                  </span>
                  <span className="text-xs font-semibold text-emerald-900">
                    Iniciado às {formatTimeSaoPaulo(snapshot.activeInProgress.startedAt)}
                  </span>
                </div>

                <h2 className="text-3xl sm:text-5xl xl:text-6xl font-black tracking-tight text-slate-900 leading-tight break-words">
                  {formatCallPanelPatientName(
                    snapshot.activeInProgress.patientName,
                    settings.patientNameDisplayMode
                  )}
                </h2>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:text-lg font-bold text-slate-700">
                  <span className="inline-flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-emerald-700" />
                    <span>{physicianDisplayName}</span>
                  </span>
                  <span className="inline-flex items-center gap-2 text-emerald-900 bg-white px-3.5 py-1 rounded-xl border border-emerald-200 shadow-2xs">
                    <DoorClosed className="w-5 h-5 text-emerald-700" />
                    <span>{snapshot.activeInProgress.roomName}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-600">
                    {snapshot.activeInProgress.procedureName}
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-2xl border-2 border-emerald-300 p-5 sm:min-w-[280px] text-center shadow-xs space-y-1.5 shrink-0">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700">
                  Tempo Decorrido da Consulta
                </p>
                <p className="text-4xl sm:text-5xl font-black font-mono tabular-nums text-slate-900">
                  {formatElapsedHms(snapshot.activeInProgress.startedAt, nowMs)}
                </p>
                <p className="text-[11px] text-slate-500">
                  Cronômetro sincronizado pelo horário do servidor
                </p>
              </div>
            </div>
          ) : (
            <div className="py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <span className="inline-block px-3 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-extrabold uppercase tracking-wider">
                  Consultório Disponível
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  Nenhum paciente chamado ou em atendimento no momento
                </h2>
                <p className="text-xs sm:text-sm text-slate-500">
                  {physicianDisplayName} · {selectedRoom?.name || 'Consultório 01'} ·{' '}
                  {snapshot.nextPatient
                    ? `Próximo na fila: ${snapshot.nextPatient.patientName}`
                    : 'Sem pacientes aguardando na fila de hoje'}
                </p>
              </div>
            </div>
          )}

          {/* BARRA DE AÇÕES OPERACIONAIS (CHAMAR e INICIAR estritamente separados) */}
          {!isTvDisplayMode && canOperatePanel && (
            <div className="mt-6 pt-5 border-t border-slate-200/80 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isSubmitting || snapshot.waitingCount === 0}
                onClick={handleClickCallNext}
                className="px-5 py-3 text-sm font-extrabold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition inline-flex items-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <Megaphone className="w-4 h-4" />
                <span>CHAMAR</span>
              </button>

              {snapshot.activeCalled && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleClickRecall}
                  className="px-4 py-3 text-sm font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition inline-flex items-center gap-2 disabled:opacity-45"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Chamar Novamente</span>
                </button>
              )}

              <button
                type="button"
                disabled={isSubmitting || !snapshot.activeCalled}
                onClick={() => void handleManualStart()}
                className="px-5 py-3 text-sm font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                <span>INICIAR</span>
              </button>

              {snapshot.activeInProgress && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleRequestComplete}
                  className="px-5 py-3 text-sm font-extrabold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition inline-flex items-center gap-2 disabled:opacity-45"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>CONCLUIR ATENDIMENTO</span>
                </button>
              )}

              {snapshot.activeCalled && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleRequestCancelCall}
                  className="px-4 py-3 text-sm font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition inline-flex items-center gap-2 disabled:opacity-45 ml-auto"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Cancelar Chamada</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ÁREAS B & C — Sempre visíveis lado a lado mesmo durante Área A ativa */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ÁREA B (Esquerda / Destaque Vermelho) — Último paciente atendido */}
          <div className="bg-white rounded-2xl border border-rose-200 border-l-8 border-l-rose-500 p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-extrabold uppercase tracking-wider">
                Último Paciente Atendido
              </span>
              {snapshot.lastCompleted?.endedAt && (
                <span className="text-xs font-mono font-bold text-rose-700">
                  Finalizado às {formatTimeSaoPaulo(snapshot.lastCompleted.endedAt)}
                </span>
              )}
            </div>

            {snapshot.lastCompleted ? (
              <div className="space-y-2">
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight break-words">
                  {formatCallPanelPatientName(
                    snapshot.lastCompleted.patientName,
                    settings.patientNameDisplayMode
                  )}
                </h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-semibold text-slate-600">
                  <span>{snapshot.lastCompleted.professionalName}</span>
                  <span>·</span>
                  <span>{snapshot.lastCompleted.roomName}</span>
                  <span>·</span>
                  <span className="text-rose-800 font-extrabold">
                    Duração: {formatDurationHuman(snapshot.lastCompleted.durationSeconds)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-3 text-sm text-slate-400 font-medium">
                Nenhum atendimento concluído registrado ainda para este médico.
              </div>
            )}
          </div>

          {/* ÁREA C (Direita / Destaque Amarelo) — Próximo paciente */}
          <div className="bg-white rounded-2xl border border-amber-200 border-l-8 border-l-amber-400 p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 text-[11px] font-extrabold uppercase tracking-wider">
                Próximo Paciente
              </span>
              {snapshot.nextPatient && (
                <span className="text-xs font-mono font-bold text-amber-800">
                  Agendado para {formatTimeSaoPaulo(snapshot.nextPatient.startTime)}
                </span>
              )}
            </div>

            {snapshot.nextPatient ? (
              <div className="space-y-2">
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight break-words">
                  {formatCallPanelPatientName(
                    snapshot.nextPatient.patientName,
                    settings.patientNameDisplayMode
                  )}
                </h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-semibold text-slate-600">
                  <span>{snapshot.nextPatient.professionalName}</span>
                  <span>·</span>
                  <span>
                    {snapshot.nextPatient.roomName || selectedRoom?.name || 'Consultório 01'}
                  </span>
                  <span>·</span>
                  <span className="text-amber-800 font-bold">
                    {snapshot.nextPatient.status === 'waiting_room'
                      ? 'Na Sala de Espera'
                      : snapshot.nextPatient.status === 'confirmed'
                      ? 'Confirmado'
                      : 'Agendado'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-3 text-sm text-slate-400 font-medium">
                Fila de espera vazia para este médico hoje.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FILA DE ATENDIMENTO E HISTÓRICO (Oculto no Modo TV para tela limpa na recepção) */}
      {!isTvDisplayMode && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              onClick={() => setActiveBottomTab('queue')}
              className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition ${
                activeBottomTab === 'queue'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Fila de Atendimento de Hoje ({snapshot.waitingCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveBottomTab('history')}
              className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition ${
                activeBottomTab === 'history'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Histórico de Chamadas & Atendimentos ({events.length})</span>
            </button>
          </div>

          {activeBottomTab === 'queue' ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Pacientes Elegíveis na Fila — {physicianDisplayName}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Prioridade automática: pacientes já na sala de espera primeiro, seguidos por agendamentos confirmados por horário.
                  </p>
                </div>
              </div>

              {snapshot.waitingQueue.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Nenhum paciente aguardando chamada para este médico na data de hoje.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {snapshot.waitingQueue.map((apt, idx) => (
                    <div
                      key={apt.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 font-extrabold text-xs flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 truncate">
                              {apt.patientName}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                apt.status === 'waiting_room'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : apt.status === 'confirmed'
                                  ? 'bg-sky-50 text-sky-700 border-sky-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {apt.status === 'waiting_room'
                                ? 'Sala de Espera'
                                : apt.status === 'confirmed'
                                ? 'Confirmado'
                                : 'Agendado'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Horário: <strong className="font-mono">{formatTimeSaoPaulo(apt.startTime)}</strong> ·{' '}
                            {apt.serviceName || 'Consulta Médica'} ·{' '}
                            {apt.roomName || selectedRoom?.name || 'Consultório 01'}
                          </p>
                        </div>
                      </div>

                      {canOperatePanel && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleClickCallSpecific(apt.id)}
                          className="px-3.5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                        >
                          <Megaphone className="w-3.5 h-3.5" />
                          <span>Chamar Paciente</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <AttendanceHistoryTable events={events} calls={calls} />
          )}
        </div>
      )}

      {/* Modal de Confirmação Obrigatória (Autoencerramento / Rechamada / Conclusão / Cancelamento) */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-xl shrink-0 ${
                  confirmModal.type === 'auto_close_before_call' || confirmModal.type === 'recall'
                    ? 'bg-amber-100 text-amber-700'
                    : confirmModal.type === 'cancel_call'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-slate-900">{confirmModal.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{confirmModal.message}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleConfirmModalAction()}
                className={`px-4 py-2 text-xs font-extrabold text-white rounded-xl shadow-xs transition ${
                  confirmModal.type === 'cancel_call'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-sky-600 hover:bg-sky-700'
                }`}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configurações do Painel */}
      <CallPanelSettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        professionals={professionals}
        rooms={availableRooms}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={(updated) => {
          setSettings(updated);
          if (updated.defaultProfessionalId) {
            setSelectedProfessionalId(updated.defaultProfessionalId);
          }
          if (updated.defaultRoomId) {
            setSelectedRoomId(updated.defaultRoomId);
          }
          setStatusFeedback('Configurações do painel salvas no Supabase.');
        }}
      />
    </div>
  );
};
