import { db, newId, nowISO } from './schema';
import type { Account, AccountType } from './types';
import type { CurrencyCode } from '../engine/money';
import { recordMutation } from './audit';

export interface AccountInput {
  profileId: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  openingBalanceMinor: number;
  openedAt: string;
  notes?: string;
}

export async function createAccount(input: AccountInput): Promise<Account> {
  return db.transaction('rw', [db.accounts, db.auditLog, db.syncQueue], async () => {
    const ts = nowISO();
    const account: Account = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: input.profileId,
      name: input.name.trim(),
      type: input.type,
      currency: input.currency,
      openingBalanceMinor: input.openingBalanceMinor,
      currentBalanceMinor: input.openingBalanceMinor,
      openedAt: input.openedAt,
      notes: input.notes ?? '',
      status: 'active',
      sharedWithProfileIds: [],
    };
    if (!account.name) throw new Error('Account name is required');
    await db.accounts.add(account);
    await recordMutation({
      profileId: input.profileId,
      table: 'accounts',
      rowId: account.id,
      action: 'create',
      before: null,
      after: account,
    });
    return account;
  });
}

export async function updateAccount(
  id: string,
  changes: Partial<Pick<Account, 'name' | 'notes' | 'status' | 'openingBalanceMinor' | 'sharedWithProfileIds'>>,
): Promise<Account> {
  return db.transaction('rw', [db.accounts, db.auditLog, db.syncQueue], async () => {
    const before = await db.accounts.get(id);
    if (!before) throw new Error('Account not found');
    const after: Account = { ...before, ...changes, updatedAt: nowISO() };
    // changing the opening balance shifts the current balance by the same delta
    if (
      changes.openingBalanceMinor !== undefined &&
      changes.openingBalanceMinor !== before.openingBalanceMinor
    ) {
      const delta = changes.openingBalanceMinor - before.openingBalanceMinor;
      after.currentBalanceMinor = before.currentBalanceMinor + delta;
    }
    await db.accounts.put(after);
    await recordMutation({
      profileId: before.profileId,
      table: 'accounts',
      rowId: id,
      action: 'update',
      before,
      after,
    });
    return after;
  });
}

/**
 * Manual reconciliation: the user states the REAL balance; the difference is
 * absorbed into the opening balance (keeping every transaction intact) and the
 * adjustment is recorded in the audit log.
 */
export async function reconcileAccount(id: string, actualBalanceMinor: number): Promise<Account> {
  return db.transaction('rw', [db.accounts, db.auditLog, db.syncQueue], async () => {
    const before = await db.accounts.get(id);
    if (!before) throw new Error('Account not found');
    const delta = actualBalanceMinor - before.currentBalanceMinor;
    if (delta === 0) return before;
    const after: Account = {
      ...before,
      openingBalanceMinor: before.openingBalanceMinor + delta,
      currentBalanceMinor: actualBalanceMinor,
      updatedAt: nowISO(),
    };
    await db.accounts.put(after);
    await recordMutation({
      profileId: before.profileId,
      table: 'accounts',
      rowId: id,
      action: 'reconcile',
      before,
      after,
    });
    return after;
  });
}

/**
 * Delete an account. Only allowed when it has no transactions — otherwise the
 * caller should close it (status = 'closed') to preserve financial history.
 */
export async function deleteAccount(id: string): Promise<void> {
  return db.transaction(
    'rw',
    [db.accounts, db.transactions, db.trash, db.auditLog, db.syncQueue],
    async () => {
      const account = await db.accounts.get(id);
      if (!account) throw new Error('Account not found');
      const txnCount = await db.transactions.where('[profileId+accountId]').equals([account.profileId, id]).count();
      const asDestination = await db.transactions.where('toAccountId').equals(id).count();
      if (txnCount > 0 || asDestination > 0) {
        throw new Error('ACCOUNT_HAS_TRANSACTIONS');
      }
      await db.accounts.delete(id);
      const ts = nowISO();
      await db.trash.add({
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: account.profileId,
        table: 'accounts',
        rowId: id,
        payload: JSON.stringify({ account }),
        label: account.name,
        deletedAt: ts,
        purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      });
      await recordMutation({
        profileId: account.profileId,
        table: 'accounts',
        rowId: id,
        action: 'delete',
        before: account,
        after: null,
      });
    },
  );
}

export async function restoreAccount(trashId: string): Promise<void> {
  return db.transaction('rw', [db.accounts, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'accounts') throw new Error('Trash entry not found');
    const { account } = JSON.parse(entry.payload) as { account: Account };
    await db.accounts.add(account);
    await db.trash.delete(trashId);
    await recordMutation({
      profileId: account.profileId,
      table: 'accounts',
      rowId: account.id,
      action: 'restore',
      before: null,
      after: account,
    });
  });
}
