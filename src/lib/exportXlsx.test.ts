import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildReportXlsx } from './exportXlsx';
import type { ReportDoc } from '../engine/reports';

const doc: ReportDoc = {
  type: 'expense',
  title: 'تقرير المصروفات',
  from: '2026-11-01',
  to: '2026-11-30',
  kpis: [{ label: 'Expenses', valueMinor: 25_000, kind: 'money', tone: 'expense' }],
  notes: [],
  tables: [
    {
      title: 'Transactions',
      columns: [
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'amount', label: 'Original', kind: 'money', currencyKey: 'currency' },
        { key: 'expense', label: 'Expense', kind: 'money' },
      ],
      rows: [
        { date: '2026-11-05', amount: 1999, currency: 'USD', expense: 10_655 },
        { date: '2026-11-06', amount: 14_345, currency: 'YER', expense: 14_345 },
      ],
      totals: { date: 'Total', expense: 25_000 },
    },
  ],
};

describe('XLSX export (acceptance #20)', () => {
  it('writes real numbers whose sums equal the report totals', async () => {
    const buf = await buildReportXlsx(doc, { rtl: true, periodLabel: 'p', generatedLabel: 'g' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);
    const values: (string | number | null)[][] = [];
    ws.eachRow((row) => values.push((row.values as (string | number | null)[]).slice(1)));
    const header = values.findIndex((r) => r[0] === 'Date');
    const r1 = values[header + 1];
    const r2 = values[header + 2];
    const total = values[header + 3];
    // USD minor 1999 → 19.99 (exact, not 19.990000001)
    expect(r1[1]).toBe(19.99);
    expect(r1[2]).toBe(10_655);
    expect((r1[2] as number) + (r2[2] as number)).toBe(total[2]);
    expect(total[2]).toBe(25_000);
    // KPI row
    expect(values.some((r) => r[0] === 'Expenses' && r[1] === 25_000)).toBe(true);
  });
});
