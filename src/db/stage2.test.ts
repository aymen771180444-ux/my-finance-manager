import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { createTransaction, deleteTransaction, restoreTransaction } from './transactions';
import { createDebt, repayDebt, deleteDebt } from './debts';
import { createGoal, contributeToGoal } from './goals';
import { createBudget, budgetStatus } from './budgets';
import { createRecurring, processRecurring } from './recurring';
import { checkBudgets, checkDebts } from '../services/scheduler';
import { totalsContribution } from '../engine/posting';

let profileId: string;
let cash: string;
let bank: string;
let savings: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const p = await createProfile('Test');
  profileId = p.id;
  cash = (await createAccount({ profileId, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 200_000, openedAt: todayISO() })).id;
  bank = (await createAccount({ profileId, name: 'Bank', type: 'bank', currency: 'YER', openingBalanceMinor: 500_000, openedAt: todayISO() })).id;
  savings = (await createAccount({ profileId, name: 'Savings', type: 'savings', currency: 'YER', openingBalanceMinor: 0, openedAt: todayISO() })).id;
});

const balance = async (id: string) => (await db.accounts.get(id))!.currentBalanceMinor;

describe('debts (acceptance #12)', () => {
  it('lending moves money out and tracks the receivable', async () => {
    const debt = await createDebt({
      profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 50_000,
      currency: 'YER', startDate: todayISO(), moveAccountId: cash,
    });
    expect(await balance(cash)).toBe(150_000);
    expect(debt.remainingMinor).toBe(50_000);
    const lendTxn = (await db.transactions.where('debtId').equals(debt.id).toArray())[0];
    expect(totalsContribution(lendTxn).expenseMinor).toBe(0); // lending is not an expense
  });

  it('partial repayment updates the outstanding balance; full repayment settles', async () => {
    const debt = await createDebt({
      profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 50_000,
      currency: 'YER', startDate: todayISO(), moveAccountId: cash,
    });
    let after = await repayDebt({ debtId: debt.id, amountMinor: 20_000, date: todayISO(), accountId: cash });
    expect(after.remainingMinor).toBe(30_000);
    expect(after.status).toBe('open');
    expect(await balance(cash)).toBe(170_000);
    after = await repayDebt({ debtId: debt.id, amountMinor: 30_000, date: todayISO(), accountId: cash });
    expect(after.remainingMinor).toBe(0);
    expect(after.status).toBe('settled');
    expect(await balance(cash)).toBe(200_000);
    const repayments = await db.transactions.where('debtId').equals(debt.id).toArray();
    expect(repayments.filter((t) => t.type === 'debt_repayment')).toHaveLength(2); // repayment history kept
  });

  it('borrowing works in the opposite direction', async () => {
    const debt = await createDebt({
      profileId, person: 'Bank X', direction: 'i_owe', principalMinor: 100_000,
      currency: 'YER', startDate: todayISO(), moveAccountId: bank,
    });
    expect(await balance(bank)).toBe(600_000);
    await repayDebt({ debtId: debt.id, amountMinor: 40_000, date: todayISO(), accountId: bank });
    expect(await balance(bank)).toBe(560_000);
    expect((await db.debts.get(debt.id))!.remainingMinor).toBe(60_000);
  });

  it('rejects over-repayment', async () => {
    const debt = await createDebt({ profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 10_000, currency: 'YER', startDate: todayISO() });
    await expect(repayDebt({ debtId: debt.id, amountMinor: 20_000, date: todayISO() })).rejects.toThrow('REPAYMENT_EXCEEDS_REMAINING');
  });

  it('deleting a repayment transaction rolls the debt balance back', async () => {
    const debt = await createDebt({ profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 50_000, currency: 'YER', startDate: todayISO(), moveAccountId: cash });
    await repayDebt({ debtId: debt.id, amountMinor: 50_000, date: todayISO(), accountId: cash });
    expect((await db.debts.get(debt.id))!.status).toBe('settled');
    const repayment = (await db.transactions.where('debtId').equals(debt.id).toArray()).find((t) => t.type === 'debt_repayment')!;
    await deleteTransaction(repayment.id);
    const d = (await db.debts.get(debt.id))!;
    expect(d.remainingMinor).toBe(50_000);
    expect(d.status).toBe('open');
    expect(await balance(cash)).toBe(150_000);
  });

  it('deleting a debt removes its transactions and restores balances', async () => {
    const debt = await createDebt({ profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 50_000, currency: 'YER', startDate: todayISO(), moveAccountId: cash });
    await deleteDebt(debt.id);
    expect(await balance(cash)).toBe(200_000);
    expect(await db.debts.get(debt.id)).toBeUndefined();
  });
});

