import {
  AttendanceCallEvent,
  AttendanceCallEventType,
  AttendanceCallRecord,
  AttendanceCallStatus,
  AttendanceOrigin,
  CallPanelSettings,
  PatientNameDisplayMode,
} from '../types';
import { getSupabase } from './supabaseClient';
import { normalizeDateToSaoPauloYmd } from './financialDateUtils';

const isUuid = (val?: string | null): val is string =>
  Boolean(
    val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim())
  );

export interface CallPanelRpcResult {
  success: boolean;
  code?: string;
  error?: string;
  eventType?: AttendanceCallEventType;
  alreadyStarted?: boolean;
  remainingSeconds?: number;
  attendance?: AttendanceCallRecord;
  autoClosedAttendance?: AttendanceCallRecord;
  activeAttendance?: AttendanceCallRecord;
}

export interface CallPanelCloudSnapshot {
  calls: AttendanceCallRecord[];
  events: AttendanceCallEvent[];
  settings: CallPanelSettings | null;
  error?: string;
}

export function mapAttendanceCallRow(row: Record<string, unknown>): AttendanceCallRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    branchId: String(row.branch_id),
    appointmentId: String(row.appointment_id),
    patientId: String(row.patient_id),
    professionalId: String(row.professional_id),
    roomId: row.room_id ? String(row.room_id) : undefined,
    serviceId: row.service_id ? String(row.service_id) : undefined,
    patientName: String(row.patient_name_snapshot || 'Paciente'),
    professionalName: String(row.professional_name_snapshot || 'Médico'),
    roomName: String(row.room_name_snapshot || 'Consultório 01'),
    procedureName: String(row.procedure_name_snapshot || 'Consulta Médica'),
    attendanceDate: normalizeDateToSaoPauloYmd(
      row.attendance_date ? String(row.attendance_date) : String(row.created_at || '')
    ),
    status: String(row.status || 'aguardando') as AttendanceCallStatus,
    calledAt: row.called_at ? String(row.called_at) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
    durationSeconds:
      row.duration_seconds !== null && row.duration_seconds !== undefined
        ? Number(row.duration_seconds)
        : undefined,
    startOrigin: row.start_origin ? (String(row.start_origin) as AttendanceOrigin) : undefined,
    endOrigin: row.end_origin ? (String(row.end_origin) as AttendanceOrigin) : undefined,
    autoEndReason: row.auto_end_reason ? String(row.auto_end_reason) : undefined,
    callCount: Number(row.call_count ?? 0),
    autoStartDelaySeconds: Number(row.auto_start_delay_seconds ?? 120),
    lastCalledBy: row.last_called_by ? String(row.last_called_by) : undefined,
    startedBy: row.started_by ? String(row.started_by) : undefined,
    endedBy: row.ended_by ? String(row.ended_by) : undefined,
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : undefined,
    cancellationReason: row.cancellation_reason ? String(row.cancellation_reason) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function mapAttendanceCallEventRow(row: Record<string, unknown>): AttendanceCallEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    branchId: String(row.branch_id),
    attendanceCallId: String(row.attendance_call_id),
    appointmentId: String(row.appointment_id),
    patientId: String(row.patient_id),
    professionalId: String(row.professional_id),
    roomId: row.room_id ? String(row.room_id) : undefined,
    patientName: String(row.patient_name || 'Paciente'),
    professionalName: String(row.professional_name || 'Médico'),
    roomName: String(row.room_name || 'Consultório 01'),
    procedureName: String(row.procedure_name || 'Consulta Médica'),
    eventType: String(row.event_type || 'called') as AttendanceCallEventType,
    actorUserProfileId: row.actor_user_profile_id ? String(row.actor_user_profile_id) : undefined,
    actorName: row.actor_name ? String(row.actor_name) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

