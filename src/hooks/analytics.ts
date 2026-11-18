import { useLiveQuery } from 'dexie-react-hooks';
import { db, todayISO } from '../db/schema';
import { useActiveProfileId } from './data';
import { loadReportData } from '../db/reportData';
import { summarize, daysInRange, generateInsights, netFlowMinor, type PeriodSummary, type Insight } from '../engine/analytics';
import { computeNetWorth, type NetWorth } from '../engine/networth';
import { periodRange, previousPeriodRange, type DateRange } from '../engine/budgets';
import { occurrencesBetween } from '../engine/recurring';
import { budgetStatus } from '../db/budgets';
import { convertToBase } from '../engine/money';
import type { Category } from '../db/types';

export type PeriodMode = 'month' | 'year' | 'custom';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Current and previous comparison windows for a mode. Custom: the equal-length window right before. */
export function rangesFor(mode: PeriodMode, custom: DateRange): { cur: DateRange; prev: DateRange } {
  const today = todayISO();
  if (mode === 'month') return { cur: periodRange('monthly', today), prev: previousPeriodRange('monthly', today) };
  if (mode === 'year') return { cur: periodRange('yearly', today), prev: previousPeriodRange('yearly', today) };
  const len = daysInRange(custom.from, custom.to);
  const end = new Date(`${custom.from}T12:00:00`);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (len - 1));
  return { cur: custom, prev: { from: iso(start), to: iso(end) } };
}

export interface AnalyticsResult {
  cur: DateRange;
  prev: DateRange;
  current: PeriodSummary;
  previous: PeriodSummary;
  insights: Insight[];
  cats: Map<string, Category>;
  netWorth: NetWorth;
  incomeTrend: { month: string; incomeMinor: number }[];
  daysElapsed: number;
  daysTotal: number;
}

export function useAnalytics(mode: PeriodMode, custom: DateRange): AnalyticsResult | undefined {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => {
    if (!profileId) return undefined;
    const { cur, prev } = rangesFor(mode, custom);
    const data = await loadReportData(profileId, prev.from, cur.to);
    const within = (r: DateRange) => data.txns.filter((t) => t.date >= r.from && t.date <= r.to);
    const current = summarize(within(cur), data.splitsByTxn, data.cats);
    const previous = summarize(within(prev), data.splitsByTxn, data.cats);
    const today = todayISO();
    const daysTotal = daysInRange(cur.from, cur.to);
    const daysElapsed = today < cur.from ? 0 : today > cur.to ? daysTotal : daysInRange(cur.from, today);

    // upcoming expense obligations until period end (recurring + debts I owe falling due)
    let upcoming = 0;
    if (today <= cur.to) {
      const recurring = await db.recurringObligations.where('[profileId+status]').equals([profileId, 'active']).toArray();
      const accById = new Map(data.accounts.map((a) => [a.id, a]));
      for (const r of recurring) {
        if (r.kind !== 'expense') continue;
        const acc = accById.get(r.accountId);
        if (!acc) continue;
        const rate = acc.currency === 'YER' ? 1 : data.latestRates.get(acc.currency);
        if (rate === undefined) continue;
        const n = occurrencesBetween(r, today, cur.to).length;
        upcoming += n * convertToBase(r.amountMinor, acc.currency, rate);
      }
      for (const d of data.debts) {
        if (d.status !== 'open' || d.direction !== 'i_owe' || !d.dueDate) continue;
        if (d.dueDate < today || d.dueDate > cur.to) continue;
        const rate = d.currency === 'YER' ? 1 : data.latestRates.get(d.currency);
        if (rate !== undefined) upcoming += convertToBase(d.remainingMinor, d.currency, rate);
      }
    }
    // liquid balance: cash, bank, e-wallet
    let liquid = 0;
    for (const a of data.accounts) {
      if (a.status !== 'active' || !['cash', 'bank', 'ewallet'].includes(a.type)) continue;
      const rate = a.currency === 'YER' ? 1 : data.latestRates.get(a.currency);
      if (rate !== undefined) liquid += convertToBase(a.currentBalanceMinor, a.currency, rate);
    }
    // budget total for pace projection (monthly mode only; overall budgets win to avoid double counting)
    let totalBudget = 0;
    if (mode === 'month') {
      const budgets = (await db.budgets.where('profileId').equals(profileId).toArray()).filter(
        (b) => !b.isArchived && b.period === 'monthly' && (!b.endDate || b.endDate >= today),
      );
      const overall = budgets.filter((b) => b.categoryId === null);
      for (const b of overall.length ? overall : budgets) totalBudget += (await budgetStatus(b, today)).effectiveLimitMinor;
    }
    const insights = generateInsights({
      current,
      previous,
      daysElapsed,
      daysTotal,
      upcomingObligationsMinor: upcoming,
      liquidBalanceMinor: liquid,
      totalBudgetMinor: totalBudget,
    });

    const netWorth = computeNetWorth(data.accounts.filter((a) => a.status === 'active'), data.debts, data.latestRates, {
      investments: data.investments,
      assets: data.assets,
    });

    // income stability: last 6 calendar months
    const now = new Date();
    const sixStart = iso(new Date(now.getFullYear(), now.getMonth() - 5, 1, 12));
    const trendData = await loadReportData(profileId, sixStart, periodRange('monthly', today).to);
    const incomeTrend: { month: string; incomeMinor: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const r = periodRange('monthly', iso(new Date(now.getFullYear(), now.getMonth() - i, 1, 12)));
      const s = summarize(trendData.txns.filter((t) => t.date >= r.from && t.date <= r.to), trendData.splitsByTxn, trendData.cats);
      incomeTrend.push({ month: r.from, incomeMinor: s.incomeMinor });
    }

    return { cur, prev, current, previous, insights, cats: data.cats, netWorth, incomeTrend, daysElapsed, daysTotal };
  }, [profileId, mode, custom.from, custom.to]);
}