describe('savings goals (acceptance #9)', () => {
  it('a linked-account contribution is a TRANSFER — never income or expense', async () => {
    const goal = await createGoal({ profileId, name: 'Hajj', targetMinor: 300_000, currency: 'YER', linkedAccountId: savings });
    const after = await contributeToGoal({ goalId: goal.id, amountMinor: 50_000, date: todayISO(), fromAccountId: bank });
    expect(after.savedMinor).toBe(50_000);
    expect(await balance(bank)).toBe(450_000);
    expect(await balance(savings)).toBe(50_000);
    const txn = (await db.transactions.where('goalId').equals(goal.id).toArray())[0];
    expect(txn.type).toBe('transfer');
    const c = totalsContribution(txn);
    expect(c.incomeMinor).toBe(0);
    expect(c.expenseMinor).toBe(0);
  });

  it('withdrawals reduce savings and cannot exceed the saved amount', async () => {
    const goal = await createGoal({ profileId, name: 'Hajj', targetMinor: 300_000, currency: 'YER', linkedAccountId: savings });
    await contributeToGoal({ goalId: goal.id, amountMinor: 50_000, date: todayISO(), fromAccountId: bank });
    await contributeToGoal({ goalId: goal.id, amountMinor: -20_000, date: todayISO(), fromAccountId: bank });
    expect((await db.savingsGoals.get(goal.id))!.savedMinor).toBe(30_000);
    expect(await balance(bank)).toBe(470_000);
    expect(await balance(savings)).toBe(30_000);
    await expect(contributeToGoal({ goalId: goal.id, amountMinor: -40_000, date: todayISO(), fromAccountId: bank })).rejects.toThrow('WITHDRAWAL_EXCEEDS_SAVED');
  });

  it('deleting a goal deposit corrects the goal; restoring re-applies it', async () => {
    const goal = await createGoal({ profileId, name: 'Hajj', targetMinor: 300_000, currency: 'YER', linkedAccountId: savings });
    await contributeToGoal({ goalId: goal.id, amountMinor: 50_000, date: todayISO(), fromAccountId: bank });
    const txn = (await db.transactions.where('goalId').equals(goal.id).toArray())[0];
    await deleteTransaction(txn.id);
    expect((await db.savingsGoals.get(goal.id))!.savedMinor).toBe(0);
    expect(await db.savingsContributions.where('goalId').equals(goal.id).count()).toBe(0);
    expect(await balance(savings)).toBe(0);
    const trash = (await db.trash.toArray()).find((e) => e.rowId === txn.id)!;
    await restoreTransaction(trash.id);
    expect((await db.savingsGoals.get(goal.id))!.savedMinor).toBe(50_000);
    expect(await balance(savings)).toBe(50_000);
  });

  it('reaching the target marks the goal completed', async () => {
    const goal = await createGoal({ profileId, name: 'Phone', targetMinor: 100_000, currency: 'YER' });
    const after = await contributeToGoal({ goalId: goal.id, amountMinor: 100_000, date: todayISO() });
    expect(after.status).toBe('completed');
  });
});

