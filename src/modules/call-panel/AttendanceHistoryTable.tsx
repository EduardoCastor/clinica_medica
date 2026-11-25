import React, { useMemo, useState } from 'react';
import { History, Search, Clock } from 'lucide-react';
import { AttendanceCallEvent, AttendanceCallEventType, AttendanceCallRecord } from '../../types';
import { formatDurationHuman, formatTimeWithSecondsSaoPaulo } from '../../services/attendanceQueueUtils';
import { formatDatePtBr, normalizeDateToSaoPauloYmd } from '../../services/financialDateUtils';

interface AttendanceHistoryTableProps {
  events: AttendanceCallEvent[];
  calls: AttendanceCallRecord[];
}

const EVENT_BADGE_MAP: Record<
  AttendanceCallEventType,
  { label: string; className: string }
> = {
  called: {
    label: 'Chamado',
    className: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  recalled: {
    label: 'Rechamada',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  started_manual: {
    label: 'Início Manual',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  started_auto: {
    label: 'Início Automático',
    className: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  completed_manual: {
    label: 'Concluído (Manual)',
    className: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  completed_auto: {
    label: 'Encerrado (Nova Chamada)',
    className: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  cancelled: {
    label: 'Cancelado',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  },
};

export const AttendanceHistoryTable: React.FC<AttendanceHistoryTableProps> = ({
  events,
  calls,
}) => {
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState<'all' | AttendanceCallEventType>('all');

  const callById = useMemo(() => {
    const map = new Map<string, AttendanceCallRecord>();
    for (const c of calls) {
      map.set(c.id, c);
    }
    return map;
  }, [calls]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (eventFilter !== 'all' && ev.eventType !== eventFilter) return false;
      if (!term) return true;
      return (
        ev.patientName.toLowerCase().includes(term) ||
        ev.professionalName.toLowerCase().includes(term) ||
        ev.roomName.toLowerCase().includes(term) ||
        ev.procedureName.toLowerCase().includes(term)
      );
    });
  }, [events, eventFilter, search]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-sky-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Histórico Auditável de Chamadas e Atendimentos ({filteredEvents.length})
            </h3>
            <p className="text-[11px] text-slate-500">
              Registro cronológico real de chamadas, rechamadas, inícios manuais/automáticos e conclusões.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar paciente, médico ou sala..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as 'all' | AttendanceCallEventType)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todos os eventos</option>
            <option value="called">Chamado</option>
            <option value="recalled">Rechamada</option>
            <option value="started_manual">Início Manual</option>
            <option value="started_auto">Início Automático</option>
            <option value="completed_manual">Concluído (Manual)</option>
            <option value="completed_auto">Encerrado (Nova Chamada)</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          Nenhum evento de chamada ou atendimento registrado para os filtros atuais.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-4">Data / Hora</th>
                <th className="py-2.5 px-4">Evento</th>
                <th className="py-2.5 px-4">Paciente</th>
                <th className="py-2.5 px-4">Médico / Sala</th>
                <th className="py-2.5 px-4">Procedimento</th>
                <th className="py-2.5 px-4">Duração</th>
                <th className="py-2.5 px-4">Operador / Observação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEvents.map((ev) => {
                const badge = EVENT_BADGE_MAP[ev.eventType] || EVENT_BADGE_MAP.called;
                const call = callById.get(ev.attendanceCallId);
                const isCompletion =
                  ev.eventType === 'completed_manual' || ev.eventType === 'completed_auto';
                const dateLabel = formatDatePtBr(normalizeDateToSaoPauloYmd(ev.createdAt));
                const timeLabel = formatTimeWithSecondsSaoPaulo(ev.createdAt);

                return (
                  <tr key={ev.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-slate-700">
                      <div>{dateLabel}</div>
                      <div className="text-slate-500">{timeLabel}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">{ev.patientName}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{ev.professionalName}</div>
                      <div className="text-[11px] text-slate-500">{ev.roomName}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{ev.procedureName}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {isCompletion && call?.durationSeconds !== undefined ? (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                          <Clock className="w-3 h-3" />
                          <span>{formatDurationHuman(call.durationSeconds)}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-600">
                      {ev.actorName && (
                        <span className="font-semibold text-slate-800">{ev.actorName} · </span>
                      )}
                      <span>{ev.notes || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
