import { db, newId, nowISO } from './schema';
import type { SavingsGoal, SavingsContribution } from './types';
import type { CurrencyCode } from '../engine/money';
import { recordMutation } from './audit';
import { createTransaction, TXN_TABLES } from './transactions';

export interface GoalInput {
  profileId: string;
  name: string;
  targetMinor: number;
  currency: CurrencyCode;
  targetDate?: string | null;
  linkedAccountId?: string | null;
  autoMonthlyMinor?: number;
  notes?: string;
}

export async function createGoal(input: GoalInput): Promise<SavingsGoal> {
  if (!input.name.trim()) throw new Error('Goal name is required');
  if (!Number.isSafeInteger(input.targetMinor) || input.targetMinor <= 0) {
    throw new Error('Target must be positive');
  }
  return db.transaction('rw', [db.savingsGoals, db.accounts, db.auditLog, db.syncQueue], async () => {
    if (input.linkedAccountId) {
      const acc = await db.accounts.get(input.linkedAccountId);
      if (!acc) throw new Error('Account not found');
      if (acc.currency !== input.currency) throw new Error('GOAL_ACCOUNT_CURRENCY_MISMATCH');
    }
    const ts = nowISO();
    const goal: SavingsGoal = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: input.profileId,
      name: input.name.trim(),
      targetMinor: input.targetMinor,
      currency: input.currency,
      targetDate: input.targetDate ?? null,
      linkedAccountId: input.linkedAccountId ?? null,
      savedMinor: 0,
      autoMonthlyMinor: input.autoMonthlyMinor ?? 0,
      notes: input.notes ?? '',
      status: 'active',
    };
    await db.savingsGoals.add(goal);
    await recordMutation({ profileId: goal.profileId, table: 'savingsGoals', rowId: goal.id, action: 'create', before: null, after: goal });
    return goal;
  });
}

/**
 * Deposit into (positive) or withdraw from (negative) a goal.
 * When the goal has a linked account and `fromAccountId` is given, the money
 * moves as a same-currency TRANSFER — never income or expense (PRD rule).
 */
export async function contributeToGoal(opts: {
  goalId: string;
  amountMinor: number; // positive = deposit, negative = withdrawal
  date: string;
  fromAccountId?: string | null; // for deposits: source; for withdrawals: destination
  notes?: string;
  /** Fixed id for automatic entries (the transfer gets "<id>:txn"). */
  id?: string;
}): Promise<SavingsGoal> {
  if (!Number.isSafeInteger(opts.amountMinor) || opts.amountMinor === 0) {
    throw new Error('Amount must be non-zero');
  }
  return db.transaction(
    'rw',
    TXN_TABLES,
    async () => {
      const before = await db.savingsGoals.get(opts.goalId);
      if (!before) throw new Error('Goal not found');
      if (opts.amountMinor < 0 && -opts.amountMinor > before.savedMinor) {
        throw new Error('WITHDRAWAL_EXCEEDS_SAVED');
      }
      let txnId: string | null = null;
      if (before.linkedAccountId && opts.fromAccountId) {
        const isDeposit = opts.amountMinor > 0;
        const txn = await createTransaction({
          profileId: before.profileId,
          type: 'transfer',
          amountMinor: Math.abs(opts.amountMinor),
          accountId: isDeposit ? opts.fromAccountId : before.linkedAccountId,
          toAccountId: isDeposit ? before.linkedAccountId : opts.fromAccountId,
          date: opts.date,
          notes: opts.notes ?? before.name,
          goalId: before.id,
          id: opts.id ? `${opts.id}:txn` : undefined,
        });
        txnId = txn.id;
      }
      const ts = nowISO();
      await db.savingsContributions.add({
        id: opts.id ?? newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: before.profileId,
        goalId: before.id,
        amountMinor: opts.amountMinor,
        date: opts.date,
        txnId,
        notes: opts.notes ?? '',
      });
      const saved = before.savedMinor + opts.amountMinor;
      const after: SavingsGoal = {
        ...before,
        savedMinor: saved,
        status: saved >= before.targetMinor ? 'completed' : 'active',
        updatedAt: ts,
      };
      await db.savingsGoals.put(after);
      await recordMutation({ profileId: before.profileId, table: 'savingsGoals', rowId: before.id, action: 'update', before, after });
      return after;
    },
  );
}

export async function updateGoal(
  id: string,
  changes: Partial<Pick<SavingsGoal, 'name' | 'targetMinor' | 'targetDate' | 'autoMonthlyMinor' | 'notes' | 'status' | 'autoFromAccountId' | 'autoDay' | 'autoLastMonth'>>,
): Promise<void> {
  return db.transaction('rw', [db.savingsGoals, db.auditLog, db.syncQueue], async () => {
    const before = await db.savingsGoals.get(id);
    if (!before) throw new Error('Goal not found');
    const after = { ...before, ...changes, updatedAt: nowISO() };
    if (after.targetMinor > 0 && after.savedMinor >= after.targetMinor) after.status = 'completed';
    await db.savingsGoals.put(after);
    await recordMutation({ profileId: before.profileId, table: 'savingsGoals', rowId: id, action: 'update', before, after });
  });
}

/** Delete a goal (its contributions history goes with it; linked transfers stay). */
export async function deleteGoal(id: string): Promise<void> {
  return db.transaction('rw', [db.savingsGoals, db.savingsContributions, db.trash, db.auditLog, db.syncQueue], async () => {
    const goal = await db.savingsGoals.get(id);
    if (!goal) throw new Error('Goal not found');
    const contributions = await db.savingsContributions.where('goalId').equals(id).toArray();
    await db.savingsContributions.where('goalId').equals(id).delete();
    await db.savingsGoals.delete(id);
    const ts = nowISO();
    await db.trash.add({
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: goal.profileId,
      table: 'savingsGoals',
      rowId: id,
      payload: JSON.stringify({ goal, contributions }),
      label: goal.name,
      deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: goal.profileId, table: 'savingsGoals', rowId: id, action: 'delete', before: goal, after: null });
  });
}

export async function restoreGoal(trashId: string): Promise<void> {
  return db.transaction('rw', [db.savingsGoals, db.savingsContributions, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'savingsGoals') throw new Error('Trash entry not found');
    const { goal, contributions } = JSON.parse(entry.payload) as { goal: SavingsGoal; contributions: SavingsContribution[] };
    await db.savingsGoals.add(goal);
    for (const c of contributions) await db.savingsContributions.add(c);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: goal.profileId, table: 'savingsGoals', rowId: goal.id, action: 'restore', before: null, after: goal });
  });
}
