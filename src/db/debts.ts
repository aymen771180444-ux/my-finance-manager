import { db, newId, nowISO } from './schema';
import type { Debt, DebtDirection, DebtRepayment, Transaction } from './types';
import type { CurrencyCode } from '../engine/money';
import { recordMutation } from './audit';
import { createTransaction, deleteTransaction, TXN_TABLES } from './transactions';

export interface DebtInput {
  profileId: string;
  person: string;
  direction: DebtDirection;
  principalMinor: number;
  currency: CurrencyCode;
  startDate: string;
  dueDate?: string | null;
  installmentMinor?: number | null;
  installmentPeriod?: 'weekly' | 'monthly' | null;
  notes?: string;
  /** When set, the money actually moved now: record a lend/borrow transaction on this account. */
  moveAccountId?: string | null;
}

/**
 * Create a debt record. If `moveAccountId` is given, a lend/borrow transaction
 * is recorded against that account (it must match the debt currency).
 */
export async function createDebt(input: DebtInput): Promise<Debt> {
  if (!input.person.trim()) throw new Error('Person is required');
  if (!Number.isSafeInteger(input.principalMinor) || input.principalMinor <= 0) {
    throw new Error('Principal must be positive');
  }
  return db.transaction(
    'rw',
    TXN_TABLES,
    async () => {
      const ts = nowISO();
      const debt: Debt = {
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: input.profileId,
        person: input.person.trim(),
        direction: input.direction,
        principalMinor: input.principalMinor,
        currency: input.currency,
        startDate: input.startDate,
        dueDate: input.dueDate ?? null,
        installmentMinor: input.installmentMinor ?? null,
        installmentPeriod: input.installmentPeriod ?? null,
        remainingMinor: input.principalMinor,
        notes: input.notes ?? '',
        status: 'open',
      };
      await db.debts.add(debt);
      if (input.moveAccountId) {
        const account = await db.accounts.get(input.moveAccountId);
        if (!account) throw new Error('Account not found');
        if (account.currency !== input.currency) {
          throw new Error('DEBT_ACCOUNT_CURRENCY_MISMATCH');
        }
        await createTransaction({
          profileId: input.profileId,
          type: input.direction === 'owed_to_me' ? 'lend' : 'borrow',
          amountMinor: input.principalMinor,
          accountId: input.moveAccountId,
          date: input.startDate,
          person: debt.person,
          debtId: debt.id,
        });
      }
      await recordMutation({
        profileId: input.profileId,
        table: 'debts',
        rowId: debt.id,
        action: 'create',
        before: null,
        after: debt,
      });
      return debt;
    },
  );
}

/**
 * Record a repayment (partial or full). If `accountId` is given the money
 * moves through that account; otherwise only the debt balance changes
 * (e.g. settled in goods or recorded after the fact).
 */
export async function repayDebt(opts: {
  debtId: string;
  amountMinor: number;
  date: string;
  accountId?: string | null;
  notes?: string;
}): Promise<Debt> {
  if (!Number.isSafeInteger(opts.amountMinor) || opts.amountMinor <= 0) {
    throw new Error('Repayment must be positive');
  }
  return db.transaction(
    'rw',
    TXN_TABLES,
    async () => {
      const before = await db.debts.get(opts.debtId);
      if (!before) throw new Error('Debt not found');
      if (before.status === 'settled') throw new Error('Debt already settled');
      if (opts.amountMinor > before.remainingMinor) throw new Error('REPAYMENT_EXCEEDS_REMAINING');
      let txnId: string | null = null;
      if (opts.accountId) {
        const account = await db.accounts.get(opts.accountId);
        if (!account) throw new Error('Account not found');
        if (account.currency !== before.currency) throw new Error('DEBT_ACCOUNT_CURRENCY_MISMATCH');
        const txn = await createTransaction({
          profileId: before.profileId,
          type: 'debt_repayment',
          amountMinor: opts.amountMinor,
          accountId: opts.accountId,
          date: opts.date,
          person: before.person,
          notes: opts.notes ?? '',
          debtId: before.id,
          debtDirection: before.direction,
        });
        txnId = txn.id;
      }
      const ts = nowISO();
      await db.debtRepayments.add({
        id: newId(), createdAt: ts, updatedAt: ts, profileId: before.profileId,
        debtId: before.id, amountMinor: opts.amountMinor, date: opts.date, txnId, notes: opts.notes ?? '',
      });
      const remaining = before.remainingMinor - opts.amountMinor;
      const after: Debt = {
        ...before,
        remainingMinor: remaining,
        status: remaining === 0 ? 'settled' : 'open',
        updatedAt: nowISO(),
      };
      await db.debts.put(after);
      await recordMutation({
        profileId: before.profileId,
        table: 'debts',
        rowId: before.id,
        action: 'update',
        before,
        after,
      });
      return after;
    },
  );
}

export async function updateDebt(
  id: string,
  changes: Partial<Pick<Debt, 'person' | 'dueDate' | 'installmentMinor' | 'installmentPeriod' | 'notes'>>,
): Promise<void> {
  return db.transaction('rw', [db.debts, db.auditLog, db.syncQueue], async () => {
    const before = await db.debts.get(id);
    if (!before) throw new Error('Debt not found');
    const after = { ...before, ...changes, updatedAt: nowISO() };
    await db.debts.put(after);
    await recordMutation({ profileId: before.profileId, table: 'debts', rowId: id, action: 'update', before, after });
  });
}

/**
 * Delete a debt. Its linked transactions are deleted too (balances reversed,
 * everything lands in Trash individually).
 */
export async function deleteDebt(id: string): Promise<void> {
  const original = await db.debts.get(id);
  if (!original) throw new Error('Debt not found');
  const linked: Transaction[] = await db.transactions.where('debtId').equals(id).toArray();
  for (const t of linked) await deleteTransaction(t.id, original.person);
  await db.transaction('rw', [db.debts, db.debtRepayments, db.trash, db.auditLog, db.syncQueue], async () => {
    // snapshot AFTER the linked repayments were rolled back, so restoring the
    // debt and then those transactions from Trash never double-applies them
    const debt = (await db.debts.get(id))!;
    const repayments = await db.debtRepayments.where('debtId').equals(id).toArray(); // account-less ones remain
    await db.debtRepayments.where('debtId').equals(id).delete();
    await db.debts.delete(id);
    const ts = nowISO();
    await db.trash.add({
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: debt.profileId,
      table: 'debts',
      rowId: id,
      payload: JSON.stringify({ debt, repayments }),
      label: debt.person,
      deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: debt.profileId, table: 'debts', rowId: id, action: 'delete', before: debt, after: null });
  });
}

export async function restoreDebt(trashId: string): Promise<void> {
  return db.transaction('rw', [db.debts, db.debtRepayments, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'debts') throw new Error('Trash entry not found');
    const { debt, repayments = [] } = JSON.parse(entry.payload) as { debt: Debt; repayments?: DebtRepayment[] };
    await db.debts.add(debt);
    for (const r of repayments) await db.debtRepayments.add(r);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: debt.profileId, table: 'debts', rowId: debt.id, action: 'restore', before: null, after: debt });
  });
}
