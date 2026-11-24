import ExcelJS from 'exceljs';
import { FinancialTransaction } from '../types';
import {
  ORIGIN_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  computeFinancialEffectiveStatus,
  getFinancialStatusLabel,
  getSaoPauloTodayYmd,
  ymdToExcelDate,
} from './financialDateUtils';

function safeExcelText(value?: string | null): string {
  if (!value) return '';
  const text = String(value).trim();
  if (/^[=+\-@]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

function getTxCode(tx: FinancialTransaction): string {
  return tx.receiptNumber?.trim() || tx.id.slice(0, 8).toUpperCase();
}

function styleHeaderRow(row: ExcelJS.Row, bgArgb: string) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgArgb },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
}

function autoFitSheetColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns?.forEach((column) => {
    if (!column || typeof column.eachCell !== 'function') return;
    let maxLen = 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const val = cell.value;
      let textLen = 0;
      if (val instanceof Date) {
        textLen = 12;
      } else if (typeof val === 'number') {
        textLen = `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`.length + 2;
      } else if (val !== null && val !== undefined) {
        textLen = String(val).length;
      }
      if (textLen + 3 > maxLen) {
        maxLen = textLen + 3;
      }
    });
    column.width = Math.min(Math.max(maxLen, 13), 46);
  });
}

function buildReceivablesWorksheet(
  workbook: ExcelJS.Workbook,
  receivables: FinancialTransaction[],
  todayYmd: string
) {
  const sheet = workbook.addWorksheet('Contas a Receber', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'ID / Código', key: 'code' },
    { header: 'Data de Emissão', key: 'issueDate' },
    { header: 'Data de Vencimento', key: 'dueDate' },
    { header: 'Data de Recebimento', key: 'paymentDate' },
    { header: 'Descrição', key: 'description' },
    { header: 'Categoria', key: 'category' },
    { header: 'Origem', key: 'origin' },
    { header: 'Paciente', key: 'patient' },
    { header: 'Profissional', key: 'professional' },
    { header: 'Unidade / Filial', key: 'branch' },
    { header: 'Forma de Pagamento', key: 'paymentMethod' },
    { header: 'Valor', key: 'amount' },
    { header: 'Situação', key: 'status' },
    { header: 'Observações', key: 'notes' },
  ];

  styleHeaderRow(sheet.getRow(1), 'FF0369A1');

  let totalAmount = 0;

  for (const tx of receivables) {
    const computedStatus = computeFinancialEffectiveStatus(tx, todayYmd);
    const issueDt = ymdToExcelDate(tx.issueDate || tx.createdAt);
    const dueDt = ymdToExcelDate(tx.dueDate);
    const payDt = tx.status === 'paid' ? ymdToExcelDate(tx.paymentDate || tx.paidAt) : null;
    const numericAmount = Number(tx.amount || 0);
    if (computedStatus !== 'cancelled') {
      totalAmount += numericAmount;
    }

    const row = sheet.addRow({
      code: safeExcelText(getTxCode(tx)),
      issueDate: issueDt || '',
      dueDate: dueDt || '',
      paymentDate: payDt || '',
      description: safeExcelText(tx.description),
      category: safeExcelText(tx.categoryName || 'Outras Receitas'),
      origin: safeExcelText(
        ORIGIN_TYPE_LABELS[tx.originType || (tx.appointmentId ? 'appointment' : 'manual')]
      ),
      patient: safeExcelText(tx.patientName || 'Não informado'),
      professional: safeExcelText(tx.professionalName || 'Clínica'),
      branch: safeExcelText(tx.branchName || 'Unidade'),
      paymentMethod: safeExcelText(PAYMENT_METHOD_LABELS[tx.paymentMethod] || tx.paymentMethod),
      amount: numericAmount,
      status: safeExcelText(getFinancialStatusLabel(computedStatus, 'receivable')),
      notes: safeExcelText(tx.cancellationReason || tx.notes || ''),
    });

    if (issueDt) row.getCell('issueDate').numFmt = 'dd/mm/yyyy';
    if (dueDt) row.getCell('dueDate').numFmt = 'dd/mm/yyyy';
    if (payDt) row.getCell('paymentDate').numFmt = 'dd/mm/yyyy';
    const amountCell = row.getCell('amount');
    amountCell.numFmt = '"R$" #,##0.00';
    amountCell.alignment = { horizontal: 'right' };

    if (computedStatus === 'overdue') {
      row.getCell('status').font = { bold: true, color: { argb: 'FFB91C1C' } };
    } else if (computedStatus === 'paid') {
      row.getCell('status').font = { bold: true, color: { argb: 'FF047857' } };
    } else if (computedStatus === 'cancelled') {
      row.getCell('status').font = { color: { argb: 'FF64748B' } };
    }
  }

  const totalRow = sheet.addRow({
    code: 'TOTAL ATIVO',
    description: `${receivables.filter((t) => t.status !== 'cancelled').length} lançamento(s) ativo(s)`,
    amount: totalAmount,
  });
  totalRow.font = { bold: true };
  totalRow.getCell('amount').numFmt = '"R$" #,##0.00';
  totalRow.getCell('amount').alignment = { horizontal: 'right' };
  totalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });

  autoFitSheetColumns(sheet);
}