describe('budgets (acceptance #13, #14)', () => {
  it('status reflects spending; alerts fire once per threshold', async () => {
    const food = (await db.categories.toArray()).find((c) => c.nameKey === 'food')!;
    const b = await createBudget({
      profileId, name: 'Food budget', categoryId: food.id, period: 'monthly',
      amountMinor: 100_000, startDate: todayISO().slice(0, 8) + '01',
    });
    await createTransaction({ profileId, type: 'expense', amountMinor: 60_000, accountId: cash, categoryId: food.id, date: todayISO() });
    let s = await budgetStatus((await db.budgets.get(b.id))!, todayISO());
    expect(s.spentMinor).toBe(60_000);
    expect(s.crossed).toBe(50);
    await checkBudgets(profileId);
    await checkBudgets(profileId); // second run must not duplicate
    const notifs = await db.notifications.where('profileId').equals(profileId).toArray();
    expect(notifs.filter((n) => n.kind === 'budget')).toHaveLength(1);
    // push over 100%
    await createTransaction({ profileId, type: 'expense', amountMinor: 50_000, accountId: cash, categoryId: food.id, date: todayISO() });
    s = await budgetStatus((await db.budgets.get(b.id))!, todayISO());
    expect(s.crossed).toBe(100);
    expect(s.remainingMinor).toBe(-10_000); // overspending allowed, surfaced
    await checkBudgets(profileId);
    const after = await db.notifications.where('profileId').equals(profileId).toArray();
    expect(after.filter((n) => n.kind === 'budget')).toHaveLength(2); // 50 earlier + 100 now
  });

  it('subcategory spending counts toward the parent-category budget', async () => {
    const cats = await db.categories.toArray();
    const food = cats.find((c) => c.nameKey === 'food')!;
    const groceries = cats.find((c) => c.nameKey === 'groceries')!;
    const b = await createBudget({ profileId, name: 'Food', categoryId: food.id, period: 'monthly', amountMinor: 100_000, startDate: todayISO().slice(0, 8) + '01' });
    await createTransaction({ profileId, type: 'expense', amountMinor: 30_000, accountId: cash, categoryId: groceries.id, date: todayISO() });
    const s = await budgetStatus((await db.budgets.get(b.id))!, todayISO());
    expect(s.spentMinor).toBe(30_000);
  });

  it('transfers never count against budgets', async () => {
    const b = await createBudget({ profileId, name: 'Overall', period: 'monthly', amountMinor: 100_000, startDate: todayISO().slice(0, 8) + '01' });
    await createTransaction({ profileId, type: 'transfer', amountMinor: 90_000, accountId: bank, toAccountId: cash, date: todayISO() });
    const s = await budgetStatus((await db.budgets.get(b.id))!, todayISO());
    expect(s.spentMinor).toBe(0);
  });
});

describe('recurring obligations', () => {
  it('auto mode creates the transaction due today, exactly once', async () => {
    await createRecurring({
      profileId, name: 'Rent', kind: 'expense', amountMinor: 80_000, accountId: bank,
      frequency: 'monthly', startDate: todayISO(), mode: 'auto',
    });
    const created = await processRecurring(profileId);
    expect(created).toBe(1);
    expect(await balance(bank)).toBe(420_000);
    expect(await processRecurring(profileId)).toBe(0); // idempotent
    expect(await balance(bank)).toBe(420_000);
  });

  it('remind mode creates a notification, not a transaction', async () => {
    await createRecurring({
      profileId, name: 'Internet', kind: 'expense', amountMinor: 10_000, accountId: bank,
      frequency: 'monthly', startDate: todayISO(), mode: 'remind',
    });
    await processRecurring(profileId);
    expect(await balance(bank)).toBe(500_000);
    const notifs = await db.notifications.where('profileId').equals(profileId).toArray();
    expect(notifs.some((n) => n.titleKey === 'notifications.recurringDue')).toBe(true);
  });
});

describe('debt reminders', () => {
  it('notifies when a due date approaches and when overdue', async () => {
    const past = '2026-01-01';
    await createDebt({ profileId, person: 'Ali', direction: 'i_owe', principalMinor: 10_000, currency: 'YER', startDate: past, dueDate: '2026-02-01' });
    await checkDebts(profileId);
    const notifs = await db.notifications.where('profileId').equals(profileId).toArray();
    expect(notifs.some((n) => n.titleKey === 'notifications.debtOverdue')).toBe(true);
  });
});
