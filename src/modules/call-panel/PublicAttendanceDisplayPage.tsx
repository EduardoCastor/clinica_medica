import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Lock,
  Loader2,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { ClinicLoginScreen } from '../clinic/ClinicLoginScreen';
import { StorageService } from '../../services/storage';
import { getSupabase } from '../../services/supabaseClient';
import {
  AttendanceCloudService,
  CALL_PANEL_BROADCAST_CHANNEL_NAME,
  CallPanelSyncSignalPayload,
  ensureSupabaseRealtimeAuth,
  getCallPanelRealtimeBroadcastTopic,
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
  ensureSpeechVoicesListener,
  isCallAudioRunning,
  triggerPatientCallAlert,
  unlockAndTestCallAudio,
  unlockCallAudioContext,
} from '../../services/callAudioService';
import {
  CallPanelDiagEntry,
  getCallPanelDiagnostics,
  isCallPanelDebugEnabled,
  logCallPanelDiagnostic,
  subscribeCallPanelDiagnostics,
} from '../../services/callPanelDiagnostics';
import {
  Appointment,
  AttendanceCallEvent,
  AttendanceCallRecord,
  CallPanelSettings,
  PatientNameDisplayMode,
} from '../../types';

type RealtimeConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'unavailable';

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
    professionalId: (sp.get('professionalId') || '').trim(),
    roomId: (sp.get('roomId') || '').trim(),
    nameMode: validNameMode,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const debugModeEnabled = useMemo(() => isCallPanelDebugEnabled(), []);

  const displayRootRef = useRef<HTMLDivElement | null>(null);
  const hasHydratedRef = useRef(false);
  const announcedEventKeysRef = useRef<Set<string>>(new Set());
  const wasDisconnectedRef = useRef(false);
  const isFetchInFlightRef = useRef(false);
  const pendingRefetchRef = useRef(false);
  const refreshDebounceTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calls, setCalls] = useState<AttendanceCallRecord[]>([]);
  const [events, setEvents] = useState<AttendanceCallEvent[]>([]);
  const [settings, setSettings] = useState<CallPanelSettings>(() =>
    getDefaultCallPanelSettings(organization.id, queryParams.branchId)
  );
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    return getSupabase() ? 'connecting' : 'unavailable';
  });
  const [realtimeGeneration, setRealtimeGeneration] = useState(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenHint, setFullscreenHint] = useState('');

  const [audioActivated, setAudioActivated] = useState<boolean>(() => isCallAudioRunning());
  const [isLocalMuted, setIsLocalMuted] = useState(false);
  const [audioStatusError, setAudioStatusError] = useState('');
  const [audioHint, setAudioHint] = useState('');

  const [callHighlightActive, setCallHighlightActive] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagEntries, setDiagEntries] = useState<CallPanelDiagEntry[]>(() =>
    getCallPanelDiagnostics()
  );

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
  const resolvedRoomId = queryParams.roomId || 'all';

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

  // Keep speech voice listener registered early
  useEffect(() => {
    ensureSpeechVoicesListener();
  }, []);

  // Subscribe to technical diagnostic ring buffer in dev/debug mode
  useEffect(() => {
    if (!debugModeEnabled) return;
    setDiagEntries(getCallPanelDiagnostics());
    return subscribeCallPanelDiagnostics(() => {
      setDiagEntries(getCallPanelDiagnostics());
    });
  }, [debugModeEnabled]);

  const loadDisplayData = useCallback(
    async (triggerReason: string = 'manual') => {
      if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;

      if (isFetchInFlightRef.current) {
        pendingRefetchRef.current = true;
        return;
      }

      isFetchInFlightRef.current = true;
      setLoadError('');
      try {
        const [aptRes, cloudRes] = await Promise.all([
          StorageService.fetchAppointmentsFromCloudDetailed(),
          AttendanceCloudService.fetchCallPanelSnapshot(resolvedOrgId, resolvedBranchId),
        ]);

        setAppointments(aptRes.appointments);
        setCalls(cloudRes.calls);
        setEvents(cloudRes.events);
        if (cloudRes.settings) {
          setSettings(cloudRes.settings);
        }

        const errs: string[] = [];
        if (aptRes.error) errs.push(aptRes.error);
        if (cloudRes.error) errs.push(cloudRes.error);
        if (errs.length > 0) {
          setLoadError(errs.join(' · '));
        }

        logCallPanelDiagnostic({
          category: 'sync',
          event: 'data_synced',
          detail: `origem=${triggerReason}; chamadas=${cloudRes.calls.length}; agenda=${aptRes.appointments.length}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao atualizar dados do painel.';
        setLoadError(msg);
        logCallPanelDiagnostic({
          category: 'sync',
          event: 'data_sync_error',
          detail: `${triggerReason}: ${msg}`,
        });
      } finally {
        isFetchInFlightRef.current = false;
        setIsInitialLoading(false);
        if (pendingRefetchRef.current) {
          pendingRefetchRef.current = false;
          void loadDisplayData('coalesced_pending');
        }
      }
    },
    [isAuthorizedForPanel, isTenantMismatch, resolvedOrgId, resolvedBranchId]
  );

  const scheduleDisplayRefresh = useCallback(
    (reason: string, delayMs: number = 80) => {
      if (refreshDebounceTimerRef.current !== null) {
        window.clearTimeout(refreshDebounceTimerRef.current);
      }
      refreshDebounceTimerRef.current = window.setTimeout(() => {
        refreshDebounceTimerRef.current = null;
        void loadDisplayData(reason);
      }, delayMs);
    },
    [loadDisplayData]
  );

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
      void loadDisplayData('initial_mount');
    });
  }, [isAuthorizedForPanel, isTenantMismatch, resolvedOrgId, loadDisplayData]);

  // 1-second clock & elapsed consultation timer tick
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

  // Same-browser instant BroadcastChannel wake-up listener
  useEffect(() => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    const bc = new BroadcastChannel(CALL_PANEL_BROADCAST_CHANNEL_NAME);
    bc.onmessage = (msg: MessageEvent<CallPanelSyncSignalPayload>) => {
      const data = msg?.data;
      if (!data || data.organizationId !== resolvedOrgId) return;
      logCallPanelDiagnostic({
        category: 'realtime',
        event: 'broadcast_channel_received',
        callId: data.callId,
        eventType: data.eventType,
      });
      scheduleDisplayRefresh(`broadcast_channel:${data.eventType}`, 40);
    };

    return () => {
      bc.close();
    };
  }, [isAuthorizedForPanel, isTenantMismatch, resolvedOrgId, scheduleDisplayRefresh]);

  // Tab visibilitychange & browser online/offline listeners
  useEffect(() => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      logCallPanelDiagnostic({
        category: 'visibility',
        event: 'tab_foreground',
        detail: `online=${String(navigator.onLine)}`,
      });

      if (audioActivated && !isCallAudioRunning()) {
        void unlockCallAudioContext().then((running) => {
          if (!running) {
            setAudioActivated(false);
            setAudioHint(
              'O navegador suspendeu o áudio em segundo plano. Clique em ATIVAR SOM para reativar.'
            );
          }
        });
      }

      if (navigator.onLine) {
        void loadDisplayData('visibility_foreground');
        if (connectionState !== 'connected') {
          setRealtimeGeneration((g) => g + 1);
        }
      }
    };

    const handleOnline = () => {
      logCallPanelDiagnostic({
        category: 'realtime',
        event: 'network_online',
      });
      wasDisconnectedRef.current = true;
      setConnectionState('reconnecting');
      setRealtimeGeneration((g) => g + 1);
      void loadDisplayData('network_online');
    };

    const handleOffline = () => {
      logCallPanelDiagnostic({
        category: 'realtime',
        event: 'network_offline',
      });
      wasDisconnectedRef.current = true;
      setConnectionState('offline');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [
    isAuthorizedForPanel,
    isTenantMismatch,
    resolvedOrgId,
    audioActivated,
    connectionState,
    loadDisplayData,
  ]);

  // Supabase Realtime (authenticated JWT + postgres_changes + broadcast) with automatic reconnect
  useEffect(() => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;

    const supabase = getSupabase();
    if (!supabase) {
      setConnectionState('unavailable');
      logCallPanelDiagnostic({
        category: 'realtime',
        event: 'supabase_unavailable',
      });
      return;
    }

    let cancelled = false;
    let activeChannels: ReturnType<typeof supabase.channel>[] = [];

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = (reason: string) => {
      if (cancelled || !navigator.onLine) return;
      clearReconnectTimer();
      reconnectAttemptRef.current += 1;
      const delay = Math.min(15000, 2000 * Math.pow(2, Math.min(3, reconnectAttemptRef.current - 1)));
      logCallPanelDiagnostic({
        category: 'realtime',
        event: 'reconnect_scheduled',
        detail: `${reason} (tentativa #${reconnectAttemptRef.current} em ${delay}ms)`,
      });
      reconnectTimerRef.current = window.setTimeout(() => {
        if (!cancelled) {
          setRealtimeGeneration((g) => g + 1);
        }
      }, delay);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        session?.access_token
      ) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    const startRealtime = async () => {
      setConnectionState(navigator.onLine ? 'connecting' : 'offline');
      const hasJwt = await ensureSupabaseRealtimeAuth();
      if (cancelled) return;

      logCallPanelDiagnostic({
        category: 'realtime',
        event: 'subscription_starting',
        detail: `jwtSynced=${String(hasJwt)} tentativa=${reconnectAttemptRef.current}`,
      });

      const dbChannel = supabase
        .channel(`tv-db-${resolvedOrgId}-${resolvedBranchId}-${realtimeGeneration}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'attendance_calls',
            filter: `organization_id=eq.${resolvedOrgId}`,
          },
          (payload) => {
            const rec = (payload.new || payload.old || {}) as Record<string, unknown>;
            logCallPanelDiagnostic({
              category: 'realtime',
              event: 'postgres_changes_received',
              eventType: `attendance_calls:${payload.eventType}`,
              callId: rec.id ? String(rec.id) : undefined,
            });
            scheduleDisplayRefresh(`pg:attendance_calls:${payload.eventType}`, 60);
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
          (payload) => {
            const rec = (payload.new || {}) as Record<string, unknown>;
            logCallPanelDiagnostic({
              category: 'realtime',
              event: 'postgres_changes_received',
              eventType: `attendance_call_events:${String(rec.event_type || 'INSERT')}`,
              eventId: rec.id ? String(rec.id) : undefined,
              callId: rec.attendance_call_id ? String(rec.attendance_call_id) : undefined,
            });
            scheduleDisplayRefresh('pg:attendance_call_events:INSERT', 60);
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
          (payload) => {
            logCallPanelDiagnostic({
              category: 'realtime',
              event: 'postgres_changes_received',
              eventType: `appointments:${payload.eventType}`,
            });
            scheduleDisplayRefresh(`pg:appointments:${payload.eventType}`, 100);
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
          (payload) => {
            logCallPanelDiagnostic({
              category: 'realtime',
              event: 'postgres_changes_received',
              eventType: `call_panel_settings:${payload.eventType}`,
            });
            scheduleDisplayRefresh('pg:call_panel_settings', 100);
          }
        )
        .subscribe((status, err) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            clearReconnectTimer();
            reconnectAttemptRef.current = 0;
            setConnectionState('connected');
            logCallPanelDiagnostic({
              category: 'realtime',
              event: 'channel_connected',
              detail: 'postgres_changes SUBSCRIBED',
            });
            if (wasDisconnectedRef.current) {
              wasDisconnectedRef.current = false;
              void loadDisplayData('realtime_reconnected');
            }
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            wasDisconnectedRef.current = true;
            const nextState: RealtimeConnectionState =
              typeof navigator !== 'undefined' && !navigator.onLine
                ? 'offline'
                : 'reconnecting';
            setConnectionState(nextState);
            logCallPanelDiagnostic({
              category: 'realtime',
              event: 'channel_disconnected',
              detail: `status=${status}${err ? ` error=${err.message}` : ''}`,
            });
            scheduleReconnect(status);
          }
        });

      const broadcastChannel = supabase
        .channel(getCallPanelRealtimeBroadcastTopic(resolvedOrgId))
        .on('broadcast', { event: 'attendance_updated' }, (msg) => {
          const payload = (msg?.payload || {}) as Partial<CallPanelSyncSignalPayload>;
          logCallPanelDiagnostic({
            category: 'realtime',
            event: 'realtime_broadcast_received',
            callId: payload.callId,
            eventType: payload.eventType,
          });
          scheduleDisplayRefresh(`rt_broadcast:${payload.eventType || 'update'}`, 50);
        })
        .subscribe();

      activeChannels = [dbChannel, broadcastChannel];
    };

    void startRealtime();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (refreshDebounceTimerRef.current !== null) {
        window.clearTimeout(refreshDebounceTimerRef.current);
        refreshDebounceTimerRef.current = null;
      }
      authListener.subscription.unsubscribe();
      for (const ch of activeChannels) {
        void supabase.removeChannel(ch);
      }
    };
  }, [
    isAuthorizedForPanel,
    isTenantMismatch,
    resolvedOrgId,
    resolvedBranchId,
    realtimeGeneration,
    loadDisplayData,
    scheduleDisplayRefresh,
  ]);

  // Contingency 5-second polling ONLY when Realtime is unavailable or disconnected
  useEffect(() => {
    if (!isAuthorizedForPanel || isTenantMismatch || !resolvedOrgId) return;

    if (connectionState === 'connected') {
      // Realtime healthy -> stop 5s contingency polling to avoid redundant traffic
      return;
    }

    logCallPanelDiagnostic({
      category: 'sync',
      event: 'contingency_polling_armed',
      detail: `interval=5000ms state=${connectionState}`,
    });

    const timer = window.setInterval(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      void loadDisplayData('contingency_5s');
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    isAuthorizedForPanel,
    isTenantMismatch,
    resolvedOrgId,
    connectionState,
    loadDisplayData,
  ]);

  const snapshot = useMemo(
    () =>
      resolvePhysicianPanelSnapshot(appointments, calls, {
        organizationId: resolvedOrgId,
        branchId: resolvedBranchId,
        professionalId: effectiveProfessionalId,
        roomId: resolvedRoomId !== 'all' ? resolvedRoomId : undefined,
      }),
    [
      appointments,
      calls,
      resolvedOrgId,
      resolvedBranchId,
      effectiveProfessionalId,
      resolvedRoomId,
    ]
  );

  // Event-ID deduplicated visual highlight + chime + voice announcement on incoming call
  useEffect(() => {
    if (isInitialLoading) return;

    const activeCalled = snapshot.activeCalled;
    const callKey = getAttendanceCallEventKey(activeCalled);
    const dbEventKey = activeCalled ? getAttendanceCallEventKey(activeCalled, events) : null;
    const primaryKey = dbEventKey || callKey;

    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      if (callKey) announcedEventKeysRef.current.add(callKey);
      if (dbEventKey) announcedEventKeysRef.current.add(dbEventKey);
      if (primaryKey) {
        logCallPanelDiagnostic({
          category: 'sync',
          event: 'initial_call_hydrated_without_replay',
          callId: activeCalled?.id,
          eventId: primaryKey,
        });
      }
      return;
    }

    if (!activeCalled || !primaryKey) return;
    if (
      (callKey && announcedEventKeysRef.current.has(callKey)) ||
      (dbEventKey && announcedEventKeysRef.current.has(dbEventKey))
    ) {
      // Ensure both keys are recorded if the DB event row arrived slightly after calls row
      if (callKey) announcedEventKeysRef.current.add(callKey);
      if (dbEventKey) announcedEventKeysRef.current.add(dbEventKey);
      return;
    }

    if (callKey) announcedEventKeysRef.current.add(callKey);
    if (dbEventKey) announcedEventKeysRef.current.add(dbEventKey);
    while (announcedEventKeysRef.current.size > 240) {
      const oldest = announcedEventKeysRef.current.values().next().value;
      if (!oldest) break;
      announcedEventKeysRef.current.delete(oldest);
    }

    logCallPanelDiagnostic({
      category: 'audio',
      event: 'new_call_event_detected',
      callId: activeCalled.id,
      eventId: primaryKey,
      eventType: activeCalled.callCount > 1 ? 'recalled' : 'called',
    });

    // 1. Visual highlight (respects prefers-reduced-motion)
    let highlightTimer: number | undefined;
    if (!prefersReducedMotion()) {
      setCallHighlightActive(true);
      highlightTimer = window.setTimeout(() => setCallHighlightActive(false), 3600);
    }

    // 2. Chime -> short delay -> Voice (only if audio was explicitly activated & not muted)
    if (!audioActivated) {
      setAudioHint('Nova chamada exibida. Clique em ATIVAR SOM para habilitar campainha e voz.');
      logCallPanelDiagnostic({
        category: 'audio',
        event: 'audio_skipped_not_activated',
        callId: activeCalled.id,
        eventId: primaryKey,
      });
    } else if (!isLocalMuted) {
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
      }).then((res) => {
        logCallPanelDiagnostic({
          category: 'speech',
          event: 'call_alert_outcome',
          callId: activeCalled.id,
          eventId: primaryKey,
          detail: `chime=${String(res.chimePlayed)} voiceAttempted=${String(
            res.voiceAttempted
          )} voice=${res.voiceName || 'none'}(${res.voiceLang || 'n/a'}) audioState=${
            res.audioState
          }${res.error ? ` err=${res.error}` : ''}`,
        });

        if (settings.soundEnabled && !res.chimePlayed && res.audioState !== 'running') {
          setAudioActivated(false);
          setAudioHint(
            res.error || 'O navegador bloqueou o som automático. Clique novamente em ATIVAR SOM.'
          );
        } else {
          setAudioHint('');
        }
      });
    }

    return () => {
      if (highlightTimer !== undefined) {
        window.clearTimeout(highlightTimer);
      }
    };
  }, [
    isInitialLoading,
    snapshot.activeCalled,
    events,
    effectiveNameMode,
    audioActivated,
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

  // Explicit user-gesture audio & speech activation (ATIVAR SOM)
  const handleActivateSound = async () => {
    setAudioStatusError('');
    setAudioHint('');

    const res = await unlockAndTestCallAudio(settings.chimeVolume);
    logCallPanelDiagnostic({
      category: 'audio',
      event: 'audio_activation_result',
      detail: `unlocked=${String(res.unlocked)} chime=${String(
        res.chimePlayed
      )} state=${res.audioState} voices=${res.voiceCount} selected=${
        res.selectedVoiceName || 'none'
      }(${res.selectedVoiceLang || 'n/a'})`,
    });

    if (!res.unlocked) {
      setAudioActivated(false);
      setAudioStatusError(
        res.reason || 'Não foi possível inicializar o áudio nesta aba.'
      );
      return;
    }

    setAudioActivated(true);
    setIsLocalMuted(false);

    if (!res.voiceSupported) {
      setAudioHint('Som ativado. Este navegador não suporta voz; apenas a campainha tocará.');
    } else if (!res.selectedVoiceName) {
      setAudioHint(
        'Som ativado. Nenhuma voz em português detectada ainda; campainha garantida nas chamadas.'
      );
    }
  };

  const handleToggleLocalMute = () => {
    setIsLocalMuted((prev) => !prev);
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

  const matchedRoom =
    resolvedRoomId && resolvedRoomId !== 'all'
      ? rooms.find((r) => r.id === resolvedRoomId) || null
      : settings.defaultRoomId
      ? rooms.find((r) => r.id === settings.defaultRoomId) || null
      : null;

  const scopeParts: string[] = [];
  if (branchName) scopeParts.push(branchName);
  if (effectiveProfessionalId === 'all') {
    scopeParts.push('Recepção Geral · Todos os Médicos');
  } else {
    scopeParts.push(
      matchedProfessional?.fullName ||
        (settings.physicianDisplayLabel &&
        (!settings.defaultProfessionalId ||
          settings.defaultProfessionalId === effectiveProfessionalId)
          ? settings.physicianDisplayLabel
          : 'Consultório')
    );
  }
  if (resolvedRoomId !== 'all' && matchedRoom) {
    scopeParts.push(matchedRoom.name);
  }
  const scopeDescription = scopeParts.join(' · ');

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

  return (
    <div
      ref={displayRootRef}
      data-testid="public-attendance-display"
      className="min-h-screen lg:h-screen w-screen lg:overflow-hidden bg-white text-slate-900 flex flex-col lg:flex-row select-none"
    >
      {/* ÁREA PRINCIPAL (75%) — Fundo Branco Predominante */}
      <main
        className={`w-full lg:w-[75%] flex-1 lg:h-full flex flex-col justify-between px-6 py-5 sm:px-10 sm:py-8 xl:px-14 xl:py-10 transition-colors duration-500 motion-reduce:transition-none ${
          callHighlightActive ? 'bg-emerald-50/90' : 'bg-white'
        }`}
      >
        {/* Identificação discreta da clínica + status de conexão + ATIVAR SOM + Tela Cheia */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
            <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-800 truncate">
              {clinic.tradeName || organization.name}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-slate-400">
              {scopeDescription}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Indicador discreto de conexão em tempo real */}
            <span
              role="status"
              data-testid="display-connection-status"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                connectionState === 'connected'
                  ? 'border-slate-200 text-slate-500 bg-white'
                  : connectionState === 'offline'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {connectionState === 'connected' ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-600" />
                  <span>Tempo real ativo</span>
                </>
              ) : connectionState === 'offline' ? (
                <>
                  <WifiOff className="w-3 h-3" />
                  <span>Sem internet</span>
                </>
              ) : connectionState === 'unavailable' ? (
                <>
                  <WifiOff className="w-3 h-3" />
                  <span>Atualização 5s</span>
                </>
              ) : (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Reconectando...</span>
                </>
              )}
            </span>

            {/* Controle explícito ATIVAR SOM / SOM ATIVADO */}
            {!audioActivated ? (
              <button
                type="button"
                data-testid="activate-sound-button"
                onClick={() => void handleActivateSound()}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold tracking-wide inline-flex items-center gap-1.5 shadow-2xs transition"
                title="Ativar campainha e anúncio por voz nesta guia"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>ATIVAR SOM</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1">
                <span
                  data-testid="sound-activated-indicator"
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold inline-flex items-center gap-1.5 ${
                    isLocalMuted
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isLocalMuted ? 'SOM SILENCIADO' : 'SOM ATIVADO'}</span>
                </span>
                <button
                  type="button"
                  onClick={handleToggleLocalMute}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition"
                  title={isLocalMuted ? 'Reativar som nesta tela' : 'Silenciar temporariamente'}
                >
                  {isLocalMuted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                </button>
              </div>
            )}

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

            {debugModeEnabled && (
              <button
                type="button"
                onClick={() => setShowDiagnostics((prev) => !prev)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-800 hover:bg-slate-50 transition"
                title="Diagnóstico técnico (DEV/Debug)"
              >
                <Bug className="w-3.5 h-3.5" />
              </button>
            )}
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

              {/* Nome do Paciente em destaque absoluto com realce único por evento */}
              <h1
                data-testid="display-active-patient-name"
                className={`text-[clamp(2.5rem,5.4vw,5.75rem)] font-black tracking-tight leading-[1.06] break-words transition-colors duration-500 motion-reduce:transition-none ${
                  callHighlightActive
                    ? 'text-emerald-800'
                    : 'text-slate-950'
                }`}
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
              </p>
            </div>
          )}
        </div>

        {/* Avisos discretos ocasionais (som bloqueado, falha de carga ou dica F11) */}
        {(loadError || fullscreenHint || audioStatusError || audioHint) && (
          <div className="pt-2 flex flex-wrap items-center gap-3">
            {audioStatusError && (
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{audioStatusError}</span>
              </div>
            )}
            {audioHint && !audioStatusError && (
              <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                {audioHint}
              </p>
            )}
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

      {/* Drawer Técnico de Diagnóstico (Apenas DEV ou ?debug=1 autorizado) */}
      {debugModeEnabled && showDiagnostics && (
        <div className="fixed bottom-4 right-4 z-50 w-full max-w-md bg-slate-950 text-slate-100 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Diagnóstico Técnico (DEV)
            </span>
            <button
              type="button"
              onClick={() => setShowDiagnostics(false)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-3 space-y-1.5 font-mono text-[11px]">
            {diagEntries.length === 0 ? (
              <p className="text-slate-500">Nenhum evento registrado ainda.</p>
            ) : (
              diagEntries.map((entry) => (
                <div key={entry.id} className="border-b border-slate-900 pb-1">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>
                      [{entry.category}] {entry.event}
                    </span>
                    <span>{entry.timestamp.slice(11, 19)}</span>
                  </div>
                  {(entry.eventType || entry.callId || entry.eventId || entry.detail) && (
                    <p className="text-slate-300 break-all">
                      {[
                        entry.eventType ? `tipo=${entry.eventType}` : '',
                        entry.callId ? `call=${entry.callId.slice(0, 8)}` : '',
                        entry.eventId ? `evt=${entry.eventId.slice(0, 14)}` : '',
                        entry.detail || '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
