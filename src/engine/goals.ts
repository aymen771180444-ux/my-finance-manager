/**
 * Savings-goal estimates — pure functions.
 */

import type { SavingsGoal, SavingsContribution } from '../db/types';

export function goalProgressPct(goal: Pick<SavingsGoal, 'targetMinor' | 'savedMinor'>): number {
  if (goal.targetMinor <= 0) return 0;
  return Math.min(100, Math.round((goal.savedMinor / goal.targetMinor) * 100));
}

/**
 * Estimate the completion date from the planned monthly amount, or from the
 * average contribution pace over the recorded history. Returns null when there
 * is no basis for an estimate — the UI must say so, never guess.
 */
export function estimateCompletionDate(
  goal: Pick<SavingsGoal, 'targetMinor' | 'savedMinor' | 'autoMonthlyMinor'>,
  contributions: Pick<SavingsContribution, 'amountMinor' | 'date'>[],
  today: string,
): string | null {
  const remaining = goal.targetMinor - goal.savedMinor;
  if (remaining <= 0) return today;
  let perMonth = goal.autoMonthlyMinor;
  if (perMonth <= 0 && contributions.length > 0) {
    const dates = contributions.map((c) => c.date).sort();
    const total = contributions.reduce((s, c) => s + c.amountMinor, 0);
    if (total <= 0) return null;
    const first = new Date(`${dates[0]}T12:00:00`);
    const now = new Date(`${today}T12:00:00`);
    const months = Math.max(1, (now.getTime() - first.getTime()) / (30.44 * 24 * 3600 * 1000));
    perMonth = total / months;
  }
  if (perMonth <= 0) return null;
  const monthsLeft = Math.ceil(remaining / perMonth);
  if (monthsLeft > 1200) return null; // more than 100 years — not a meaningful estimate
  const d = new Date(`${today}T12:00:00`);
  d.setMonth(d.getMonth() + monthsLeft);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
