import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Legend, AreaChart, Area } from 'recharts';
import type { DashboardData } from '../../hooks/dashboard';
import { MoneyText } from '../../components/MoneyText';
import { formatMoney } from '../../engine/money';
import { categoryName } from '../../components/CategoryBadge';
import { CardShell } from './CardShell';

/** The dashboard's chart cards — a separate chunk so recharts loads after first paint. */
export default function DashboardChart({ id, d }: { id: 'spendingByCategory' | 'incomeVsExpense' | 'cashFlow'; d: DashboardData }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fmt = (m: number) => formatMoney(m, 'YER', lang);
  switch (id) {
    case 'spendingByCategory': {
      if (d.byCategory.length === 0) return null;
      const data = d.byCategory.map((c) => ({
        name: c.id === '_none' ? t('common.none') : categoryName(d.cats.get(c.id), lang),
        value: c.value,
        color: d.cats.get(c.id)?.color ?? '#94a3b8',
      }));
      return (
        <CardShell title={t('dashboard.spendingByCategory')}>
          <div className="h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {data.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      );
    }
    case 'incomeVsExpense': {
      if (!d.last6.some((m) => m.income > 0 || m.expense > 0)) return null;
      const data = d.last6.map((m) => ({ label: new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(`${m.month}T12:00:00`)), income: m.income, expense: m.expense }));
      return (
        <CardShell title={t('dashboard.incomeVsExpense')}>
          <div className="h-48" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={lang.startsWith('ar') ? [...data].reverse() : data}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="income" fill="var(--c-income)" radius={[4, 4, 0, 0]} name={t('dashboard.income')} />
                <Bar dataKey="expense" fill="var(--c-expense)" radius={[4, 4, 0, 0]} name={t('dashboard.expenses')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      );
    }
    case 'cashFlow': {
      if (d.cashFlow.length === 0) return null;
      const last = d.cashFlow[d.cashFlow.length - 1].cumulative;
      const data = d.cashFlow.map((p) => ({ day: parseInt(p.date.slice(8), 10), value: p.cumulative }));
      return (
        <CardShell title={t('cards.names.cashFlow')}>
          <p className="text-lg font-bold"><MoneyText minor={last} currency="YER" kind={last >= 0 ? 'income' : 'expense'} signed /></p>
          <p className="mb-1 text-xs text-ink-dim">{t('cards.cashFlowHint')}</p>
          <div className="h-36" dir="ltr">
            <ResponsiveContainer>
              <AreaChart data={data}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} reversed={lang.startsWith('ar')} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Area type="monotone" dataKey="value" stroke="var(--c-primary)" fill="var(--c-primary-soft)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      );
    }
  }
}