function buildPayablesWorksheet(
  workbook: ExcelJS.Workbook,
  payables: FinancialTransaction[],
  todayYmd: string
) {
  const sheet = workbook.addWorksheet('Contas a Pagar', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'ID / Código', key: 'code' },
    { header: 'Data de Emissão', key: 'issueDate' },
    { header: 'Data de Vencimento', key: 'dueDate' },
    { header: 'Data de Pagamento', key: 'paymentDate' },
    { header: 'Descrição', key: 'description' },
    { header: 'Categoria', key: 'category' },
    { header: 'Fornecedor / Favorecido', key: 'supplier' },
    { header: 'Unidade / Filial', key: 'branch' },
    { header: 'Forma de Pagamento', key: 'paymentMethod' },
    { header: 'Valor', key: 'amount' },
    { header: 'Situação', key: 'status' },
    { header: 'Observações', key: 'notes' },
  ];

  styleHeaderRow(sheet.getRow(1), 'FF0F172A');

  let totalAmount = 0;

  for (const tx of payables) {
    const computedStatus = computeFinancialEffectiveStatus(tx, todayYmd);
    const issueDt = ymdToExcelDate(tx.issueDate || tx.createdAt);
    const dueDt = ymdToExcelDate(tx.dueDate);
    const payDt = tx.status === 'paid' ? ymdToExcelDate(tx.paymentDate || tx.paidAt) : null;
    const numericAmount = Number(tx.amount || 0);
    if (computedStatus !== 'cancelled') {
      totalAmount += numericAmount;
    }

    const row = sheet.addRow({
      code: safeExcelText(getTxCode(tx)),
      issueDate: issueDt || '',
      dueDate: dueDt || '',
      paymentDate: payDt || '',
      description: safeExcelText(tx.description),
      category: safeExcelText(tx.categoryName || 'Outras despesas'),
      supplier: safeExcelText(tx.supplierName || 'Não informado'),
      branch: safeExcelText(tx.branchName || 'Unidade'),
      paymentMethod: safeExcelText(PAYMENT_METHOD_LABELS[tx.paymentMethod] || tx.paymentMethod),
      amount: numericAmount,
      status: safeExcelText(getFinancialStatusLabel(computedStatus, 'payable')),
      notes: safeExcelText(tx.cancellationReason || tx.notes || ''),
    });

    if (issueDt) row.getCell('issueDate').numFmt = 'dd/mm/yyyy';
    if (dueDt) row.getCell('dueDate').numFmt = 'dd/mm/yyyy';
    if (payDt) row.getCell('paymentDate').numFmt = 'dd/mm/yyyy';
    const amountCell = row.getCell('amount');
    amountCell.numFmt = '"R$" #,##0.00';
    amountCell.alignment = { horizontal: 'right' };

    if (computedStatus === 'overdue') {
      row.getCell('status').font = { bold: true, color: { argb: 'FFB91C1C' } };
    } else if (computedStatus === 'paid') {
      row.getCell('status').font = { bold: true, color: { argb: 'FF047857' } };
    } else if (computedStatus === 'cancelled') {
      row.getCell('status').font = { color: { argb: 'FF64748B' } };
    }
  }

  const totalRow = sheet.addRow({
    code: 'TOTAL ATIVO',
    description: `${payables.filter((t) => t.status !== 'cancelled').length} despesa(s) ativa(s)`,
    amount: totalAmount,
  });
  totalRow.font = { bold: true };
  totalRow.getCell('amount').numFmt = '"R$" #,##0.00';
  totalRow.getCell('amount').alignment = { horizontal: 'right' };
  totalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });

  autoFitSheetColumns(sheet);
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, fileName: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportReceivablesToXlsx(
  receivables: FinancialTransaction[],
  clinicName = 'medsync'
): Promise<void> {
  const todayYmd = getSaoPauloTodayYmd();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = clinicName;
  workbook.created = new Date();
  buildReceivablesWorksheet(workbook, receivables, todayYmd);
  await downloadWorkbook(workbook, `contas-a-receber-${todayYmd}.xlsx`);
}

export async function exportPayablesToXlsx(
  payables: FinancialTransaction[],
  clinicName = 'medsync'
): Promise<void> {
  const todayYmd = getSaoPauloTodayYmd();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = clinicName;
  workbook.created = new Date();
  buildPayablesWorksheet(workbook, payables, todayYmd);
  await downloadWorkbook(workbook, `contas-a-pagar-${todayYmd}.xlsx`);
}

export async function exportConsolidatedFinancialToXlsx(
  receivables: FinancialTransaction[],
  payables: FinancialTransaction[],
  clinicName = 'medsync'
): Promise<void> {
  const todayYmd = getSaoPauloTodayYmd();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = clinicName;
  workbook.created = new Date();
  buildReceivablesWorksheet(workbook, receivables, todayYmd);
  buildPayablesWorksheet(workbook, payables, todayYmd);
  await downloadWorkbook(workbook, `financeiro-consolidado-${todayYmd}.xlsx`);
}
