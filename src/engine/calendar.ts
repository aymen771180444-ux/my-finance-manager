/**
 * Financial calendar — pure helpers (Gregorian + Hijri Umm al-Qura via Intl).
 */

import type { Debt, RecurringObligation, SavingsGoal, SavingsContribution, Transaction } from '../db/types';
import { advance, occurrencesBetween } from './recurring';
import { totalsContribution } from './posting';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);
function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric' });

export function hijriParts(date: string): { year: number; month: number; day: number } {
  const parts = hijriFmt.formatToParts(parse(date));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export interface MonthGrid {
  /** ISO dates of every day in the month, in order. */
  days: string[];
  /** Blank cells before day 1 for a Saturday-first week. */
  leadingBlanks: number;
  /** Any date inside the previous / next month, for navigation. */
  prevAnchor: string;
  nextAnchor: string;
}

/** Month containing `anchor`, in the chosen calendar. */
export function monthGrid(anchor: string, calendar: 'gregorian' | 'hijri'): MonthGrid {
  let first: string;
  let last: string;
  if (calendar === 'gregorian') {
    const d = parse(anchor);
    first = iso(new Date(d.getFullYear(), d.getMonth(), 1, 12));
    last = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  } else {
    const h = hijriParts(anchor);
    first = addDays(anchor, -(h.day - 1));
    last = first;
    // Hijri months are 29 or 30 days
    for (let i = 0; i < 31; i++) {
      const next = addDays(last, 1);
      if (hijriParts(next).month !== h.month) break;
      last = next;
    }
  }
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const leadingBlanks = (parse(first).getDay() + 1) % 7; // Sat=0 … Fri=6
  return { days, leadingBlanks, prevAnchor: addDays(first, -1), nextAnchor: addDays(last, 1) };
}

export type CalendarEventKind = 'income' | 'expense' | 'recurring' | 'debtDue' | 'installment' | 'goalDeadline' | 'contribution';

export interface CalendarEvent {
  date: string;
  kind: CalendarEventKind;
  label: string;
  /** Minor units in `currency` (base YER for income/expense day totals). */
  amountMinor: number | null;
  currency: string;
  /** true for scheduled/expected items, false for recorded transactions. */
  scheduled: boolean;
}

/** Installment due dates for a debt plan: as many as needed to cover the principal. */
export function installmentDates(d: Pick<Debt, 'startDate' | 'principalMinor' | 'installmentMinor' | 'installmentPeriod'>): string[] {
  if (!d.installmentMinor || d.installmentMinor <= 0 || !d.installmentPeriod) return [];
  const n = Math.min(600, Math.ceil(d.principalMinor / d.installmentMinor));
  const out: string[] = [];
  // first installment one period after the start; each computed from the start to avoid drift
  for (let i = 1; i <= n; i++) out.push(advance(d.startDate, d.installmentPeriod, i));
  return out;
}

export function collectEvents(
  from: string,
  to: string,
  input: {
    txns: Transaction[];
    recurring: (RecurringObligation & { currency: string })[];
    debts: Debt[];
    goals: SavingsGoal[];
    contributions: (SavingsContribution & { currency: string; goalName: string })[];
    today: string;
  },
): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  const push = (e: CalendarEvent) => {
    if (e.date < from || e.date > to) return;
    const arr = out.get(e.date) ?? [];
    arr.push(e);
    out.set(e.date, arr);
  };
  // recorded income / expense, totalled per day (base currency)
  const inc = new Map<string, number>();
  const exp = new Map<string, number>();
  for (const t of input.txns) {
    const c = totalsContribution(t);
    if (c.incomeMinor) inc.set(t.date, (inc.get(t.date) ?? 0) + c.incomeMinor);
    if (c.expenseMinor) exp.set(t.date, (exp.get(t.date) ?? 0) + c.expenseMinor);
  }
  for (const [date, v] of inc) push({ date, kind: 'income', label: '', amountMinor: v, currency: 'YER', scheduled: false });
  for (const [date, v] of exp) push({ date, kind: 'expense', label: '', amountMinor: v, currency: 'YER', scheduled: false });
  // recurring: future occurrences only (past ones are already transactions or reminders)
  for (const r of input.recurring) {
    if (r.status !== 'active') continue;
    const start = input.today > from ? addDays(input.today, -1) : addDays(from, -1);
    for (const date of occurrencesBetween(r, start, to)) {
      push({ date, kind: 'recurring', label: r.name, amountMinor: r.amountMinor, currency: r.currency, scheduled: true });
    }
  }
  for (const d of input.debts) {
    if (d.status !== 'open') continue;
    if (d.dueDate) push({ date: d.dueDate, kind: 'debtDue', label: d.person, amountMinor: d.remainingMinor, currency: d.currency, scheduled: true });
    for (const date of installmentDates(d)) {
      push({ date, kind: 'installment', label: d.person, amountMinor: d.installmentMinor, currency: d.currency, scheduled: true });
    }
  }
  for (const g of input.goals) {
    if (g.targetDate && g.status === 'active') {
      push({ date: g.targetDate, kind: 'goalDeadline', label: g.name, amountMinor: g.targetMinor - g.savedMinor, currency: g.currency, scheduled: true });
    }
  }
  for (const c of input.contributions) {
    push({ date: c.date, kind: 'contribution', label: c.goalName, amountMinor: c.amountMinor, currency: c.currency, scheduled: false });
  }
  return out;
}