export function mapCallPanelSettingsRow(row: Record<string, unknown>): CallPanelSettings {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    branchId: row.branch_id ? String(row.branch_id) : null,
    defaultProfessionalId: row.default_professional_id ? String(row.default_professional_id) : undefined,
    defaultRoomId: row.default_room_id ? String(row.default_room_id) : undefined,
    physicianDisplayLabel: row.physician_display_label ? String(row.physician_display_label) : undefined,
    soundEnabled: row.sound_enabled !== false,
    voiceEnabled: row.voice_enabled !== false,
    chimeVolume:
      row.chime_volume !== null && row.chime_volume !== undefined
        ? Math.max(0, Math.min(1, Number(row.chime_volume)))
        : 0.7,
    autoStartDelaySeconds:
      row.auto_start_delay_seconds !== null && row.auto_start_delay_seconds !== undefined
        ? Number(row.auto_start_delay_seconds)
        : 120,
    patientNameDisplayMode: String(
      row.patient_name_display_mode || 'full'
    ) as PatientNameDisplayMode,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function getDefaultCallPanelSettings(
  organizationId: string,
  branchId?: string | null
): CallPanelSettings {
  return {
    organizationId,
    branchId: branchId && branchId !== 'all' ? branchId : null,
    soundEnabled: true,
    voiceEnabled: true,
    chimeVolume: 0.7,
    autoStartDelaySeconds: 120,
    patientNameDisplayMode: 'full',
  };
}

export const AttendanceCloudService = {
  fetchCallPanelSnapshot: async (
    organizationId?: string,
    branchId?: string
  ): Promise<CallPanelCloudSnapshot> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        calls: [],
        events: [],
        settings: organizationId ? getDefaultCallPanelSettings(organizationId, branchId) : null,
        error: 'Supabase não configurado neste ambiente.',
      };
    }

    if (!isUuid(organizationId)) {
      return {
        calls: [],
        events: [],
        settings: null,
        error: 'Organização ativa inválida para consultar o painel de chamada.',
      };
    }

    try {
      let callsQuery = supabase
        .from('attendance_calls')
        .select('*')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(1000);

      let eventsQuery = supabase
        .from('attendance_call_events')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (branchId && branchId !== 'all' && isUuid(branchId)) {
        callsQuery = callsQuery.eq('branch_id', branchId);
        eventsQuery = eventsQuery.eq('branch_id', branchId);
      }

      const settingsQuery = supabase
        .from('call_panel_settings')
        .select('*')
        .eq('organization_id', organizationId);

      const [callsRes, eventsRes, settingsRes] = await Promise.all([
        callsQuery,
        eventsQuery,
        settingsQuery,
      ]);

      const errors: string[] = [];
      if (callsRes.error) errors.push(callsRes.error.message);
      if (eventsRes.error) errors.push(eventsRes.error.message);
      if (settingsRes.error) errors.push(settingsRes.error.message);

      const calls = Array.isArray(callsRes.data)
        ? (callsRes.data as Array<Record<string, unknown>>).map(mapAttendanceCallRow)
        : [];
      const events = Array.isArray(eventsRes.data)
        ? (eventsRes.data as Array<Record<string, unknown>>).map(mapAttendanceCallEventRow)
        : [];

      const settingsRows = Array.isArray(settingsRes.data)
        ? (settingsRes.data as Array<Record<string, unknown>>).map(mapCallPanelSettingsRow)
        : [];

      const targetBranch = branchId && branchId !== 'all' && isUuid(branchId) ? branchId : null;
      const matchedSettings =
        (targetBranch ? settingsRows.find((s) => s.branchId === targetBranch) : undefined) ||
        settingsRows.find((s) => !s.branchId) ||
        getDefaultCallPanelSettings(organizationId, targetBranch);

      return {
        calls,
        events,
        settings: matchedSettings,
        error: errors.length > 0 ? errors.join(' · ') : undefined,
      };
    } catch (err) {
      return {
        calls: [],
        events: [],
        settings: organizationId ? getDefaultCallPanelSettings(organizationId, branchId) : null,
        error: err instanceof Error ? err.message : 'Erro ao consultar painel de chamada no Supabase.',
      };
    }
  },

  fetchAttendanceCallsForDashboard: async (
    organizationId?: string,
    branchId?: string
  ): Promise<{ calls: AttendanceCallRecord[]; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { calls: [], error: 'Supabase não configurado neste ambiente.' };
    }
    if (!isUuid(organizationId)) {
      return { calls: [], error: 'Organização ativa inválida para indicadores de atendimento.' };
    }

    try {
      let query = supabase
        .from('attendance_calls')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(2000);

      if (branchId && branchId !== 'all' && isUuid(branchId)) {
        query = query.eq('branch_id', branchId);
      }

      const { data, error } = await query;
      if (error) {
        return { calls: [], error: error.message };
      }
      const calls = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>).map(mapAttendanceCallRow)
        : [];
      return { calls };
    } catch (err) {
      return {
        calls: [],
        error: err instanceof Error ? err.message : 'Erro ao carregar indicadores de atendimento.',
      };
    }
  },

  callPatientRpc: async (params: {
    organizationId: string;
    branchId?: string | null;
    professionalId?: string | null;
    roomId?: string | null;
    appointmentId?: string | null;
    confirmAutoClose?: boolean;
    allowRecall?: boolean;
  }): Promise<CallPanelRpcResult> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase não configurado neste ambiente.' };
    }

    const { data, error } = await supabase.rpc('medsync_call_panel_call_patient', {
      p_organization_id: params.organizationId,
      p_branch_id: params.branchId && params.branchId !== 'all' ? params.branchId : null,
      p_professional_id: params.professionalId || null,
      p_room_id: params.roomId || null,
      p_appointment_id: params.appointmentId || null,
      p_confirm_auto_close: Boolean(params.confirmAutoClose),
      p_allow_recall: Boolean(params.allowRecall),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const payload = (data || {}) as Record<string, unknown>;
    return {
      success: Boolean(payload.success),
      code: payload.code ? String(payload.code) : undefined,
      error: payload.error ? String(payload.error) : undefined,
      eventType: payload.event_type ? (String(payload.event_type) as AttendanceCallEventType) : undefined,
      attendance: payload.attendance
        ? mapAttendanceCallRow(payload.attendance as Record<string, unknown>)
        : undefined,
      autoClosedAttendance: payload.auto_closed_attendance
        ? mapAttendanceCallRow(payload.auto_closed_attendance as Record<string, unknown>)
        : undefined,
      activeAttendance: payload.active_attendance
        ? mapAttendanceCallRow(payload.active_attendance as Record<string, unknown>)
        : undefined,
    };
  },

  startAttendanceRpc: async (
    attendanceCallId: string,
    origin: AttendanceOrigin = 'manual'
  ): Promise<CallPanelRpcResult> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase não configurado neste ambiente.' };
    }

    const { data, error } = await supabase.rpc('medsync_call_panel_start_attendance', {
      p_attendance_call_id: attendanceCallId,
      p_origin: origin,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const payload = (data || {}) as Record<string, unknown>;
    return {
      success: Boolean(payload.success),
      code: payload.code ? String(payload.code) : undefined,
      error: payload.error ? String(payload.error) : undefined,
      alreadyStarted: Boolean(payload.already_started),
      remainingSeconds:
        payload.remaining_seconds !== undefined ? Number(payload.remaining_seconds) : undefined,
      attendance: payload.attendance
        ? mapAttendanceCallRow(payload.attendance as Record<string, unknown>)
        : undefined,
    };
  },

  completeAttendanceRpc: async (attendanceCallId: string): Promise<CallPanelRpcResult> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase não configurado neste ambiente.' };
    }

    const { data, error } = await supabase.rpc('medsync_call_panel_complete_attendance', {
      p_attendance_call_id: attendanceCallId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const payload = (data || {}) as Record<string, unknown>;
    return {
      success: Boolean(payload.success),
      code: payload.code ? String(payload.code) : undefined,
      error: payload.error ? String(payload.error) : undefined,
      attendance: payload.attendance
        ? mapAttendanceCallRow(payload.attendance as Record<string, unknown>)
        : undefined,
    };
  },

  cancelAttendanceRpc: async (
    attendanceCallId: string,
    reason?: string
  ): Promise<CallPanelRpcResult> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase não configurado neste ambiente.' };
    }

    const { data, error } = await supabase.rpc('medsync_call_panel_cancel_attendance', {
      p_attendance_call_id: attendanceCallId,
      p_reason: reason || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const payload = (data || {}) as Record<string, unknown>;
    return {
      success: Boolean(payload.success),
      code: payload.code ? String(payload.code) : undefined,
      error: payload.error ? String(payload.error) : undefined,
      attendance: payload.attendance
        ? mapAttendanceCallRow(payload.attendance as Record<string, unknown>)
        : undefined,
    };
  },

  saveCallPanelSettings: async (
    settings: CallPanelSettings
  ): Promise<{ success: boolean; settings?: CallPanelSettings; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase não configurado neste ambiente.' };
    }
    if (!isUuid(settings.organizationId)) {
      return { success: false, error: 'Organização inválida para salvar configurações do painel.' };
    }

    const normalizedBranchId =
      settings.branchId && settings.branchId !== 'all' && isUuid(settings.branchId)
        ? settings.branchId
        : null;

    try {
      let existingQuery = supabase
        .from('call_panel_settings')
        .select('id')
        .eq('organization_id', settings.organizationId);

      existingQuery = normalizedBranchId
        ? existingQuery.eq('branch_id', normalizedBranchId)
        : existingQuery.is('branch_id', null);

      const { data: existingRow, error: lookupErr } = await existingQuery.maybeSingle();
      if (lookupErr) {
        return { success: false, error: lookupErr.message };
      }

      const dbPayload: Record<string, unknown> = {
        organization_id: settings.organizationId,
        branch_id: normalizedBranchId,
        default_professional_id: isUuid(settings.defaultProfessionalId)
          ? settings.defaultProfessionalId
          : null,
        default_room_id: isUuid(settings.defaultRoomId) ? settings.defaultRoomId : null,
        physician_display_label: settings.physicianDisplayLabel?.trim() || null,
        sound_enabled: Boolean(settings.soundEnabled),
        voice_enabled: Boolean(settings.voiceEnabled),
        chime_volume: Math.max(0, Math.min(1, Number(settings.chimeVolume ?? 0.7))),
        auto_start_delay_seconds: Math.max(
          15,
          Math.min(1800, Math.round(Number(settings.autoStartDelaySeconds ?? 120)))
        ),
        patient_name_display_mode: settings.patientNameDisplayMode || 'full',
      };

      const mutation = existingRow?.id
        ? supabase
            .from('call_panel_settings')
            .update(dbPayload)
            .eq('id', existingRow.id)
            .select('*')
            .single()
        : supabase
            .from('call_panel_settings')
            .insert(dbPayload)
            .select('*')
            .single();

      const { data, error } = await mutation;
      if (error || !data) {
        return { success: false, error: error?.message || 'Erro ao salvar configurações do painel.' };
      }

      return {
        success: true,
        settings: mapCallPanelSettingsRow(data as Record<string, unknown>),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao salvar configurações do painel.',
      };
    }
  },
};
