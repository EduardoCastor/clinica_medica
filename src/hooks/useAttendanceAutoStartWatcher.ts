import { useEffect, useRef } from 'react';
import {
  AttendanceCloudService,
  CALL_PANEL_BROADCAST_CHANNEL_NAME,
  CallPanelSyncSignalPayload,
  ensureSupabaseRealtimeAuth,
} from '../services/attendanceCloudService';
import {
  getNextAutoStartWakeDelayMs,
  processDueAutoStartCalls,
} from '../services/attendanceAutoStartService';
import { getSupabase } from '../services/supabaseClient';

export function useAttendanceAutoStartWatcher(params: {
  enabled: boolean;
  organizationId?: string;
  branchId?: string;
}): void {
  const { enabled, organizationId, branchId } = params;
  const wakeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !organizationId) return;

    let cancelled = false;
    const clearWakeTimer = () => {
      if (wakeTimerRef.current !== null) {
        window.clearTimeout(wakeTimerRef.current);
        wakeTimerRef.current = null;
      }
    };

    const syncAndProcess = async () => {
      if (cancelled) return;
      clearWakeTimer();

      const pendingCalls = await AttendanceCloudService.fetchPendingCalledCalls(
        organizationId,
        branchId
      );
      if (cancelled) return;

      await processDueAutoStartCalls(pendingCalls, {
        onRefreshNeeded: syncAndProcess,
      });

      if (cancelled) return;
      const nextDelayMs = getNextAutoStartWakeDelayMs(pendingCalls);
      if (nextDelayMs !== null) {
        wakeTimerRef.current = window.setTimeout(() => {
          void syncAndProcess();
        }, nextDelayMs);
      }
    };

    void syncAndProcess();

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(CALL_PANEL_BROADCAST_CHANNEL_NAME);
      bc.onmessage = (msg: MessageEvent<CallPanelSyncSignalPayload>) => {
        if (msg?.data?.organizationId === organizationId) {
          void syncAndProcess();
        }
      };
    }

    const onForegroundOrOnline = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      void syncAndProcess();
    };

    document.addEventListener('visibilitychange', onForegroundOrOnline);
    window.addEventListener('focus', onForegroundOrOnline);
    window.addEventListener('online', onForegroundOrOnline);

    const supabase = getSupabase();
    let rtChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    if (supabase) {
      void ensureSupabaseRealtimeAuth().then(() => {
        if (cancelled) return;
        rtChannel = supabase
          .channel(`auto-start-watcher-${organizationId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'attendance_calls',
              filter: `organization_id=eq.${organizationId}`,
            },
            () => {
              void syncAndProcess();
            }
          )
          .subscribe();
      });
    }

    return () => {
      cancelled = true;
      clearWakeTimer();
      if (bc) bc.close();
      document.removeEventListener('visibilitychange', onForegroundOrOnline);
      window.removeEventListener('focus', onForegroundOrOnline);
      window.removeEventListener('online', onForegroundOrOnline);
      if (supabase && rtChannel) {
        void supabase.removeChannel(rtChannel);
      }
    };
  }, [enabled, organizationId, branchId]);
}
