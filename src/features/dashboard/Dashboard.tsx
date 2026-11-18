import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Wallet, Bell, Search, LayoutGrid } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useUnreadCount } from '../../hooks/stage2';
import { useAccounts, useCategoryMap } from '../../hooks/data';
import { useDashboardData, type DashboardData, type UpcomingRow } from '../../hooks/dashboard';
import { Card, EmptyState } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { TxnListItem } from '../transactions/TxnListItem';
import { formatMoney } from '../../engine/money';
import { goalProgressPct } from '../../engine/goals';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import { useTxnSheet } from '../../store/txnSheet';
import { ForecastView } from '../forecast/ForecastView';
import { mergeLayout, type CardId } from './cardRegistry';
import { CardShell } from './CardShell';

const DashboardChart = lazy(() => import('./DashboardCharts'));

function UpcomingList({ rows, empty }: { rows: UpcomingRow[]; empty: string }) {
  const { i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  if (!rows.length) return <p className="text-xs text-ink-dim">{empty}</p>;
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 text-sm">
          <span className="min-w-0 truncate">
            <span className="text-xs text-ink-dim">{formatDate(r.date, i18n.language, calendar, { day: 'numeric', month: 'short' })}</span> · {r.label}
          </span>
          <MoneyText minor={r.amountMinor} currency={r.currency} kind={r.direction === 'in' ? 'income' : r.direction === 'out' ? 'liability' : 'expense'} className="text-sm" />
        </div>
      ))}
    </>
  );
}

