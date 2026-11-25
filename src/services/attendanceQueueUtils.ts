import {
  Appointment,
  AttendanceCallRecord,
  AttendanceCallStatus,
  PatientNameDisplayMode,
} from '../types';
import {
  addDaysToYmdSaoPaulo,
  getMonthStartEndYmd,
  getSaoPauloTodayYmd,
  isYmdWithinRange,
  normalizeDateToSaoPauloYmd,
  SAO_PAULO_TIMEZONE,
} from './financialDateUtils';

export const AUTO_CLOSE_CONFIRMATION_MESSAGE =
  'Existe um atendimento em andamento para este médico. Ao chamar outro paciente, o atendimento atual será encerrado automaticamente. Deseja continuar?';

export type DashboardAnalyticsPeriod =
  | 'today'
  | '7d'
  | '30d'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface PhysicianPanelSnapshot {
  activeInProgress: AttendanceCallRecord | null;
  activeCalled: AttendanceCallRecord | null;
  lastCompleted: AttendanceCallRecord | null;
  waitingQueue: Appointment[];
  nextPatient: Appointment | null;
  waitingCount: number;
}

export interface DailyAttendancePoint {
  ymd: string;
  label: string;
  count: number;
}

export interface PeriodBucketPoint {
  key: string;
  label: string;
  count: number;
}

export interface ProcedureDurationMetric {
  procedureName: string;
  avgMinutes: number;
  count: number;
}

export interface PhysicianDurationMetric {
  professionalId: string;
  professionalName: string;
  avgMinutes: number;
  count: number;
}

export interface AttendanceAnalyticsResult {
  rangeStartYmd: string;
  rangeEndYmd: string;
  kpis: {
    completedToday: number;
    completedWeek: number;
    completedMonth: number;
    inProgressNow: number;
    waitingNow: number;
    avgDurationSecondsToday: number | null;
    sampleSizeToday: number;
    avgDurationSecondsPeriod: number | null;
    sampleSizePeriod: number;
    completedInSelectedPeriod: number;
  };
  charts: {
    dailySeries: DailyAttendancePoint[];
    weeklySeries: PeriodBucketPoint[];
    monthlySeries: PeriodBucketPoint[];
    avgDurationByProcedure: ProcedureDurationMetric[];
    avgDurationByPhysician: PhysicianDurationMetric[];
  };
  procedureOptions: string[];
}

const ALLOWED_TRANSITIONS: Record<AttendanceCallStatus, AttendanceCallStatus[]> = {
  aguardando: ['chamado', 'cancelado'],
  chamado: ['chamado', 'em_andamento', 'cancelado'],
  em_andamento: ['concluido'],
  concluido: [],
  cancelado: [],
};

export function canTransitionAttendanceStatus(
  from: AttendanceCallStatus,
  to: AttendanceCallStatus
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isAttendanceActive(status: AttendanceCallStatus): boolean {
  return status === 'chamado' || status === 'em_andamento';
}

export function getAutoStartRemainingSeconds(
  calledAt?: string | null,
  autoStartDelaySeconds: number = 120,
  nowMs: number = Date.now()
): number {
  if (!calledAt) return Math.max(0, autoStartDelaySeconds);
  const calledMs = new Date(calledAt).getTime();
  if (!Number.isFinite(calledMs)) return Math.max(0, autoStartDelaySeconds);
  const delay = Math.max(15, Number(autoStartDelaySeconds) || 120);
  const dueMs = calledMs + delay * 1000;
  return Math.max(0, Math.ceil((dueMs - nowMs) / 1000));
}

export function hasAutoStartElapsed(
  call: Pick<AttendanceCallRecord, 'status' | 'calledAt' | 'startedAt' | 'autoStartDelaySeconds'> | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!call) return false;
  if (call.status !== 'chamado') return false;
  if (call.startedAt || !call.calledAt) return false;
  const calledMs = new Date(call.calledAt).getTime();
  if (!Number.isFinite(calledMs)) return false;
  const delay = Math.max(15, Number(call.autoStartDelaySeconds) || 120);
  return nowMs >= calledMs + delay * 1000;
}

