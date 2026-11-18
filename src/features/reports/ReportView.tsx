import { useTranslation } from 'react-i18next';
import type { ReportDoc, ReportTable, ReportColumn, CellValue } from '../../engine/reports';
import { formatMoney, type CurrencyCode } from '../../engine/money';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';

function Cell({ col, row }: { col: ReportColumn; row: Record<string, CellValue> }) {
  const { i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return <>—</>;
  if (col.kind === 'money' && typeof v === 'number') {
    const cur = ((col.currencyKey ? row[col.currencyKey] : 'YER') ?? 'YER') as CurrencyCode;
    return <span dir="ltr" className="tabular-nums">{formatMoney(v, cur, i18n.language)}</span>;
  }
  if (col.kind === 'pct' && typeof v === 'number') return <span dir="ltr">{v}%</span>;
  if (col.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return <>{formatDate(v, i18n.language, calendar)}</>;
  return <>{v}</>;
}

function Table({ table }: { table: ReportTable }) {
  const { t } = useTranslation();
  return (
    <section className="report-section mb-5">
      <h3 className="mb-2 text-sm font-bold text-primary">{table.title}</h3>
      {table.rows.length === 0 ? (
        <p className="text-xs text-ink-dim">{t('reports.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-primary text-on-primary">
                {table.columns.map((c) => (
                  <th key={c.key} className={`px-2 py-1.5 font-semibold ${c.kind === 'money' || c.kind === 'pct' ? 'text-end' : 'text-start'}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-line odd:bg-surface-2/40">
                  {table.columns.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 align-top ${c.kind === 'money' || c.kind === 'pct' ? 'text-end' : ''}`}>
                      <Cell col={c} row={r} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {table.totals && (
              <tfoot>
                <tr className="border-t-2 border-ink font-bold">
                  {table.columns.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 ${c.kind === 'money' || c.kind === 'pct' ? 'text-end' : ''}`}>
                      {table.totals![c.key] === undefined ? '' : <Cell col={c} row={table.totals!} />}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

/** One component renders the report on screen AND in print/PDF (class `print-area`). */
export function ReportView({ doc }: { doc: ReportDoc }) {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const tone = { income: 'text-income', expense: 'text-expense', liability: 'text-liability', neutral: '' } as const;
  return (
    <div className="print-area glass rounded-3xl p-4">
      <header className="mb-4 border-b border-line pb-3">
        <p className="text-xs font-semibold text-primary">{t('app.name')}</p>
        <h2 className="text-lg font-bold">{doc.title}</h2>
        <p className="text-xs text-ink-dim">
          {t('reports.period')}: {formatDate(doc.from, i18n.language, calendar)} – {formatDate(doc.to, i18n.language, calendar)}
        </p>
        <p className="text-xs text-ink-dim">
          {t('reports.generatedOn')}: {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}
        </p>
      </header>
      {doc.kpis.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {doc.kpis.map((k) => (
            <div key={k.label} className="rounded-2xl bg-surface-2 p-2.5">
              <p className="text-[11px] text-ink-dim">{k.label}</p>
              <p className={`text-sm font-bold ${tone[k.tone]}`} dir="ltr">
                {k.kind === 'pct' ? `${k.valueMinor}%` : formatMoney(k.valueMinor, 'YER', i18n.language)}
              </p>
            </div>
          ))}
        </div>
      )}
      {doc.notes.map((n) => (
        <p key={n} className="mb-2 rounded-lg bg-liability-soft px-2 py-1 text-xs text-liability">{n}</p>
      ))}
      {doc.tables.map((tb) => <Table key={tb.title} table={tb} />)}
    </div>
  );
}
