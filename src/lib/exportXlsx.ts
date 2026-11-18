import type { ReportDoc, ReportColumn, CellValue } from '../engine/reports';
import { CURRENCIES, type CurrencyCode } from '../engine/money';

/** Minor units → major number for spreadsheet cells (exact for exponents 0 and 2). */
function toMajor(minor: number, currency: CurrencyCode): number {
  const exp = CURRENCIES[currency].exponent;
  return exp === 0 ? minor : Number((minor / 10 ** exp).toFixed(exp));
}

function numFmt(currency: CurrencyCode): string {
  return CURRENCIES[currency].exponent === 0 ? '#,##0' : '#,##0.00';
}

function cellValue(col: ReportColumn, row: Record<string, CellValue>): { v: string | number | null; fmt?: string } {
  const raw = row[col.key];
  if (raw === null || raw === undefined || raw === '') return { v: null };
  if (col.kind === 'money' && typeof raw === 'number') {
    const cur = ((col.currencyKey ? row[col.currencyKey] : 'YER') ?? 'YER') as CurrencyCode;
    return { v: toMajor(raw, cur), fmt: `${numFmt(cur)}" ${cur}"` };
  }
  if (col.kind === 'pct' && typeof raw === 'number') return { v: raw / 100, fmt: '0%' };
  return { v: raw };
}

interface XlsxOpts {
  rtl: boolean;
  periodLabel: string;
  generatedLabel: string;
}

/** Build the workbook bytes (no DOM) — separately testable. exceljs is loaded on demand. */
export async function buildReportXlsx(doc: ReportDoc, opts: XlsxOpts): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'My Finance Manager';
  wb.created = new Date();
  const ws = wb.addWorksheet(doc.title.slice(0, 31), { views: [{ rightToLeft: opts.rtl }] });

  const title = ws.addRow([doc.title]);
  title.font = { bold: true, size: 15 };
  ws.addRow([opts.periodLabel]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([opts.generatedLabel]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([]);

  for (const k of doc.kpis) {
    const r = ws.addRow([k.label, k.kind === 'pct' ? k.valueMinor / 100 : toMajor(k.valueMinor, 'YER')]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).numFmt = k.kind === 'pct' ? '0%' : '#,##0" YER"';
  }
  for (const n of doc.notes) ws.addRow([n]).font = { italic: true, color: { argb: 'FFB45309' } };

  for (const table of doc.tables) {
    ws.addRow([]);
    ws.addRow([table.title]).font = { bold: true, size: 12, color: { argb: 'FF0F766E' } };
    const header = ws.addRow(table.columns.map((c) => c.label));
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const row of table.rows) {
      const cells = table.columns.map((c) => cellValue(c, row));
      const r = ws.addRow(cells.map((c) => c.v));
      cells.forEach((c, i) => {
        if (c.fmt) r.getCell(i + 1).numFmt = c.fmt;
      });
    }
    if (table.totals) {
      const cells = table.columns.map((c) => cellValue(c, table.totals!));
      const r = ws.addRow(cells.map((c) => c.v));
      r.font = { bold: true };
      cells.forEach((c, i) => {
        if (c.fmt) r.getCell(i + 1).numFmt = c.fmt;
        r.getCell(i + 1).border = { top: { style: 'thin' } };
      });
    }
  }
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(45, max + 2);
  });
  // the title cell should not stretch the first column
  ws.getColumn(1).width = Math.min(ws.getColumn(1).width ?? 20, 28);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Build the workbook and trigger a download in the browser. */
export async function exportReportXlsx(doc: ReportDoc, opts: XlsxOpts & { filename: string }): Promise<void> {
  const buf = await buildReportXlsx(doc, opts);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