export function formatElapsedHms(startedAt?: string | null, nowMs: number = Date.now()): string {
  if (!startedAt) return '00:00:00';
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return '00:00:00';
  const totalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatCountdownMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationHuman(durationSeconds?: number | null): string {
  if (durationSeconds === null || durationSeconds === undefined || !Number.isFinite(durationSeconds)) {
    return '—';
  }
  const total = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours} h ${String(mins).padStart(2, '0')} min`;
  }
  if (mins > 0) {
    return `${mins} min ${String(secs).padStart(2, '0')} s`;
  }
  return `${secs} s`;
}

export function formatDurationMinutesLabel(avgSeconds: number | null): string {
  if (avgSeconds === null || !Number.isFinite(avgSeconds)) return '—';
  const mins = avgSeconds / 60;
  return `${mins.toFixed(1).replace('.', ',')} min`;
}

export function formatCallPanelPatientName(
  fullName: string,
  mode: PatientNameDisplayMode = 'full'
): string {
  const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Paciente';
  const parts = cleaned.split(' ').filter(Boolean);
  if (mode === 'full' || parts.length <= 1) {
    return cleaned;
  }
  if (mode === 'first_last') {
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }
  // initials: "Maria S. O."
  return [parts[0], ...parts.slice(1).map((p) => `${p.charAt(0).toUpperCase()}.`)].join(' ');
}

export function formatTimeSaoPaulo(iso?: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: SAO_PAULO_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}

export function formatTimeWithSecondsSaoPaulo(iso?: string | Date | null): string {
  if (!iso) return '—';
  const parsed = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: SAO_PAULO_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(parsed);
  } catch {
    return parsed.toLocaleTimeString('pt-BR');
  }
}

export function formatFullDateSaoPaulo(reference: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: SAO_PAULO_TIMEZONE,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(reference);
  } catch {
    return reference.toLocaleDateString('pt-BR');
  }
}

export function buildPatientVoiceAnnouncementText(params: {
  patientName: string;
  roomName: string;
  professionalName: string;
}): string {
  const patient = String(params.patientName || 'Paciente').trim();
  const room = String(params.roomName || 'Consultório 01').trim();
  const professional = String(params.professionalName || 'Médico').trim();
  return `Atenção, ${patient}. Favor dirigir-se à ${room} para atendimento com ${professional}.`;
}

const APPOINTMENT_STATUS_PRIORITY: Record<string, number> = {
  waiting_room: 0,
  confirmed: 1,
  scheduled: 2,
};

export function buildEligibleWaitingQueue(
  appointments: Appointment[],
  attendanceCalls: AttendanceCallRecord[],
  options: {
    organizationId?: string;
    branchId?: string;
    professionalId?: string;
    targetDateYmd?: string;
  }
): Appointment[] {
  const targetYmd = options.targetDateYmd || getSaoPauloTodayYmd();

  const busyOrDoneAppointments = new Set<string>();
  for (const call of attendanceCalls) {
    if (options.organizationId && call.organizationId !== options.organizationId) continue;
    if (
      call.status === 'chamado' ||
      call.status === 'em_andamento' ||
      call.status === 'concluido'
    ) {
      busyOrDoneAppointments.add(call.appointmentId);
    }
  }

  return appointments
    .filter((apt) => {
      if (options.organizationId && apt.organizationId !== options.organizationId) return false;
      if (options.branchId && options.branchId !== 'all' && apt.branchId !== options.branchId) {
        return false;
      }
      if (
        options.professionalId &&
        options.professionalId !== 'all' &&
        apt.professionalId !== options.professionalId
      ) {
        return false;
      }
      if (!['waiting_room', 'confirmed', 'scheduled'].includes(apt.status)) {
        return false;
      }
      if (busyOrDoneAppointments.has(apt.id)) {
        return false;
      }
      const aptYmd = normalizeDateToSaoPauloYmd(apt.startTime);
      return aptYmd === targetYmd;
    })
    .sort((a, b) => {
      const pA = APPOINTMENT_STATUS_PRIORITY[a.status] ?? 9;
      const pB = APPOINTMENT_STATUS_PRIORITY[b.status] ?? 9;
      if (pA !== pB) return pA - pB;
      const tA = new Date(a.startTime).getTime();
      const tB = new Date(b.startTime).getTime();
      if (tA !== tB) return tA - tB;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

export function resolvePhysicianPanelSnapshot(
  appointments: Appointment[],
  attendanceCalls: AttendanceCallRecord[],
  options: {
    organizationId?: string;
    branchId?: string;
    professionalId: string;
    targetDateYmd?: string;
  }
): PhysicianPanelSnapshot {
  const targetYmd = options.targetDateYmd || getSaoPauloTodayYmd();

  const scopedCalls = attendanceCalls.filter((c) => {
    if (options.organizationId && c.organizationId !== options.organizationId) return false;
    if (options.branchId && options.branchId !== 'all' && c.branchId !== options.branchId) {
      return false;
    }
    if (options.professionalId && c.professionalId !== options.professionalId) {
      return false;
    }
    return true;
  });

  const activeInProgress =
    scopedCalls
      .filter((c) => c.status === 'em_andamento')
      .sort(
        (a, b) =>
          new Date(b.startedAt || b.createdAt).getTime() -
          new Date(a.startedAt || a.createdAt).getTime()
      )[0] || null;

  const activeCalled =
    scopedCalls
      .filter((c) => c.status === 'chamado')
      .sort(
        (a, b) =>
          new Date(b.calledAt || b.createdAt).getTime() -
          new Date(a.calledAt || a.createdAt).getTime()
      )[0] || null;

  const lastCompleted =
    scopedCalls
      .filter((c) => c.status === 'concluido' && Boolean(c.endedAt))
      .sort(
        (a, b) =>
          new Date(b.endedAt || b.updatedAt || b.createdAt).getTime() -
          new Date(a.endedAt || a.updatedAt || a.createdAt).getTime()
      )[0] || null;

  const waitingQueue = options.professionalId
    ? buildEligibleWaitingQueue(appointments, attendanceCalls, {
        organizationId: options.organizationId,
        branchId: options.branchId,
        professionalId: options.professionalId,
        targetDateYmd: targetYmd,
      })
    : [];

  return {
    activeInProgress,
    activeCalled,
    lastCompleted,
    waitingQueue,
    nextPatient: waitingQueue[0] || null,
    waitingCount: waitingQueue.length,
  };
}

export function getResolvedCallDurationSeconds(call: AttendanceCallRecord): number | null {
  if (typeof call.durationSeconds === 'number' && Number.isFinite(call.durationSeconds) && call.durationSeconds >= 0) {
    return Math.round(call.durationSeconds);
  }
  if (!call.startedAt || !call.endedAt) return null;
  const startMs = new Date(call.startedAt).getTime();
  const endMs = new Date(call.endedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 1000);
}

export function resolveAnalyticsDateRange(
  period: DashboardAnalyticsPeriod,
  customStartYmd?: string,
  customEndYmd?: string,
  now: Date = new Date()
): { startYmd: string; endYmd: string } {
  const todayYmd = getSaoPauloTodayYmd(now);
  switch (period) {
    case 'today':
      return { startYmd: todayYmd, endYmd: todayYmd };
    case '7d':
      return { startYmd: addDaysToYmdSaoPaulo(todayYmd, -6), endYmd: todayYmd };
    case '30d':
      return { startYmd: addDaysToYmdSaoPaulo(todayYmd, -29), endYmd: todayYmd };
    case 'this_month': {
      const m = getMonthStartEndYmd(todayYmd);
      return { startYmd: m.start, endYmd: m.end };
    }
    case 'last_month': {
      const [y, m] = todayYmd.split('-').map(Number);
      const prevYear = m === 1 ? y - 1 : y;
      const prevMonth = m === 1 ? 12 : m - 1;
      const lastDay = new Date(prevYear, prevMonth, 0).getDate();
      return {
        startYmd: `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`,
        endYmd: `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      };
    }
    case 'custom': {
      const start = normalizeDateToSaoPauloYmd(customStartYmd) || addDaysToYmdSaoPaulo(todayYmd, -29);
      const end = normalizeDateToSaoPauloYmd(customEndYmd) || todayYmd;
      return start <= end ? { startYmd: start, endYmd: end } : { startYmd: end, endYmd: start };
    }
  }
}

function getMondayStartYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
  const dayOfWeek = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDaysToYmdSaoPaulo(ymd, diffToMonday);
}

function getMonthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}

function formatMonthLabelPtBr(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const idx = (m || 1) - 1;
  return `${months[idx] || monthKey}/${String(y).slice(-2)}`;
}

function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1 + deltaMonths, 15, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function computeAttendanceAnalytics(
  attendanceCalls: AttendanceCallRecord[],
  appointments: Appointment[],
  options: {
    organizationId?: string;
    branchId?: string;
    period: DashboardAnalyticsPeriod;
    customStartYmd?: string;
    customEndYmd?: string;
    professionalId?: string;
    procedureName?: string;
    now?: Date;
  }
): AttendanceAnalyticsResult {
  const now = options.now || new Date();
  const todayYmd = getSaoPauloTodayYmd(now);
  const weekStartYmd = addDaysToYmdSaoPaulo(todayYmd, -6);
  const currentMonth = getMonthStartEndYmd(todayYmd);
  const { startYmd: rangeStartYmd, endYmd: rangeEndYmd } = resolveAnalyticsDateRange(
    options.period,
    options.customStartYmd,
    options.customEndYmd,
    now
  );

  // Scoped base by organization/branch/physician/procedure
  const matchesEntityScope = (call: AttendanceCallRecord): boolean => {
    if (options.organizationId && call.organizationId !== options.organizationId) return false;
    if (options.branchId && options.branchId !== 'all' && call.branchId !== options.branchId) {
      return false;
    }
    if (
      options.professionalId &&
      options.professionalId !== 'all' &&
      call.professionalId !== options.professionalId
    ) {
      return false;
    }
    if (
      options.procedureName &&
      options.procedureName !== 'all' &&
      call.procedureName !== options.procedureName
    ) {
      return false;
    }
    return true;
  };

  // Options list of distinct procedures from scoped calls
  const procSet = new Set<string>();
  for (const c of attendanceCalls) {
    if (options.organizationId && c.organizationId !== options.organizationId) continue;
    if (options.branchId && options.branchId !== 'all' && c.branchId !== options.branchId) continue;
    if (c.procedureName) procSet.add(c.procedureName);
  }
  const procedureOptions = Array.from(procSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // Strictly ONLY concluded records with valid endedAt & startedAt count toward completed totals & durations
  const completedCalls = attendanceCalls.filter((call) => {
    if (!matchesEntityScope(call)) return false;
    if (call.status !== 'concluido') return false;
    if (!call.endedAt || !call.startedAt) return false;
    return true;
  });

  const getCompletedYmd = (call: AttendanceCallRecord): string =>
    normalizeDateToSaoPauloYmd(call.endedAt) || normalizeDateToSaoPauloYmd(call.attendanceDate);

  let completedToday = 0;
  let completedWeek = 0;
  let completedMonth = 0;
  let completedInSelectedPeriod = 0;

  let durationSumToday = 0;
  let sampleSizeToday = 0;
  let durationSumPeriod = 0;
  let sampleSizePeriod = 0;

  const periodCompletedCalls: Array<{
    call: AttendanceCallRecord;
    ymd: string;
    durationSec: number | null;
  }> = [];

  for (const call of completedCalls) {
    const ymd = getCompletedYmd(call);
    const durSec = getResolvedCallDurationSeconds(call);

    if (ymd === todayYmd) {
      completedToday += 1;
      if (durSec !== null) {
        durationSumToday += durSec;
        sampleSizeToday += 1;
      }
    }
    if (isYmdWithinRange(ymd, weekStartYmd, todayYmd)) {
      completedWeek += 1;
    }
    if (isYmdWithinRange(ymd, currentMonth.start, currentMonth.end)) {
      completedMonth += 1;
    }
    if (isYmdWithinRange(ymd, rangeStartYmd, rangeEndYmd)) {
      completedInSelectedPeriod += 1;
      if (durSec !== null) {
        durationSumPeriod += durSec;
        sampleSizePeriod += 1;
      }
      periodCompletedCalls.push({ call, ymd, durationSec: durSec });
    }
  }

  const inProgressNow = attendanceCalls.filter(
    (c) => matchesEntityScope(c) && c.status === 'em_andamento'
  ).length;

  const waitingQueue = buildEligibleWaitingQueue(appointments, attendanceCalls, {
    organizationId: options.organizationId,
    branchId: options.branchId,
    professionalId: options.professionalId,
    targetDateYmd: todayYmd,
  }).filter((apt) => {
    if (!options.procedureName || options.procedureName === 'all') return true;
    return (apt.serviceName || 'Consulta Médica') === options.procedureName;
  });

  // Chart 1: Daily Series across selected range (capped to max 60 trailing days if custom range is huge)
  const dailyMap = new Map<string, number>();
  for (const item of periodCompletedCalls) {
    dailyMap.set(item.ymd, (dailyMap.get(item.ymd) || 0) + 1);
  }
  const dailySeries: DailyAttendancePoint[] = [];
  let cursor = rangeStartYmd;
  let guard = 0;
  while (cursor <= rangeEndYmd && guard < 90) {
    const [, mm, dd] = cursor.split('-');
    dailySeries.push({
      ymd: cursor,
      label: `${dd}/${mm}`,
      count: dailyMap.get(cursor) || 0,
    });
    cursor = addDaysToYmdSaoPaulo(cursor, 1);
    guard += 1;
  }

  // Chart 2: Weekly comparison (last 6 calendar weeks up to rangeEndYmd or spanning range)
  const weeklyMap = new Map<string, number>();
  for (const call of completedCalls) {
    const ymd = getCompletedYmd(call);
    const mon = getMondayStartYmd(ymd);
    weeklyMap.set(mon, (weeklyMap.get(mon) || 0) + 1);
  }
  const latestMonday = getMondayStartYmd(rangeEndYmd);
  const weeklySeries: PeriodBucketPoint[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const weekMon = addDaysToYmdSaoPaulo(latestMonday, -7 * i);
    const [, mm, dd] = weekMon.split('-');
    weeklySeries.push({
      key: weekMon,
      label: `Sem ${dd}/${mm}`,
      count: weeklyMap.get(weekMon) || 0,
    });
  }

  // Chart 3: Monthly trend (last 6 months up to rangeEndYmd's month)
  const monthlyMap = new Map<string, number>();
  for (const call of completedCalls) {
    const mKey = getMonthKeyFromYmd(getCompletedYmd(call));
    monthlyMap.set(mKey, (monthlyMap.get(mKey) || 0) + 1);
  }
  const endMonthKey = getMonthKeyFromYmd(rangeEndYmd);
  const monthlySeries: PeriodBucketPoint[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const mk = shiftMonthKey(endMonthKey, -i);
    monthlySeries.push({
      key: mk,
      label: formatMonthLabelPtBr(mk),
      count: monthlyMap.get(mk) || 0,
    });
  }

  // Chart 4: Average duration (minutes) by procedure type in selected period
  const procAgg = new Map<string, { sumSec: number; count: number }>();
  for (const item of periodCompletedCalls) {
    if (item.durationSec === null) continue;
    const procName = item.call.procedureName || 'Consulta Médica';
    const cur = procAgg.get(procName) || { sumSec: 0, count: 0 };
    cur.sumSec += item.durationSec;
    cur.count += 1;
    procAgg.set(procName, cur);
  }
  const avgDurationByProcedure: ProcedureDurationMetric[] = Array.from(procAgg.entries())
    .map(([procedureName, stat]) => ({
      procedureName,
      avgMinutes: Number((stat.sumSec / stat.count / 60).toFixed(1)),
      count: stat.count,
    }))
    .sort((a, b) => b.count - a.count || b.avgMinutes - a.avgMinutes);

  // Chart 5: Average duration (minutes) by physician in selected period
  const profAgg = new Map<string, { name: string; sumSec: number; count: number }>();
  for (const item of periodCompletedCalls) {
    if (item.durationSec === null) continue;
    const profId = item.call.professionalId;
    const cur = profAgg.get(profId) || {
      name: item.call.professionalName || 'Médico',
      sumSec: 0,
      count: 0,
    };
    cur.sumSec += item.durationSec;
    cur.count += 1;
    profAgg.set(profId, cur);
  }
  const avgDurationByPhysician: PhysicianDurationMetric[] = Array.from(profAgg.entries())
    .map(([professionalId, stat]) => ({
      professionalId,
      professionalName: stat.name,
      avgMinutes: Number((stat.sumSec / stat.count / 60).toFixed(1)),
      count: stat.count,
    }))
    .sort((a, b) => b.count - a.count || b.avgMinutes - a.avgMinutes);

  return {
    rangeStartYmd,
    rangeEndYmd,
    kpis: {
      completedToday,
      completedWeek,
      completedMonth,
      inProgressNow,
      waitingNow: waitingQueue.length,
      avgDurationSecondsToday:
        sampleSizeToday > 0 ? Math.round(durationSumToday / sampleSizeToday) : null,
      sampleSizeToday,
      avgDurationSecondsPeriod:
        sampleSizePeriod > 0 ? Math.round(durationSumPeriod / sampleSizePeriod) : null,
      sampleSizePeriod,
      completedInSelectedPeriod,
    },
    charts: {
      dailySeries,
      weeklySeries,
      monthlySeries,
      avgDurationByProcedure,
      avgDurationByPhysician,
    },
    procedureOptions,
  };
}
