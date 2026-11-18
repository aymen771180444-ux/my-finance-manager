/**
 * Budget engine — pure functions (no React, no Dexie).
 * Budgets are defined in BASE currency (YER); spending comes from each
 * transaction's frozen baseAmountMinor.
 */

import type { Budget, BudgetPeriod } from '../db/types';

export const ALERT_THRESHOLDS = [50, 75, 90, 100] as const;
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);

export interface DateRange {
  from: string;
  to: string;
}

/** The period window containing `refDate` (weeks start on Saturday, common in Yemen/KSA). */
export function periodRange(period: BudgetPeriod, refDate: string): DateRange {
  const d = parse(refDate);
  switch (period) {
    case 'daily':
      return { from: refDate, to: refDate };
    case 'weekly': {
      // JS getDay(): Sun=0 … Sat=6. Week starts Saturday.
      const offset = (d.getDay() + 1) % 7; // Sat->0, Sun->1, … Fri->6
      const start = new Date(d);
      start.setDate(d.getDate() - offset);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: iso(start), to: iso(end) };
    }
    case 'monthly': {
      const start = new Date(d.getFullYear(), d.getMonth(), 1, 12);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
      return { from: iso(start), to: iso(end) };
    }
    case 'yearly':
      return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
  }
}

/** The period window immediately before the one containing `refDate`. */
export function previousPeriodRange(period: BudgetPeriod, refDate: string): DateRange {
  const { from } = periodRange(period, refDate);
  const d = parse(from);
  d.setDate(d.getDate() - 1);
  return periodRange(period, iso(d));
}

/** All period windows of a budget from its startDate up to (and incl.) the one containing refDate. */
export function periodsSince(budget: Pick<Budget, 'period' | 'startDate'>, refDate: string): DateRange[] {
  const out: DateRange[] = [];
  if (budget.startDate > refDate) return out;
  let cursor = budget.startDate;
  // hard cap guards against pathological loops (e.g. 10 years of daily periods)
  for (let i = 0; i < 4000; i++) {
    const range = periodRange(budget.period, cursor);
    out.push(range);
    if (refDate >= range.from && refDate <= range.to) break;
    const next = parse(range.to);
    next.setDate(next.getDate() + 1);
    cursor = iso(next);
  }
  return out;
}

export interface BudgetStatus {
  /** The window being reported (current period). */
  range: DateRange;
  /** The configured per-period limit. */
  limitMinor: number;
  /** Carry from unspent earlier periods (0 when rollover is off). */
  rolloverMinor: number;
  /** limit + rollover. */
  effectiveLimitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** Percent of the effective limit consumed (can exceed 100). */
  pct: number;
  /** Highest alert threshold crossed, or null. */
  crossed: AlertThreshold | null;
}

/**
 * Compute a budget's status for the period containing `refDate`.
 * `spentByRange(range)` returns spending (base minor units) inside a window —
 * the caller queries the DB; this function stays pure.
 */
export function computeBudgetStatus(
  budget: Pick<Budget, 'period' | 'startDate' | 'amountMinor' | 'rolloverEnabled'>,
  refDate: string,
  spentByRange: (range: DateRange) => number,
): BudgetStatus {
  const ranges = periodsSince(budget, refDate);
  const current = ranges.length > 0 ? ranges[ranges.length - 1] : periodRange(budget.period, refDate);
  let rollover = 0;
  if (budget.rolloverEnabled) {
    for (const r of ranges.slice(0, -1)) {
      const unspent = budget.amountMinor - spentByRange(r);
      rollover += unspent; // may be negative when a period overspent
    }
    if (rollover < 0) rollover = 0; // overspending never shrinks future budgets below the base limit
  }
  const spent = spentByRange(current);
  const effective = budget.amountMinor + rollover;
  const pct = effective > 0 ? Math.round((spent / effective) * 100) : spent > 0 ? 100 : 0;
  let crossed: AlertThreshold | null = null;
  for (const th of ALERT_THRESHOLDS) if (pct >= th) crossed = th;
  return {
    range: current,
    limitMinor: budget.amountMinor,
    rolloverMinor: rollover,
    effectiveLimitMinor: effective,
    spentMinor: spent,
    remainingMinor: effective - spent,
    pct,
    crossed,
  };
}
