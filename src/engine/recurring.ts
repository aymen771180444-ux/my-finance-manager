/**
 * Recurring obligations engine — pure date math (no React, no Dexie).
 */

import type { RecurringObligation, RecurringFrequency } from '../db/types';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);

/** Advance a date by one frequency step, clamping month-end (Jan 31 + 1mo = Feb 28). */
export function advance(date: string, frequency: RecurringFrequency, interval: number): string {
  const d = parse(date);
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + interval);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7 * interval);
      break;
    case 'monthly': {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + interval);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
    case 'yearly': {
      const day = d.getDate();
      const month = d.getMonth();
      d.setDate(1);
      d.setFullYear(d.getFullYear() + interval);
      d.setMonth(month);
      const last = new Date(d.getFullYear(), month + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
  }
  return iso(d);
}

type Sched = Pick<RecurringObligation, 'startDate' | 'endDate' | 'frequency' | 'interval'>;

/**
 * The k-th occurrence, always computed from the start date so month-end
 * clamping never drifts (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 */
export function nthOccurrence(ob: Sched, k: number): string {
  return k === 0 ? ob.startDate : advance(ob.startDate, ob.frequency, k * Math.max(1, ob.interval));
}

/** All due dates in (afterDate, uptoDate] — afterDate exclusive, uptoDate inclusive. */
export function occurrencesBetween(ob: Sched, afterDate: string | null, uptoDate: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4000; k++) {
    const due = nthOccurrence(ob, k);
    if (due > uptoDate) break;
    if (ob.endDate && due > ob.endDate) break;
    if (afterDate === null || due > afterDate) out.push(due);
  }
  return out;
}

/** The next due date strictly after `afterDate` (or null when the schedule ended). */
export function nextDueDate(ob: Sched, afterDate: string): string | null {
  for (let k = 0; k < 4000; k++) {
    const due = nthOccurrence(ob, k);
    if (ob.endDate && due > ob.endDate) return null;
    if (due > afterDate) return due;
  }
  return null;
}

/** Date `days` days before `date` (for reminders ahead of the due date). */
export function daysBefore(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() - days);
  return iso(d);
}
