export type CallPanelDiagCategory =
  | 'realtime'
  | 'sync'
  | 'audio'
  | 'speech'
  | 'visibility';

export interface CallPanelDiagEntry {
  id: string;
  timestamp: string;
  category: CallPanelDiagCategory;
  event: string;
  callId?: string;
  eventId?: string;
  eventType?: string;
  detail?: string;
}

const MAX_DIAG_ENTRIES = 80;
const diagBuffer: CallPanelDiagEntry[] = [];
const listeners = new Set<() => void>();

export function isCallPanelDebugEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    return true;
  }
  if (typeof window !== 'undefined') {
    try {
      const sp = new URLSearchParams(window.location.search);
      return sp.get('debug') === '1';
    } catch {
      return false;
    }
  }
  return false;
}

export function logCallPanelDiagnostic(entry: Omit<CallPanelDiagEntry, 'id' | 'timestamp'>): void {
  const fullEntry: CallPanelDiagEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    category: entry.category,
    event: entry.event,
    callId: entry.callId,
    eventId: entry.eventId,
    eventType: entry.eventType,
    detail: entry.detail,
  };

  diagBuffer.unshift(fullEntry);
  if (diagBuffer.length > MAX_DIAG_ENTRIES) {
    diagBuffer.length = MAX_DIAG_ENTRIES;
  }

  if (isCallPanelDebugEnabled()) {
    // Sanitized technical diagnostics only (never patient names or clinical fields)
    console.debug(
      `[MedSync Painel][${fullEntry.category}] ${fullEntry.event}`,
      {
        callId: fullEntry.callId,
        eventId: fullEntry.eventId,
        eventType: fullEntry.eventType,
        detail: fullEntry.detail,
      }
    );
  }

  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore subscriber failure
    }
  }
}

export function getCallPanelDiagnostics(): CallPanelDiagEntry[] {
  return [...diagBuffer];
}

export function subscribeCallPanelDiagnostics(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
