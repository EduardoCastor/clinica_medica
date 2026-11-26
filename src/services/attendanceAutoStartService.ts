import { AttendanceCallRecord } from '../types';
import { AttendanceCloudService, CallPanelRpcResult } from './attendanceCloudService';
import { hasAutoStartElapsed } from './attendanceQueueUtils';
import { logCallPanelDiagnostic } from './callPanelDiagnostics';

export interface AutoStartExecutionCallbacks {
  startRpc?: (
    attendanceCallId: string,
    origin: 'automatic'
  ) => Promise<CallPanelRpcResult>;
  onStarted?: (call: AttendanceCallRecord, result: CallPanelRpcResult) => void | Promise<void>;
  onError?: (call: AttendanceCallRecord, message: string) => void;
  onRefreshNeeded?: () => void | Promise<void>;
}

const inFlightCallKeys = new Set<string>();
const retryAfterMsByKey = new Map<string, number>();
const settledInvalidKeys = new Set<string>();

function getAutoStartKey(call: Pick<AttendanceCallRecord, 'id' | 'calledAt'>): string {
  return `${call.id}:${call.calledAt || ''}`;
}

export function clearAutoStartRetryState(attendanceCallId?: string): void {
  if (!attendanceCallId) {
    inFlightCallKeys.clear();
    retryAfterMsByKey.clear();
    settledInvalidKeys.clear();
    return;
  }
  const prefix = `${attendanceCallId}:`;
  for (const key of Array.from(inFlightCallKeys)) {
    if (key.startsWith(prefix)) inFlightCallKeys.delete(key);
  }
  for (const key of Array.from(retryAfterMsByKey.keys())) {
    if (key.startsWith(prefix)) retryAfterMsByKey.delete(key);
  }
  for (const key of Array.from(settledInvalidKeys)) {
    if (key.startsWith(prefix)) settledInvalidKeys.delete(key);
  }
}

export function getNextAutoStartWakeDelayMs(
  calls: AttendanceCallRecord[],
  nowMs: number = Date.now()
): number | null {
  let minDelayMs: number | null = null;

  for (const call of calls) {
    if (call.status !== 'chamado' || !call.calledAt || call.startedAt || call.endedAt) {
      continue;
    }
    const key = getAutoStartKey(call);
    if (settledInvalidKeys.has(key)) continue;

    const calledMs = new Date(call.calledAt).getTime();
    if (!Number.isFinite(calledMs)) continue;

    const delaySeconds = Math.max(15, Number(call.autoStartDelaySeconds) || 120);
    const dueMs = calledMs + delaySeconds * 1000;
    const retryAt = retryAfterMsByKey.get(key) || 0;
    const targetMs = Math.max(dueMs, retryAt);
    const waitMs = Math.max(150, targetMs - nowMs + 150);

    if (minDelayMs === null || waitMs < minDelayMs) {
      minDelayMs = waitMs;
    }
  }

  return minDelayMs;
}

export function isEligibleForAutoStart(
  call: AttendanceCallRecord,
  allCalls: AttendanceCallRecord[],
  nowMs: number = Date.now()
): boolean {
  if (call.status !== 'chamado') return false;
  if (!call.calledAt || call.startedAt || call.endedAt || call.cancellationReason) return false;
  if (!hasAutoStartElapsed(call, nowMs)) return false;

  const hasPhysicianInProgress = allCalls.some(
    (other) =>
      other.id !== call.id &&
      other.organizationId === call.organizationId &&
      other.professionalId === call.professionalId &&
      other.status === 'em_andamento'
  );
  if (hasPhysicianInProgress) return false;

  const key = getAutoStartKey(call);
  if (settledInvalidKeys.has(key) || inFlightCallKeys.has(key)) return false;

  const retryAt = retryAfterMsByKey.get(key);
  if (retryAt && nowMs < retryAt) return false;

  return true;
}

