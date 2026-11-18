import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Card } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useForecast } from '../../hooks/stage4';
import { formatMoney } from '../../engine/money';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { Projection } from '../../engine/forecast';

function ProjectionBlock({ title, p }: { title: string; p: Projection }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-line p-3">
      <p className="mb-1 text-xs font-semibold text-ink-dim">{title}</p>
      <div className="grid grid-cols-2 gap-y-1 text-sm">
        <span className="text-ink-dim">{t('forecast.expectedIncome')}</span>
        <MoneyText minor={p.expectedIncomeMinor} currency="YER" kind="income" className="text-end" />
        <span className="text-ink-dim">{t('forecast.expectedExpense')}</span>
        <MoneyText minor={p.expectedExpenseMinor} currency="YER" kind="expense" className="text-end" />
        {p.expectedDebtOutMinor > 0 && (
          <>
            <span className="text-ink-dim">{t('forecast.debtOut')}</span>
            <MoneyText minor={p.expectedDebtOutMinor} currency="YER" kind="liability" className="text-end" />
          </>
        )}
        <span className="font-semibold">{t('forecast.endBalance')}</span>
        <MoneyText minor={p.endBalanceMinor} currency="YER" kind={p.endBalanceMinor >= 0 ? 'neutral' : 'expense'} className="text-end text-base" />
      </div>
    </div>
  );
}

/** Full forecast (both methods). `compact` shows only the two end balances. */
export function ForecastView({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const f = useForecast();
  if (!f) return null;
  const fmt = (m: number) => formatMoney(m, 'YER', i18n.language);

  if (compact) {
    return (
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-dim">{t('forecast.planned')}</span>
          <MoneyText minor={f.planned.endBalanceMinor} currency="YER" kind={f.planned.endBalanceMinor >= 0 ? 'neutral' : 'expense'} />
        </div>
        <div className="flex justify-between">
          <span className="text-ink-dim">{t('forecast.historical')}</span>
          {f.historical ? <MoneyText minor={f.historical.endBalanceMinor} currency="YER" kind={f.historical.endBalanceMinor >= 0 ? 'neutral' : 'expense'} /> : <span className="text-xs text-ink-dim">—</span>}
        </div>
        {f.overspendRisks.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-liability"><AlertTriangle size={12} /> {t('forecast.overspend')}: {f.overspendRisks.map((r) => r.name).join('، ')}</p>
        )}
        <p className="text-[11px] italic text-ink-dim">{t('forecast.estimate')}</p>
      </div>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-bold">{t('forecast.title')} · {formatDate(f.monthEnd, i18n.language, calendar)}</h2>
        <p className="text-[11px] italic text-liability">{t('forecast.estimate')}</p>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-ink-dim">{t('forecast.startBalance')}</span>
        <MoneyText minor={f.liquidBalanceMinor} currency="YER" />
      </div>
      <ProjectionBlock title={t('forecast.planned')} p={f.planned} />
      {f.historical ? <ProjectionBlock title={t('forecast.historical')} p={f.historical} /> : <p className="text-xs text-ink-dim">{t('forecast.noHistory')}</p>}
      {f.overspendRisks.length > 0 && (
        <div className="rounded-2xl bg-liability-soft p-3 text-xs text-liability">
          <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle size={14} /> {t('forecast.overspend')}</p>
          {f.overspendRisks.map((r) => (
            <p key={r.id}>{t('forecast.overspendLine', { name: r.name, projected: fmt(r.projectedMinor), limit: fmt(r.limitMinor) })}</p>
          ))}
        </div>
      )}
      {f.upcoming.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-ink-dim">{t('forecast.upcoming')}</p>
          {f.upcoming.map((u, i) => (
            <div key={i} className="flex items-center justify-between py-1 text-sm">
              <span>
                <span className="text-ink-dim">{formatDate(u.date, i18n.language, calendar, { day: 'numeric', month: 'short' })}</span> · {t(`forecast.kinds.${u.kind}`)} · {u.label}
              </span>
              <MoneyText minor={u.baseMinor} currency="YER" kind={u.kind === 'recurring_income' || u.kind === 'debt_receivable' ? 'income' : 'expense'} className="text-xs" />
            </div>
          ))}
          {f.upcoming.some((u) => u.kind === 'debt_receivable') && <p className="mt-1 text-[11px] text-ink-dim">{t('forecast.receivableNote')}</p>}
        </div>
      )}
    </Card>
  );
}
