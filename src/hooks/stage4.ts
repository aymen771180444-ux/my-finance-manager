import { useLiveQuery } from 'dexie-react-hooks';
import { db, todayISO } from '../db/schema';
import { useActiveProfileId } from './data';
import { profileAccounts, latestRatesMap } from '../db/reportData';
import { budgetStatus } from '../db/budgets';
import { summarize, daysInRange } from '../engine/analytics';
import { periodRange } from '../engine/budgets';
import { occurrencesBetween } from '../engine/recurring';
import { installmentDates } from '../engine/calendar';
import { forecastMonth, type Forecast, type UpcomingItem, type BudgetLine } from '../engine/forecast';
import { netWorthAt, monthEnds, yearEnds } from '../engine/networth';
import { convertToBase, type CurrencyCode } from '../engine/money';
import type { SplitLine } from '../engine/analytics';

export function useInvestments() {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => (profileId ? (await db.investments.where('profileId').equals(profileId).toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []), [profileId]) ?? [];
}

export function useInvestmentHistory(id: string | null) {
  return useLiveQuery(async () => (id ? (await db.investmentTxns.where('investmentId').equals(id).toArray()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)) : []), [id]) ?? [];
}

export function useAssets() {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => (profileId ? (await db.assets.where('profileId').equals(profileId).toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []), [profileId]) ?? [];
}

export function useAssetValuations(id: string | null) {
  return useLiveQuery(async () => (id ? (await db.assetValuations.where('assetId').equals(id).toArray()).sort((a, b) => b.date.localeCompare(a.date)) : []), [id]) ?? [];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface ForecastResult extends Forecast {
  liquidBalanceMinor: number;
  monthEnd: string;
}

/** End-of-month forecast with both PRD methods. */
export function useForecast(): ForecastResult | undefined {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => {
    if (!profileId) return undefined;
    const today = todayISO();
    const month = periodRange('monthly', today);
    const rates = await latestRatesMap();
    const toBase = (minor: number, cur: CurrencyCode) => {
      if (cur === 'YER') return minor;
      const r = rates.get(cur);
      return r === undefined ? null : convertToBase(minor, cur, r);
    };
    const accounts = await profileAccounts(profileId);
    let liquid = 0;
    for (const a of accounts) {
      if (a.status !== 'active' || !['cash', 'bank', 'ewallet'].includes(a.type)) continue;
      liquid += toBase(a.currentBalanceMinor, a.currency) ?? 0;
    }

    // method 1 history: up to 90 days ending today, but never before the first record
    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - 89);
    const txns = await db.transactions.where('[profileId+date]').between([profileId, iso(start)], [profileId, today + '￿']).toArray();
    let history: { incomeMinor: number; expenseMinor: number; days: number } | null = null;
    if (txns.length) {
      const first = txns.reduce((m, t) => (t.date < m ? t.date : m), txns[0].date);
      const days = daysInRange(first, today);
      if (days >= 7) {
        const cats = new Map((await db.categories.where('profileId').equals(profileId).toArray()).map((c) => [c.id, c]));
        const s = summarize(txns, new Map<string, SplitLine[]>(), cats);
        history = { incomeMinor: s.incomeMinor, expenseMinor: s.expenseMinor, days };
      }
    }

    // upcoming items after today until month end
    const upcoming: UpcomingItem[] = [];
    const accById = new Map(accounts.map((a) => [a.id, a]));
    for (const r of await db.recurringObligations.where('[profileId+status]').equals([profileId, 'active']).toArray()) {
      const acc = accById.get(r.accountId);
      if (!acc) continue;
      const base = toBase(r.amountMinor, acc.currency);
      if (base === null) continue;
      for (const date of occurrencesBetween(r, today, month.to)) {
        upcoming.push({ kind: r.kind === 'income' ? 'recurring_income' : 'recurring_expense', label: r.name, date, baseMinor: base, categoryId: r.categoryId });
      }
    }
    for (const d of await db.debts.where('[profileId+status]').equals([profileId, 'open']).toArray()) {
      const dates = new Set<string>();
      for (const x of installmentDates(d)) if (x > today && x <= month.to) dates.add(x);
      const kind = d.direction === 'i_owe' ? 'debt_payable' : 'debt_receivable';
      let remaining = d.remainingMinor;
      for (const date of [...dates].sort()) {
        const amt = Math.min(d.installmentMinor ?? remaining, remaining);
        if (amt <= 0) break;
        remaining -= amt;
        const base = toBase(amt, d.currency);
        if (base !== null) upcoming.push({ kind, label: d.person, date, baseMinor: base });
      }
      if (d.dueDate && d.dueDate > today && d.dueDate <= month.to && !dates.has(d.dueDate) && remaining > 0) {
        const base = toBase(remaining, d.currency);
        if (base !== null) upcoming.push({ kind, label: d.person, date: d.dueDate, baseMinor: base });
      }
    }

    // monthly budgets
    const budgets: BudgetLine[] = [];
    for (const b of await db.budgets.where('profileId').equals(profileId).toArray()) {
      if (b.isArchived || b.period !== 'monthly' || (b.endDate && b.endDate < today)) continue;
      const st = await budgetStatus(b, today);
      let ids: Set<string> | null = null;
      if (b.categoryId) {
        ids = new Set([b.categoryId]);
        for (const c of await db.categories.where('[profileId+parentId]').equals([profileId, b.categoryId]).toArray()) ids.add(c.id);
      }
      budgets.push({ id: b.id, name: b.name, categoryIds: ids, limitMinor: st.effectiveLimitMinor, spentMinor: st.spentMinor });
    }

    const daysTotal = daysInRange(month.from, month.to);
    const daysElapsed = daysInRange(month.from, today);
    const f = forecastMonth({ daysLeft: daysTotal - daysElapsed, daysElapsed, daysTotal, liquidBalanceMinor: liquid, history, upcoming, budgets });
    return { ...f, liquidBalanceMinor: liquid, monthEnd: month.to };
  }, [profileId]);
}

/** Net-worth trend points reconstructed from history. */
export function useNetWorthTrend(mode: 'monthly' | 'yearly') {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => {
    if (!profileId) return [];
    const [accounts, txns, debts, repayments, investments, investmentTxns, assets, valuations, rates] = await Promise.all([
      profileAccounts(profileId),
      db.transactions.where('profileId').equals(profileId).toArray(),
      db.debts.where('profileId').equals(profileId).toArray(),
      db.debtRepayments.where('[profileId+date]').between([profileId, ''], [profileId, '￿']).toArray(),
      db.investments.where('profileId').equals(profileId).toArray(),
      db.investmentTxns.where('[profileId+date]').between([profileId, ''], [profileId, '￿']).toArray(),
      db.assets.where('profileId').equals(profileId).toArray(),
      db.assetValuations.where('[profileId+date]').between([profileId, ''], [profileId, '￿']).toArray(),
      db.exchangeRates.toArray(),
    ]);
    const today = todayISO();
    const dates = mode === 'monthly' ? monthEnds(today, 12) : yearEnds(today, 5);
    const h = { accounts, txns, debts, repayments, investments, investmentTxns, assets, valuations, rates };
    return dates.map((date) => {
      const nw = netWorthAt(h, date);
      return { date, netMinor: nw.netMinor, assetsMinor: nw.assetsMinor, liabilitiesMinor: nw.liabilitiesMinor, partial: nw.unconverted.length > 0 };
    });
  }, [profileId, mode]);
}
