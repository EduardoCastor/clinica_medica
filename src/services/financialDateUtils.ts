import {
  FinancialComputedStatus,
  FinancialOriginType,
  FinancialPaymentMethod,
  FinancialTransaction,
} from '../types';

export const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';

/**
 * Retorna a data civil atual no fuso oficial America/Sao_Paulo em formato YYYY-MM-DD,
 * evitando deslocamentos de +/- 1 dia causados por UTC midnight.
 */
export function getSaoPauloTodayYmd(referenceDate: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SAO_PAULO_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(referenceDate);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback local
  }

  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const d = String(referenceDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converte YYYY-MM-DD ou ISO timestamp para YYYY-MM-DD respeitando America/Sao_Paulo.
 */
export function normalizeDateToSaoPauloYmd(input?: string | null): string {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const isoPrefixMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z?$/);
  if (isoPrefixMatch) {
    return isoPrefixMatch[1];
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    const ymdFallback = trimmed.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymdFallback) ? ymdFallback : '';
  }
  return getSaoPauloTodayYmd(parsed);
}

/**
 * Formata YYYY-MM-DD (ou ISO) no padrão brasileiro dd/mm/aaaa sem shifts de fuso horário.
 */
export function formatDatePtBr(input?: string | null): string {
  const ymd = normalizeDateToSaoPauloYmd(input);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Converte YYYY-MM-DD em objeto Date UTC meio-dia para exportação Excel sem shift de fuso.
 */
export function ymdToExcelDate(input?: string | null): Date | null {
  const ymd = normalizeDateToSaoPauloYmd(input);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function formatCurrencyPtBr(value: number): string {
  const numeric = Number.isFinite(value) ? value : 0;
  return numeric.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function computeFinancialEffectiveStatus(
  tx: Pick<FinancialTransaction, 'status' | 'dueDate'>,
  todayYmd: string = getSaoPauloTodayYmd()
): FinancialComputedStatus {
  if (tx.status === 'cancelled') return 'cancelled';
  if (tx.status === 'paid') return 'paid';
  const due = normalizeDateToSaoPauloYmd(tx.dueDate);
  if (due && due < todayYmd) {
    return 'overdue';
  }
  return 'pending';
}

export function isYmdWithinRange(
  ymd: string | undefined | null,
  from?: string,
  to?: string
): boolean {
  const normalized = normalizeDateToSaoPauloYmd(ymd);
  if (!normalized) return false;
  if (from && normalized < from) return false;
  if (to && normalized > to) return false;
  return true;
}

export function getMonthStartEndYmd(todayYmd: string = getSaoPauloTodayYmd()): {
  start: string;
  end: string;
} {
  const [y, m] = todayYmd.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${y}-${String(m).padStart(2, '0')}-01`,
    end: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function addDaysToYmdSaoPaulo(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

export const PAYMENT_METHOD_LABELS: Record<FinancialPaymentMethod, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência / TED',
  boleto: 'Boleto Bancário',
};

export const ORIGIN_TYPE_LABELS: Record<FinancialOriginType, string> = {
  appointment: 'Consulta',
  treatment: 'Tratamento',
  manual: 'Manual',
  expense: 'Despesa',
};

export function getFinancialStatusLabel(
  computedStatus: FinancialComputedStatus,
  txType: FinancialTransaction['type']
): string {
  switch (computedStatus) {
    case 'paid':
      return txType === 'receivable' ? 'Recebido' : 'Pago';
    case 'overdue':
      return 'Vencido';
    case 'cancelled':
      return 'Cancelado';
    case 'pending':
    default:
      return 'Pendente';
  }
}

export function normalizeCategoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
