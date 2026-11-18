import { db, newId, nowISO } from './schema';
import type { Budget, BudgetPeriod, Transaction } from './types';
import { recordMutation } from './audit';
import { computeBudgetStatus, type BudgetStatus, type DateRange } from '../engine/budgets';
import { totalsContribution } from '../engine/posting';

export interface BudgetInput {
  profileId: string;
  name: string;
  categoryId?: string | null;
  period: BudgetPeriod;
  amountMinor: number;
  startDate: string;
  endDate?: string | null;
  rolloverEnabled?: boolean;
  alertsEnabled?: boolean;
}

export async function createBudget(input: BudgetInput): Promise<Budget> {
  if (!input.name.trim()) throw new Error('Budget name is required');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Budget amount must be positive');
  }
  return db.transaction('rw', [db.budgets, db.auditLog, db.syncQueue], async () => {
    const ts = nowISO();
    const budget: Budget = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: input.profileId,
      name: input.name.trim(),
      categoryId: input.categoryId ?? null,
      period: input.period,
      amountMinor: input.amountMinor,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      rolloverEnabled: input.rolloverEnabled ?? true,
      alertsEnabled: input.alertsEnabled ?? true,
      isArchived: false,
    };
    await db.budgets.add(budget);
    await recordMutation({ profileId: budget.profileId, table: 'budgets', rowId: budget.id, action: 'create', before: null, after: budget });
    return budget;
  });
}

export async function updateBudget(
  id: string,
  changes: Partial<Pick<Budget, 'name' | 'amountMinor' | 'rolloverEnabled' | 'alertsEnabled' | 'endDate' | 'isArchived'>>,
): Promise<void> {
  return db.transaction('rw', [db.budgets, db.auditLog, db.syncQueue], async () => {
    const before = await db.budgets.get(id);
    if (!before) throw new Error('Budget not found');
    const after = { ...before, ...changes, updatedAt: nowISO() };
    await db.budgets.put(after);
    await recordMutation({ profileId: before.profileId, table: 'budgets', rowId: id, action: 'update', before, after });
  });
}

export async function deleteBudget(id: string): Promise<void> {
  return db.transaction('rw', [db.budgets, db.trash, db.auditLog, db.syncQueue], async () => {
    const budget = await db.budgets.get(id);
    if (!budget) throw new Error('Budget not found');
    await db.budgets.delete(id);
    const ts = nowISO();
    await db.trash.add({
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: budget.profileId,
      table: 'budgets',
      rowId: id,
      payload: JSON.stringify({ budget }),
      label: budget.name,
      deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: budget.profileId, table: 'budgets', rowId: id, action: 'delete', before: budget, after: null });
  });
}

export async function restoreBudget(trashId: string): Promise<void> {
  return db.transaction('rw', [db.budgets, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'budgets') throw new Error('Trash entry not found');
    const { budget } = JSON.parse(entry.payload) as { budget: Budget };
    await db.budgets.add(budget);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: budget.profileId, table: 'budgets', rowId: budget.id, action: 'restore', before: null, after: budget });
  });
}

/**
 * Spending charged against a budget inside a window, in BASE minor units.
 * Overall budgets (categoryId null) count every expense; category budgets
 * count that category and its subcategories, split-aware.
 */
export function spentForBudget(
  budget: Pick<Budget, 'categoryId'>,
  txns: Transaction[],
  splitsByTxn: Map<string, { categoryId: string; amountMinor: number }[]>,
  categoryIds: Set<string> | null, // budget category + its subcategory ids; null for overall
  range: DateRange,
): number {
  let spent = 0;
  for (const t of txns) {
    if (t.date < range.from || t.date > range.to) continue;
    const c = totalsContribution(t);
    if (c.expenseMinor === 0) continue;
    if (budget.categoryId === null) {
      spent += c.expenseMinor; // refunds subtract via negative contribution
      continue;
    }
    if (t.baseAmountMinor === null) continue;
    const lines = t.hasSplits ? splitsByTxn.get(t.id) : undefined;
    if (lines?.length) {
      for (const s of lines) {
        if (categoryIds!.has(s.categoryId)) {
          spent += Math.round((t.baseAmountMinor * s.amountMinor) / t.amountMinor);
        }
      }
    } else if (
      (t.categoryId && categoryIds!.has(t.categoryId)) ||
      (t.subcategoryId && categoryIds!.has(t.subcategoryId))
    ) {
      spent += c.expenseMinor;
    }
  }
  return spent;
}

/** Full DB-backed status for one budget at `refDate`. */
export async function budgetStatus(budget: Budget, refDate: string): Promise<BudgetStatus> {
  const txns = await db.transactions
    .where('[profileId+date]')
    .between([budget.profileId, budget.startDate], [budget.profileId, refDate + '￿'])
    .toArray();
  const splitParents = txns.filter((t) => t.hasSplits).map((t) => t.id);
  const splitsByTxn = new Map<string, { categoryId: string; amountMinor: number }[]>();
  if (splitParents.length > 0) {
    const splits = await db.splits.where('transactionId').anyOf(splitParents).toArray();
    for (const s of splits) {
      const arr = splitsByTxn.get(s.transactionId) ?? [];
      arr.push({ categoryId: s.categoryId, amountMinor: s.amountMinor });
      splitsByTxn.set(s.transactionId, arr);
    }
  }
  let categoryIds: Set<string> | null = null;
  if (budget.categoryId) {
    categoryIds = new Set([budget.categoryId]);
    const children = await db.categories
      .where('[profileId+parentId]')
      .equals([budget.profileId, budget.categoryId])
      .toArray();
    for (const ch of children) categoryIds.add(ch.id);
  }
  return computeBudgetStatus(budget, refDate, (range) =>
    spentForBudget(budget, txns, splitsByTxn, categoryIds, range),
  );
}
