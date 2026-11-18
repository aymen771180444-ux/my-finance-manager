import { db } from './schema';
import { contributeToGoal, updateGoal } from './goals';
import { notifyOnce } from './notifications';
import type { SavingsGoal } from './types';

const ym = (date: string) => date.slice(0, 7);
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/**
 * Turn automatic monthly saving on/off. It never back-fills: if this month's
 * day has already passed, the first transfer happens next month.
 */
export async function setGoalAutoSave(
  goalId: string,
  cfg: { amountMinor: number; fromAccountId: string; day: number } | null,
  today: string,
): Promise<void> {
  if (!cfg) {
    await updateGoal(goalId, { autoFromAccountId: null, autoDay: null, autoLastMonth: null });
    return;
  }
  const goal = await db.savingsGoals.get(goalId);
  if (!goal) throw new Error('Goal not found');
  if (!goal.linkedAccountId) throw new Error('GOAL_NOT_LINKED');
  if (cfg.fromAccountId === goal.linkedAccountId) throw new Error('SAME_ACCOUNT');
  const from = await db.accounts.get(cfg.fromAccountId);
  if (!from || from.currency !== goal.currency) throw new Error('GOAL_ACCOUNT_CURRENCY_MISMATCH');
  if (!Number.isSafeInteger(cfg.amountMinor) || cfg.amountMinor <= 0) throw new Error('Amount must be positive');
  const day = Math.min(28, Math.max(1, Math.round(cfg.day)));
  const dayToday = Number(today.slice(8, 10));
  await updateGoal(goalId, {
    autoMonthlyMinor: cfg.amountMinor,
    autoFromAccountId: cfg.fromAccountId,
    autoDay: day,
    // mark the current month done when its day already passed (no back-fill)
    autoLastMonth: dayToday >= day ? ym(today) : prevMonth(ym(today)),
  });
}

/**
 * Catch-up runner (app start / focus): performs every due monthly transfer
 * since the last processed month. Skips — never overdraws — when the source
 * account lacks the balance, and says so in a notification. Idempotent.
 */
export async function processGoalAutoSave(profileId: string, today: string): Promise<number> {
  const goals = (await db.savingsGoals.where('profileId').equals(profileId).toArray()).filter(
    (g: SavingsGoal) => g.status === 'active' && g.autoFromAccountId && g.autoDay && g.autoMonthlyMinor > 0 && g.linkedAccountId && g.autoLastMonth,
  );
  let done = 0;
  for (const g of goals) {
    let month = nextMonth(g.autoLastMonth!);
    while (month <= ym(today)) {
      const date = `${month}-${String(g.autoDay).padStart(2, '0')}`;
      if (date > today) break;
      const fresh = (await db.savingsGoals.get(g.id))!;
      if (fresh.status !== 'active') break;
      const remaining = fresh.targetMinor - fresh.savedMinor;
      const amount = Math.min(fresh.autoMonthlyMinor, remaining); // never save past the target
      const from = await db.accounts.get(g.autoFromAccountId!);
      const entryId = `autosave:${g.id}:${month}`;
      if (await db.savingsContributions.get(entryId)) {
        // already made on another synced device
      } else if (amount > 0 && from && from.currentBalanceMinor >= amount) {
        await contributeToGoal({ goalId: g.id, amountMinor: amount, date, fromAccountId: g.autoFromAccountId!, notes: g.name, id: entryId });
        await notifyOnce({ profileId, kind: 'goal', titleKey: 'autoSave.done', params: { name: g.name, amountMinor: amount }, dedupe: `autosave:${g.id}:${month}`, refId: g.id });
        done++;
      } else if (amount > 0) {
        await notifyOnce({ profileId, kind: 'goal', titleKey: 'autoSave.skipped', params: { name: g.name }, dedupe: `autosave-skip:${g.id}:${month}`, refId: g.id });
      }
      await db.savingsGoals.update(g.id, { autoLastMonth: month });
      month = nextMonth(month);
    }
  }
  return done;
}