export interface PeriodDigest {
  range: DateRange;
  summary: PeriodSummary;
  netChangeMinor: number;
  /** Average spending for an equally long window, from the 90 days before the range; null without history. */
  averageMinor: number | null;
  cats: Map<string, Category>;
}

/** Daily / weekly / monthly summary (PRD §18). */
export function usePeriodDigest(period: 'daily' | 'weekly' | 'monthly'): PeriodDigest | undefined {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => {
    if (!profileId) return undefined;
    const today = todayISO();
    const range = periodRange(period, today);
    const histEnd = new Date(`${range.from}T12:00:00`);
    histEnd.setDate(histEnd.getDate() - 1);
    const histStart = new Date(histEnd);
    histStart.setDate(histStart.getDate() - 89);
    const data = await loadReportData(profileId, iso(histStart), range.to);
    const inRange = data.txns.filter((t) => t.date >= range.from && t.date <= range.to);
    const history = data.txns.filter((t) => t.date < range.from);
    const summary = summarize(inRange, data.splitsByTxn, data.cats);
    const debtDir = new Map(data.debts.map((d) => [d.id, d.direction]));
    const netChangeMinor = inRange.reduce((s, t) => s + netFlowMinor(t, (id) => (id ? debtDir.get(id) ?? null : null)), 0);
    let averageMinor: number | null = null;
    if (history.length > 0) {
      const firstDate = history.reduce((m, t) => (t.date < m ? t.date : m), history[0].date);
      const histDays = daysInRange(firstDate, iso(histEnd));
      const histSummary = summarize(history, data.splitsByTxn, data.cats);
      averageMinor = Math.round((histSummary.expenseMinor * daysInRange(range.from, range.to)) / histDays);
    }
    return { range, summary, netChangeMinor, averageMinor, cats: data.cats };
  }, [profileId, period]);
}
