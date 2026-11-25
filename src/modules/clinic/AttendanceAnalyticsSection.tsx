import React, { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Megaphone,
  Stethoscope,
  Timer,
  Users,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { Appointment, AttendanceCallRecord, Professional } from '../../types';
import {
  computeAttendanceAnalytics,
  DashboardAnalyticsPeriod,
  formatDurationHuman,
  formatDurationMinutesLabel,
} from '../../services/attendanceQueueUtils';
import { formatDatePtBr, getSaoPauloTodayYmd, addDaysToYmdSaoPaulo } from '../../services/financialDateUtils';

interface AttendanceAnalyticsSectionProps {
  attendanceCalls: AttendanceCallRecord[];
  appointments: Appointment[];
  professionals: Professional[];
  organizationId: string;
  activeBranchId: string;
  isLoading: boolean;
  loadError?: string;
  canOpenCallPanel: boolean;
  onOpenCallPanel: () => void;
}

const VerticalBarSvg: React.FC<{
  items: Array<{ key: string; label: string; value: number }>;
  barColor: string;
  emptyText: string;
}> = ({ items, barColor, emptyText }) => {
  const total = items.reduce((acc, i) => acc + i.value, 0);
  if (items.length === 0 || total === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-400">
        {emptyText}
      </div>
    );
  }

  const maxVal = Math.max(1, ...items.map((i) => i.value));
  const width = 460;
  const height = 180;
  const padLeft = 28;
  const padRight = 12;
  const padTop = 20;
  const padBottom = 30;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const slotW = chartW / Math.max(1, items.length);
  const barW = Math.min(28, Math.max(6, slotW * 0.62));
  const labelStep = items.length > 14 ? Math.ceil(items.length / 8) : 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
      {[0, 0.5, 1].map((ratio) => {
        const y = padTop + chartH * (1 - ratio);
        const tick = Math.round(maxVal * ratio);
        return (
          <g key={ratio}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <text
              x={padLeft - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#64748b"
              fontFamily="monospace"
            >
              {tick}
            </text>
          </g>
        );
      })}

      {items.map((item, idx) => {
        const barH = (item.value / maxVal) * chartH;
        const x = padLeft + idx * slotW + (slotW - barW) / 2;
        const y = padTop + chartH - barH;
        const showLabel = idx % labelStep === 0 || idx === items.length - 1;
        return (
          <g key={item.key}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(0, barH)}
              rx={4}
              fill={barColor}
            >
              <title>{`${item.label}: ${item.value} atendimento(s)`}</title>
            </rect>
            {item.value > 0 && (items.length <= 14 || item.value === maxVal) && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="#0f172a"
              >
                {item.value}
              </text>
            )}
            {showLabel && (
              <text
                x={x + barW / 2}
                y={height - 10}
                textAnchor="middle"
                fontSize="9"
                fill="#64748b"
              >
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

const LineTrendSvg: React.FC<{
  items: Array<{ key: string; label: string; value: number }>;
  emptyText: string;
}> = ({ items, emptyText }) => {
  const total = items.reduce((acc, i) => acc + i.value, 0);
  if (items.length === 0 || total === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-400">
        {emptyText}
      </div>
    );
  }

  const maxVal = Math.max(1, ...items.map((i) => i.value));
  const width = 460;
  const height = 180;
  const padLeft = 28;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 30;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const coords = items.map((item, idx) => {
    const x =
      items.length === 1
        ? padLeft + chartW / 2
        : padLeft + (idx / (items.length - 1)) * chartW;
    const y = padTop + chartH - (item.value / maxVal) * chartH;
    return { ...item, x, y };
  });

  const linePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${padLeft},${padTop + chartH} ${linePoints} ${
    coords[coords.length - 1].x
  },${padTop + chartH}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
      {[0, 0.5, 1].map((ratio) => {
        const y = padTop + chartH * (1 - ratio);
        return (
          <g key={ratio}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <text
              x={padLeft - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#64748b"
              fontFamily="monospace"
            >
              {Math.round(maxVal * ratio)}
            </text>
          </g>
        );
      })}

      <polygon points={areaPoints} fill="#0284c7" fillOpacity="0.12" />
      <polyline
        fill="none"
        stroke="#0284c7"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={linePoints}
      />

      {coords.map((pt) => (
        <g key={pt.key}>
          <circle cx={pt.x} cy={pt.y} r="4" fill="#ffffff" stroke="#0284c7" strokeWidth="2">
            <title>{`${pt.label}: ${pt.value} atendimentos`}</title>
          </circle>
          <text
            x={pt.x}
            y={pt.y - 8}
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill="#0f172a"
          >
            {pt.value}
          </text>
          <text x={pt.x} y={height - 10} textAnchor="middle" fontSize="9" fill="#64748b">
            {pt.label}
          </text>
        </g>
      ))}
    </svg>
  );
};

const HorizontalDurationBars: React.FC<{
  items: Array<{ label: string; avgMinutes: number; count: number }>;
  barColorClass: string;
  emptyText: string;
}> = ({ items, barColorClass, emptyText }) => {
  if (items.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-400">
        {emptyText}
      </div>
    );
  }

  const maxMin = Math.max(1, ...items.map((i) => i.avgMinutes));

  return (
    <div className="space-y-3 py-1">
      {items.slice(0, 6).map((item) => {
        const pct = Math.max(6, Math.round((item.avgMinutes / maxMin) * 100));
        return (
          <div key={item.label} className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800 truncate">{item.label}</span>
              <span className="font-mono font-bold text-slate-700 shrink-0">
                {item.avgMinutes.toFixed(1).replace('.', ',')} min{' '}
                <span className="text-[10px] font-normal text-slate-500">
                  ({item.count} {item.count === 1 ? 'consulta' : 'consultas'})
                </span>
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${barColorClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const AttendanceAnalyticsSection: React.FC<AttendanceAnalyticsSectionProps> = ({
  attendanceCalls,
  appointments,
  professionals,
  organizationId,
  activeBranchId,
  isLoading,
  loadError,
  canOpenCallPanel,
  onOpenCallPanel,
}) => {
  const todayYmd = getSaoPauloTodayYmd();
  const [period, setPeriod] = useState<DashboardAnalyticsPeriod>('30d');
  const [customStartYmd, setCustomStartYmd] = useState(() => addDaysToYmdSaoPaulo(todayYmd, -29));
  const [customEndYmd, setCustomEndYmd] = useState(todayYmd);
  const [professionalFilter, setProfessionalFilter] = useState<string>('all');
  const [procedureFilter, setProcedureFilter] = useState<string>('all');

  const analytics = useMemo(
    () =>
      computeAttendanceAnalytics(attendanceCalls, appointments, {
        organizationId,
        branchId: activeBranchId,
        period,
        customStartYmd,
        customEndYmd,
        professionalId: professionalFilter,
        procedureName: procedureFilter,
      }),
    [
      attendanceCalls,
      appointments,
      organizationId,
      activeBranchId,
      period,
      customStartYmd,
      customEndYmd,
      professionalFilter,
      procedureFilter,
    ]
  );

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-extrabold text-slate-900">
              Indicadores Gerenciais de Chamada e Atendimentos
            </h2>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Contagem e duração média calculadas exclusivamente sobre atendimentos concluídos (
            {formatDatePtBr(analytics.rangeStartYmd)} a {formatDatePtBr(analytics.rangeEndYmd)}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Período das métricas de atendimento"
            value={period}
            onChange={(e) => setPeriod(e.target.value as DashboardAnalyticsPeriod)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="this_month">Este Mês</option>
            <option value="last_month">Mês Anterior</option>
            <option value="custom">Personalizado</option>
          </select>

          {period === 'custom' && (
            <>
              <input
                type="date"
                aria-label="Data inicial"
                value={customStartYmd}
                onChange={(e) => setCustomStartYmd(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
              />
              <span className="text-xs text-slate-400">até</span>
              <input
                type="date"
                aria-label="Data final"
                value={customEndYmd}
                onChange={(e) => setCustomEndYmd(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
              />
            </>
          )}

          <select
            aria-label="Filtrar indicadores por médico"
            value={professionalFilter}
            onChange={(e) => setProfessionalFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todos os Médicos</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar indicadores por procedimento"
            value={procedureFilter}
            onChange={(e) => setProcedureFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Todos os Procedimentos</option>
            {analytics.procedureOptions.map((proc) => (
              <option key={proc} value={proc}>
                {proc}
              </option>
            ))}
          </select>

          {canOpenCallPanel && (
            <button
              type="button"
              onClick={onOpenCallPanel}
              className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition inline-flex items-center gap-1.5"
            >
              <Megaphone className="w-3.5 h-3.5" />
              <span>Abrir Painel</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>Indicadores de Atendimento: {loadError}</span>
        </div>
      )}

      {/* 7 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>Atendidos Hoje</span>
            <Activity className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : analytics.kpis.completedToday}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">concluídos hoje</p>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>Na Semana</span>
            <Activity className="w-3.5 h-3.5 text-sky-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : analytics.kpis.completedWeek}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">últimos 7 dias</p>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>No Mês</span>
            <BarChart3 className="w-3.5 h-3.5 text-sky-700" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : analytics.kpis.completedMonth}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">mês corrente</p>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-emerald-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700">
            <span>Em Atendimento</span>
            <Stethoscope className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-emerald-700 tabular-nums">
            {isLoading ? '—' : analytics.kpis.inProgressNow}
          </div>
          <p className="text-[10px] text-emerald-700 mt-0.5">consultórios ativos</p>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-amber-800">
            <span>Na Fila Hoje</span>
            <Users className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-amber-700 tabular-nums">
            {isLoading ? '—' : analytics.kpis.waitingNow}
          </div>
          <p className="text-[10px] text-amber-700 mt-0.5">aguardando chamada</p>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>Média Hoje</span>
            <Timer className="w-3.5 h-3.5 text-sky-600" />
          </div>
          <div className="mt-1.5 text-lg font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : formatDurationMinutesLabel(analytics.kpis.avgDurationSecondsToday)}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {analytics.kpis.sampleSizeToday > 0
              ? `${formatDurationHuman(analytics.kpis.avgDurationSecondsToday)} (${analytics.kpis.sampleSizeToday} reg.)`
              : 'Sem amostra hoje'}
          </p>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>Média Período</span>
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="mt-1.5 text-lg font-extrabold text-slate-900 tabular-nums">
            {isLoading ? '—' : formatDurationMinutesLabel(analytics.kpis.avgDurationSecondsPeriod)}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {analytics.kpis.sampleSizePeriod > 0
              ? `n = ${analytics.kpis.sampleSizePeriod} concluído(s)`
              : 'Sem amostra no filtro'}
          </p>
        </div>
      </div>

      {/* 5 Gráficos Gerenciais (SVG Responsivo) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-2">
          <h3 className="text-xs font-extrabold text-slate-900">
            Atendimentos Concluídos por Dia
          </h3>
          <VerticalBarSvg
            items={analytics.charts.dailySeries.map((d) => ({
              key: d.ymd,
              label: d.label,
              value: d.count,
            }))}
            barColor="#0284c7"
            emptyText="Sem atendimentos concluídos neste intervalo."
          />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-2">
          <h3 className="text-xs font-extrabold text-slate-900">
            Comparativo Semanal (Últimas 6 Semanas)
          </h3>
          <VerticalBarSvg
            items={analytics.charts.weeklySeries.map((w) => ({
              key: w.key,
              label: w.label,
              value: w.count,
            }))}
            barColor="#059669"
            emptyText="Sem atendimentos semanais concluídos."
          />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-2">
          <h3 className="text-xs font-extrabold text-slate-900">
            Tendência Mensal (Últimos 6 Meses)
          </h3>
          <LineTrendSvg
            items={analytics.charts.monthlySeries.map((m) => ({
              key: m.key,
              label: m.label,
              value: m.count,
            }))}
            emptyText="Sem atendimentos mensais registrados."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold text-slate-900">
              Duração Média por Tipo de Procedimento (min)
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">
              Apenas concluídos
            </span>
          </div>
          <HorizontalDurationBars
            items={analytics.charts.avgDurationByProcedure.map((p) => ({
              label: p.procedureName,
              avgMinutes: p.avgMinutes,
              count: p.count,
            }))}
            barColorClass="bg-sky-600"
            emptyText="Nenhum atendimento concluído com duração registrada no período."
          />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold text-slate-900">
              Duração Média por Médico (min)
            </h3>
            <span className="text-[10px] font-semibold text-slate-400">
              Apenas concluídos
            </span>
          </div>
          <HorizontalDurationBars
            items={analytics.charts.avgDurationByPhysician.map((m) => ({
              label: m.professionalName,
              avgMinutes: m.avgMinutes,
              count: m.count,
            }))}
            barColorClass="bg-emerald-600"
            emptyText="Nenhum atendimento concluído por médico no período."
          />
        </div>
      </div>
    </div>
  );
};