/**
 * Evaluates all `chamado` calls and executes the atomic PostgreSQL RPC for any
 * call whose 2-minute countdown has expired based on DB `called_at`.
 * Handles clock-skew (`AUTO_START_NOT_DUE`), concurrent tabs (`alreadyStarted`),
 * and transient errors cleanly without ever deadlocking retries.
 */
export async function processDueAutoStartCalls(
  calls: AttendanceCallRecord[],
  callbacks: AutoStartExecutionCallbacks = {},
  nowMs: number = Date.now()
): Promise<boolean> {
  const dueCalls = calls.filter((call) => isEligibleForAutoStart(call, calls, nowMs));
  if (dueCalls.length === 0) return false;

  const invokeRpc =
    callbacks.startRpc ||
    ((attendanceCallId: string, origin: 'automatic') =>
      AttendanceCloudService.startAttendanceRpc(attendanceCallId, origin));

  let anyStarted = false;

  for (const call of dueCalls) {
    const key = getAutoStartKey(call);
    inFlightCallKeys.add(key);

    try {
      logCallPanelDiagnostic({
        category: 'sync',
        event: 'auto_start_attempt',
        callId: call.id,
        detail: `delay=${call.autoStartDelaySeconds}s`,
      });

      const res = await invokeRpc(call.id, 'automatic');

      if (res.success) {
        retryAfterMsByKey.delete(key);
        settledInvalidKeys.add(key);
        anyStarted = true;

        logCallPanelDiagnostic({
          category: 'sync',
          event: res.alreadyStarted ? 'auto_start_already_started' : 'auto_start_succeeded',
          callId: call.id,
        });

        await callbacks.onStarted?.(call, res);
        await callbacks.onRefreshNeeded?.();
        continue;
      }

      if (res.code === 'AUTO_START_NOT_DUE') {
        // Compute exact server wait window so client/server clock skew never stalls auto-start
        let waitMs = Math.max(1, res.remainingSeconds ?? 1) * 1000 + 250;
        if (res.serverNow && res.dueAt) {
          const sMs = new Date(res.serverNow).getTime();
          const dMs = new Date(res.dueAt).getTime();
          if (Number.isFinite(sMs) && Number.isFinite(dMs)) {
            waitMs = Math.max(300, dMs - sMs + 250);
          }
        }
        retryAfterMsByKey.set(key, Date.now() + waitMs);
        logCallPanelDiagnostic({
          category: 'sync',
          event: 'auto_start_clock_skew_rescheduled',
          callId: call.id,
          detail: `waitMs=${waitMs}`,
        });
        continue;
      }

      if (res.code === 'INVALID_STATE_TRANSITION' || res.code === 'NOT_FOUND') {
        // Call was cancelled, concluded, or replaced concurrently -> stop retrying and sync state
        settledInvalidKeys.add(key);
        retryAfterMsByKey.delete(key);
        await callbacks.onRefreshNeeded?.();
        continue;
      }

      // Transient or operational rejection (e.g. PHYSICIAN_BUSY, RBAC, network) -> backoff & surface
      retryAfterMsByKey.set(key, Date.now() + 5000);
      const errMsg =
        res.error || 'Não foi possível iniciar o atendimento automaticamente após 2 minutos.';
      logCallPanelDiagnostic({
        category: 'sync',
        event: 'auto_start_failed',
        callId: call.id,
        detail: `${res.code || 'ERROR'}: ${errMsg}`,
      });
      callbacks.onError?.(call, errMsg);
    } catch (err) {
      retryAfterMsByKey.set(key, Date.now() + 5000);
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Erro de comunicação ao executar início automático.';
      logCallPanelDiagnostic({
        category: 'sync',
        event: 'auto_start_exception',
        callId: call.id,
        detail: errMsg,
      });
      callbacks.onError?.(call, errMsg);
    } finally {
      inFlightCallKeys.delete(key);
    }
  }

  return anyStarted;
}