function renderCard(id: CardId, d: DashboardData, ctx: { t: (k: string, p?: Record<string, unknown>) => string; lang: string; hide: boolean }) {
  const { t, lang, hide } = ctx;
  const fmt = (m: number) => formatMoney(m, 'YER', lang);
  switch (id) {
    case 'totalBalance':
      return (
        <div className="glow relative mb-3 overflow-hidden rounded-3xl bg-primary p-5 text-on-primary">
          <div aria-hidden className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -start-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <p className="text-xs opacity-90">{t('dashboard.totalBalance')}</p>
          <p className="mt-1 text-[2rem] font-bold leading-tight tracking-tight">{hide ? '•••••' : <span dir="ltr" className="tabular-nums">{fmt(d.balance.sum)}</span>}</p>
          <p className="mt-1 text-xs opacity-90">{t('dashboard.inBase')}</p>
          {d.balance.missing && <p className="mt-1 text-xs font-semibold underline">{t('common.cannotConvert')}</p>}
        </div>
      );
    case 'incomeExpense':
      return (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Card className="p-3">
              <p className="text-xs text-ink-dim">{t('dashboard.income')} · {t('common.thisMonth')}</p>
              <MoneyText minor={d.month.income} currency="YER" kind="income" className="text-lg" />
            </Card>
            <Card className="p-3">
              <p className="text-xs text-ink-dim">{t('dashboard.expenses')} · {t('common.thisMonth')}</p>
              <MoneyText minor={d.month.expense} currency="YER" kind="expense" className="text-lg" />
            </Card>
          </div>
          {d.month.unconvertible > 0 && (
            <p className="mb-3 rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{t('dashboard.unconvertedNote', { count: d.month.unconvertible })}</p>
          )}
        </>
      );
    case 'forecast':
      return (
        <CardShell title={t('cards.names.forecast')} link={{ label: t('dashboard.viewAll'), to: '/analytics' }}>
          <ForecastView compact />
        </CardShell>
      );
    case 'netWorth':
      return (
        <CardShell title={t('cards.names.netWorth')} link={{ label: t('dashboard.viewAll'), to: '/analytics' }}>
          <p className="text-2xl font-bold"><MoneyText minor={d.netWorth.netMinor} currency="YER" /></p>
          <div className="mt-1 flex gap-4 text-xs">
            <span className="text-ink-dim">{t('reports.assets')}: <MoneyText minor={d.netWorth.assetsMinor} currency="YER" kind="income" /></span>
            <span className="text-ink-dim">{t('reports.liabilities')}: <MoneyText minor={d.netWorth.liabilitiesMinor} currency="YER" kind="liability" /></span>
          </div>
        </CardShell>
      );
    case 'remainingBudget': {
      const b = d.budget;
      const pct = b && b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
      return (
        <CardShell title={t('cards.names.remainingBudget')} link={{ label: t('dashboard.viewAll'), to: '/more/budgets' }}>
          {!b ? (
            <p className="text-xs text-ink-dim">{t('cards.noBudget')}</p>
          ) : (
            <>
              <p className="text-xl font-bold"><MoneyText minor={b.limit - b.spent} currency="YER" kind={b.limit - b.spent < 0 ? 'expense' : 'neutral'} /></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" dir="ltr">
                <div className={`h-full rounded-full ${pct >= 100 ? 'bg-expense' : pct >= 90 ? 'bg-liability' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-dim">{pct}% · {t('budgets.ofBudget', { amount: hide ? '•••' : fmt(b.limit) })}</p>
            </>
          )}
        </CardShell>
      );
    }
    case 'savingsBalance':
      return (
        <CardShell title={t('cards.names.savingsBalance')}>
          <p className="text-xl font-bold"><MoneyText minor={d.savings.sum} currency="YER" /></p>
          <p className="text-xs text-ink-dim">{t('cards.inSavings')}</p>
        </CardShell>
      );
    case 'goalsProgress':
      return (
        <CardShell title={t('cards.names.goalsProgress')} link={{ label: t('dashboard.viewAll'), to: '/more/goals' }}>
          {d.goals.length === 0 ? <p className="text-xs text-ink-dim">{t('cards.noGoals')}</p> : d.goals.slice(0, 3).map((g) => {
            const pct = goalProgressPct(g);
            return (
              <div key={g.id} className="py-1">
                <div className="flex justify-between text-sm"><span>{g.name}</span><span className="text-xs font-semibold">{pct}%</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" dir="ltr"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </CardShell>
      );
    case 'upcomingBills':
      return (
        <CardShell title={t('cards.names.upcomingBills')} link={{ label: t('dashboard.viewAll'), to: '/more/recurring' }}>
          <UpcomingList rows={d.bills} empty={t('cards.noBills')} />
        </CardShell>
      );
    case 'upcomingDebts':
      return (
        <CardShell title={t('cards.names.upcomingDebts')} link={{ label: t('dashboard.viewAll'), to: '/more/debts' }}>
          <UpcomingList rows={d.debts} empty={t('cards.noDebts')} />
        </CardShell>
      );
    case 'spendingByCategory':
    case 'incomeVsExpense':
    case 'cashFlow':
      // charts load in their own chunk so the charting library stays out of the startup bundle
      return hide ? null : (
        <Suspense fallback={<div className="mb-3 h-56 animate-pulse rounded-2xl bg-surface-2" />}>
          <DashboardChart id={id} d={d} />
        </Suspense>
      );
    case 'recentTransactions':
      return null; // rendered by the component (needs hooks for accounts/sheet)
  }
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { settings, setHideBalances } = useApp();
  const accounts = useAccounts();
  const catMap = useCategoryMap();
  const { openEdit } = useTxnSheet();
  const d = useDashboardData();
  const hide = settings?.hideBalances ?? false;
  const unread = useUnreadCount();
  const layout = mergeLayout(settings?.dashboardCards);
  const tt = (k: string, p?: Record<string, unknown>) => String(t(k, p as never));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="flex-1 text-xl font-bold">{t('app.name')}</h1>
        <button onClick={() => navigate('/search')} className="rounded-full p-2 text-ink-dim active:bg-surface-2" aria-label={t('search.title')}>
          <Search size={20} />
        </button>
        <button onClick={() => navigate('/more/notifications')} className="relative rounded-full p-2 text-ink-dim active:bg-surface-2" aria-label={t('notifications.title')}>
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-expense px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
        <button onClick={() => void setHideBalances(!hide)} className="rounded-full p-2 text-ink-dim active:bg-surface-2" aria-label={hide ? t('dashboard.showBalances') : t('dashboard.hideBalances')}>
          {hide ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>

      {d &&
        layout
          .filter((p) => p.visible)
          .map((p) => {
            if (p.id === 'recentTransactions') {
              return (
                <CardShell key={p.id} title={t('dashboard.recentTransactions')} link={{ label: t('dashboard.viewAll'), to: '/transactions' }}>
                  {d.recent.length === 0 ? (
                    <EmptyState icon={<Wallet size={36} />} text={t('dashboard.noTransactions')} />
                  ) : (
                    d.recent.map((txn) => <TxnListItem key={txn.id} txn={txn} categories={catMap} accounts={accounts} onClick={() => openEdit(txn)} />)
                  )}
                </CardShell>
              );
            }
            const node = renderCard(p.id as CardId, d, { t: tt, lang: i18n.language, hide });
            return node ? <div key={p.id}>{node}</div> : null;
          })}

      <button onClick={() => navigate('/more/dashboard')} className="mx-auto mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-dim active:bg-surface-2">
        <LayoutGrid size={14} /> {t('cards.customize')}
      </button>
    </div>
  );
}
