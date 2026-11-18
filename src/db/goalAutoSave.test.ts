import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { createGoal } from './goals';
import { setGoalAutoSave, processGoalAutoSave } from './goalAutoSave';
import { totalsContribution } from '../engine/posting';

let profileId: string;
let bank: string;
let savings: string;
let goalId: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  profileId = (await createProfile('T')).id;
  bank = (await createAccount({ profileId, name: 'Bank', type: 'bank', currency: 'YER', openingBalanceMinor: 100_000, openedAt: '2026-01-01' })).id;
  savings = (await createAccount({ profileId, name: 'Savings', type: 'savings', currency: 'YER', openingBalanceMinor: 0, openedAt: '2026-01-01' })).id;
  goalId = (await createGoal({ profileId, name: 'Hajj', targetMinor: 1_000_000, currency: 'YER', linkedAccountId: savings })).id;
});

const bal = async (id: string) => (await db.accounts.get(id))!.currentBalanceMinor;

describe('automatic monthly goal saving', () => {
  it('no back-fill: enabling after this month\'s day starts next month', async () => {
    await setGoalAutoSave(goalId, { amountMinor: 20_000, fromAccountId: bank, day: 5 }, '2026-03-10');
    expect(await processGoalAutoSave(profileId, '2026-03-10')).toBe(0);
    expect(await processGoalAutoSave(profileId, '2026-04-05')).toBe(1);
    expect(await bal(savings)).toBe(20_000);
  });

  it('catches up missed months exactly once, as transfers (never expenses)', async () => {
    await setGoalAutoSave(goalId, { amountMinor: 20_000, fromAccountId: bank, day: 1 }, '2026-01-01');
    expect(await processGoalAutoSave(profileId, '2026-04-15')).toBe(3); // Feb, Mar, Apr
    expect(await processGoalAutoSave(profileId, '2026-04-15')).toBe(0); // idempotent
    expect(await bal(bank)).toBe(40_000);
    expect((await db.savingsGoals.get(goalId))!.savedMinor).toBe(60_000);
    for (const t of await db.transactions.toArray()) {
      expect(t.type).toBe('transfer');
      expect(totalsContribution(t).expenseMinor).toBe(0);
    }
  });

  it('skips (and notifies) instead of overdrawing the source account', async () => {
    await setGoalAutoSave(goalId, { amountMinor: 80_000, fromAccountId: bank, day: 1 }, '2026-01-01');
    expect(await processGoalAutoSave(profileId, '2026-03-02')).toBe(1); // Feb ok, Mar skipped (20k left)
    expect(await bal(bank)).toBe(20_000);
    const notes = await db.notifications.toArray();
    expect(notes.some((n) => n.titleKey === 'autoSave.skipped')).toBe(true);
  });

  it('never saves past the target', async () => {
    await db.savingsGoals.update(goalId, { targetMinor: 30_000 });
    await setGoalAutoSave(goalId, { amountMinor: 20_000, fromAccountId: bank, day: 1 }, '2026-01-01');
    await processGoalAutoSave(profileId, '2026-05-01');
    const g = (await db.savingsGoals.get(goalId))!;
    expect(g.savedMinor).toBe(30_000);
    expect(g.status).toBe('completed');
  });

  it('requires a linked savings account and a different same-currency source', async () => {
    const unlinked = (await createGoal({ profileId, name: 'Phone', targetMinor: 1000, currency: 'YER' })).id;
    await expect(setGoalAutoSave(unlinked, { amountMinor: 100, fromAccountId: bank, day: 1 }, '2026-01-01')).rejects.toThrow('GOAL_NOT_LINKED');
    await expect(setGoalAutoSave(goalId, { amountMinor: 100, fromAccountId: savings, day: 1 }, '2026-01-01')).rejects.toThrow('SAME_ACCOUNT');
  });
});
