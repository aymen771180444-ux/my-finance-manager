/**
 * Analytics engine — pure functions over already-loaded rows.
 * All money is BASE (YER) minor units, taken from each transaction's frozen
 * baseAmountMinor. Transactions without a rate are counted separately as
 * `unconvertible` and never estimated.
 */

import type { Transaction, Category, CategoryGroup, DebtDirection } from '../db/types';
import { totalsContribution, compilePostings } from './posting';

/**
 * Net effect of a transaction on the user's combined balances, in base minor
 * units. Transfers net to zero; lending/borrowing/repayments and investment
 * moves DO change balances even though they are not income or expense.
 */
export function netFlowMinor(
  t: Transaction,
  debtDirection: (debtId: string | null) => DebtDirection | null,
): number {
  if (t.baseAmountMinor === null) return 0;
  const dir = t.type === 'debt_repayment' ? debtDirection(t.debtId) : null;
  if (t.type === 'debt_repayment' && !dir) return 0;
  const sum = compilePostings({ ...t, debtDirection: dir }).reduce((s, p) => s + p.deltaMinor, 0);
  return Math.round((sum * t.baseAmountMinor) / t.amountMinor);
}

export interface SplitLine {
  categoryId: string;
  amountMinor: number;
}

export interface PeriodSummary {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** (income − expense) / income, rounded %; null when there is no income. */
  savingsRatePct: number | null;
  /** Expense per top-level category id ('_none' = uncategorized). */
  expenseByCategory: Map<string, number>;
  /** Income per top-level category id (income sources). */
  incomeByCategory: Map<string, number>;
  /** Expense per ISO date. */
  expenseByDay: Map<string, number>;
  /** Expense per weekday, 0 = Sunday … 6 = Saturday. */
  expenseByWeekday: number[];
  needsMinor: number;
  wantsMinor: number;
  otherMinor: number;
  unconvertible: number;
  txnCount: number;
}

const NEEDS: CategoryGroup[] = ['essentials', 'bills', 'emergencies'];
const WANTS: CategoryGroup[] = ['wants'];

/** Resolve a category id to its top-level parent id. */
function topLevel(catId: string | null, cats: Map<string, Category>): string {
  if (!catId) return '_none';
  const c = cats.get(catId);
  if (!c) return '_none';
  return c.parentId ?? c.id;
}

function add(map: Map<string, number>, key: string, v: number) {
  map.set(key, (map.get(key) ?? 0) + v);
}

/** Allocate a txn's base amount to a split line, proportionally (integer math). */
export function splitShare(t: Pick<Transaction, 'baseAmountMinor' | 'amountMinor'>, lineMinor: number): number {
  if (t.baseAmountMinor === null || t.amountMinor === 0) return 0;
  return Math.round((t.baseAmountMinor * lineMinor) / t.amountMinor);
}

export function summarize(
  txns: Transaction[],
  splitsByTxn: Map<string, SplitLine[]>,
  cats: Map<string, Category>,
): PeriodSummary {
  const s: PeriodSummary = {
    incomeMinor: 0,
    expenseMinor: 0,
    netMinor: 0,
    savingsRatePct: null,
    expenseByCategory: new Map(),
    incomeByCategory: new Map(),
    expenseByDay: new Map(),
    expenseByWeekday: [0, 0, 0, 0, 0, 0, 0],
    needsMinor: 0,
    wantsMinor: 0,
    otherMinor: 0,
    unconvertible: 0,
    txnCount: 0,
  };
  const classify = (catTop: string, amount: number) => {
    const group = cats.get(catTop)?.group;
    if (group && NEEDS.includes(group)) s.needsMinor += amount;
    else if (group && WANTS.includes(group)) s.wantsMinor += amount;
    else s.otherMinor += amount;
  };
  for (const t of txns) {
    const c = totalsContribution(t);
    if (c.unconvertible) {
      s.unconvertible++;
      continue;
    }
    if (c.incomeMinor === 0 && c.expenseMinor === 0) continue; // transfers, debts, investments
    s.txnCount++;
    s.incomeMinor += c.incomeMinor;
    s.expenseMinor += c.expenseMinor;
    if (c.incomeMinor !== 0) add(s.incomeByCategory, topLevel(t.categoryId, cats), c.incomeMinor);
    if (c.expenseMinor !== 0) {
      add(s.expenseByDay, t.date, c.expenseMinor);
      s.expenseByWeekday[new Date(`${t.date}T12:00:00`).getDay()] += c.expenseMinor;
      const lines = t.hasSplits ? splitsByTxn.get(t.id) : undefined;
      if (lines?.length) {
        for (const l of lines) {
          const share = splitShare(t, l.amountMinor);
          const top = topLevel(l.categoryId, cats);
          add(s.expenseByCategory, top, share);
          classify(top, share);
        }
      } else {
        // refunds carry a negative expense contribution against the refunded category
        const top = topLevel(t.categoryId, cats);
        add(s.expenseByCategory, top, c.expenseMinor);
        classify(top, c.expenseMinor);
      }
    }
  }
  s.netMinor = s.incomeMinor - s.expenseMinor;
  s.savingsRatePct = s.incomeMinor > 0 ? Math.round((s.netMinor / s.incomeMinor) * 100) : null;
  return s;
}

/** Number of calendar days in [from, to] inclusive. */
export function daysInRange(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export interface Averages {
  dailyMinor: number;
  weeklyMinor: number;
  monthlyMinor: number;
}

/** Average spending over a window (uses calendar days, not just days with spending). */
export function averages(expenseMinor: number, from: string, to: string): Averages {
  const days = daysInRange(from, to);
  return {
    dailyMinor: Math.round(expenseMinor / days),
    weeklyMinor: Math.round((expenseMinor * 7) / days),
    monthlyMinor: Math.round((expenseMinor * 30.44) / days),
  };
}

/** Sorted [key, value] pairs, largest first. */
export function topEntries(map: Map<string, number>, n = 5): [string, number][] {
  return [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** % change from `prev` to `cur`; null when prev is 0 (no baseline). */
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

// ——— Rule-based insights (PRD §17) ———

export type InsightKind =
  | 'spendingUp'
  | 'spendingDown'
  | 'categoryShare'
  | 'categoryUp'
  | 'savingsRateUp'
  | 'savingsRateDown'
  | 'obligationsVsBalance'
  | 'paceOverspend';

export interface Insight {
  kind: InsightKind;
  severity: 'info' | 'good' | 'warn';
  /** Params for the i18n string; categoryId is resolved to a name by the UI. */
  params: Record<string, string | number>;
}

export interface InsightInputs {
  current: PeriodSummary;
  previous: PeriodSummary;
  /** Days elapsed / total days in the current period (for pace projection). */
  daysElapsed: number;
  daysTotal: number;
  /** Upcoming expense obligations until period end, base minor. */
  upcomingObligationsMinor: number;
  /** Liquid balance (cash/bank/ewallet), base minor. */
  liquidBalanceMinor: number;
  /** Sum of active budget limits for the period (0 when none). */
  totalBudgetMinor: number;
}

/**
 * Every insight is derived strictly from recorded data. Nothing fires without a
 * real baseline (e.g. no "spending increased" when last period had no data).
 */
export function generateInsights(i: InsightInputs): Insight[] {
  const out: Insight[] = [];
  const { current: cur, previous: prev } = i;

  // spending vs previous period, compared at the same point in the period
  if (prev.expenseMinor > 0 && i.daysTotal > 0) {
    const prevSameDay = Math.round((prev.expenseMinor * i.daysElapsed) / i.daysTotal);
    const ch = pctChange(cur.expenseMinor, prevSameDay);
    if (ch !== null && ch >= 15) out.push({ kind: 'spendingUp', severity: 'warn', params: { pct: ch } });
    else if (ch !== null && ch <= -15) out.push({ kind: 'spendingDown', severity: 'good', params: { pct: -ch } });
  }

  // a single category dominating spending
  if (cur.expenseMinor > 0) {
    const top = topEntries(cur.expenseByCategory, 1)[0];
    if (top && top[0] !== '_none') {
      const share = Math.round((top[1] / cur.expenseMinor) * 100);
      if (share >= 40 && cur.txnCount >= 3) {
        out.push({ kind: 'categoryShare', severity: 'info', params: { categoryId: top[0], pct: share } });
      }
    }
    // biggest category increase vs previous period
    let best: { id: string; pct: number } | null = null;
    for (const [id, v] of cur.expenseByCategory) {
      if (id === '_none') continue;
      const p = prev.expenseByCategory.get(id) ?? 0;
      if (p <= 0) continue;
      const ch = pctChange(v, p);
      if (ch !== null && ch >= 30 && (!best || ch > best.pct)) best = { id, pct: ch };
    }
    if (best) out.push({ kind: 'categoryUp', severity: 'warn', params: { categoryId: best.id, pct: best.pct } });
  }

  // savings rate trend
  if (cur.savingsRatePct !== null && prev.savingsRatePct !== null) {
    const diff = cur.savingsRatePct - prev.savingsRatePct;
    if (diff >= 5) out.push({ kind: 'savingsRateUp', severity: 'good', params: { from: prev.savingsRatePct, to: cur.savingsRatePct } });
    else if (diff <= -5) out.push({ kind: 'savingsRateDown', severity: 'warn', params: { from: prev.savingsRatePct, to: cur.savingsRatePct } });
  }

  // upcoming obligations vs available balance
  if (i.upcomingObligationsMinor > 0 && i.liquidBalanceMinor < i.upcomingObligationsMinor) {
    out.push({ kind: 'obligationsVsBalance', severity: 'warn', params: { amount: i.upcomingObligationsMinor } });
  }

  // current pace would exceed total budgets by period end
  if (i.totalBudgetMinor > 0 && i.daysElapsed > 0 && i.daysElapsed < i.daysTotal) {
    const projected = Math.round((cur.expenseMinor * i.daysTotal) / i.daysElapsed);
    if (projected > i.totalBudgetMinor && cur.expenseMinor <= i.totalBudgetMinor) {
      out.push({ kind: 'paceOverspend', severity: 'warn', params: { projected, budget: i.totalBudgetMinor } });
    }
  }
  return out;
}
