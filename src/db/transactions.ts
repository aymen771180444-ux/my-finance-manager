import { db, newId, nowISO } from './schema';
import type { Transaction, Split, TxnType, PaymentMethod, Account, SavingsContribution, InvestmentTxn } from './types';
import { recomputeInvestment } from './investmentCache';
import { purgeAttachments } from './attachments';
import {
  compilePostings,
  reversePostings,
  validateSplits,
  TWO_ACCOUNT_TYPES,
  type Posting,
} from '../engine/posting';
import { convertToBase, BASE_CURRENCY, type CurrencyCode } from '../engine/money';
import { getRateForDate } from './rates';
import { recordMutation } from './audit';

export interface TxnInput {
  /** Fixed id for automatically generated entries, so two synced devices produce the same record. */
  id?: string;
  profileId: string;
  type: TxnType;
  amountMinor: number;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  date: string;
  paymentMethod?: PaymentMethod | null;
  person?: string;
  notes?: string;
  linkedTxnId?: string | null;
  debtId?: string | null;
  debtDirection?: 'owed_to_me' | 'i_owe' | null;
  goalId?: string | null;
  investmentId?: string | null;
  location?: string;
  /** Override the auto-looked-up rate (rarely needed; e.g. importing history). */
  fxRateToBase?: number | null;
  splits?: Array<Pick<Split, 'categoryId' | 'subcategoryId' | 'amountMinor' | 'notes'>>;
  tagIds?: string[];
}

/**
 * Every table a transaction mutation may touch. Repositories that call
 * createTransaction/deleteTransaction inside their OWN Dexie transaction must
 * include all of these (Dexie requires nested scopes to be a subset), so they
 * build their scope from this list instead of hand-copying it.
 */
export const TXN_TABLES = [
  db.transactions,
  db.splits,
  db.transactionTags,
  db.accounts,
  db.auditLog,
  db.syncQueue,
  db.trash,
  db.exchangeRates,
  db.debts,
  db.debtRepayments,
  db.savingsGoals,
  db.savingsContributions,
  db.investments,
  db.investmentTxns,
];

/**
 * Deleting an investment buy/sell transaction removes its investment record
 * and re-derives the holding. Refused (INVESTMENT_HISTORY_CONFLICT) when a
 * later sale depends on it.
 */
async function detachInvestmentTxn(t: Transaction): Promise<InvestmentTxn | null> {
  if (!t.investmentId) return null;
  const row = (await db.investmentTxns.where('txnId').equals(t.id).toArray())[0];
  if (!row) return null;
  await db.investmentTxns.delete(row.id);
  try {
    await recomputeInvestment(row.investmentId);
  } catch {
    throw new Error('INVESTMENT_HISTORY_CONFLICT');
  }
  return row;
}

async function reattachInvestmentTxn(row: InvestmentTxn | null | undefined): Promise<void> {
  if (!row || !(await db.investments.get(row.investmentId))) return;
  await db.investmentTxns.add(row);
  await recomputeInvestment(row.investmentId);
}

/**
 * Deleting a goal deposit/withdrawal transfer must also remove its
 * contribution and correct the goal's saved amount (and the reverse on restore).
 */
async function detachGoalContribution(t: Transaction): Promise<SavingsContribution | null> {
  if (!t.goalId) return null;
  const contribution = (await db.savingsContributions.where('goalId').equals(t.goalId).toArray()).find((c) => c.txnId === t.id);
  if (!contribution) return null;
  await db.savingsContributions.delete(contribution.id);
  const goal = await db.savingsGoals.get(t.goalId);
  if (goal) {
    const saved = goal.savedMinor - contribution.amountMinor;
    await db.savingsGoals.update(goal.id, {
      savedMinor: saved,
      status: goal.status === 'archived' ? 'archived' : saved >= goal.targetMinor ? 'completed' : 'active',
      updatedAt: nowISO(),
    });
  }
  return contribution;
}

async function reattachGoalContribution(c: SavingsContribution | null | undefined): Promise<void> {
  if (!c) return;
  const goal = await db.savingsGoals.get(c.goalId);
  if (!goal) return; // goal itself was deleted; nothing to reattach to
  await db.savingsContributions.add(c);
  const saved = goal.savedMinor + c.amountMinor;
  await db.savingsGoals.update(goal.id, {
    savedMinor: saved,
    status: goal.status === 'archived' ? 'archived' : saved >= goal.targetMinor ? 'completed' : 'active',
    updatedAt: nowISO(),
  });
}

/**
 * Deleting (sign +1) / restoring (sign −1) a repayment rolls the debt balance
 * back/forward and keeps the dated repayment history in step.
 */
async function adjustDebtForRepayment(t: Transaction, sign: 1 | -1): Promise<void> {
  if (t.type !== 'debt_repayment' || !t.debtId) return;
  const debt = await db.debts.get(t.debtId);
  if (!debt) return;
  const remaining = Math.min(debt.principalMinor, Math.max(0, debt.remainingMinor + sign * t.amountMinor));
  await db.debts.update(debt.id, {
    remainingMinor: remaining,
    status: remaining === 0 ? 'settled' : 'open',
    updatedAt: nowISO(),
  });
  if (sign === 1) {
    await db.debtRepayments.where('txnId').equals(t.id).delete();
  } else {
    const ts = nowISO();
    await db.debtRepayments.add({
      id: newId(), createdAt: ts, updatedAt: ts, profileId: t.profileId,
      debtId: t.debtId, amountMinor: t.amountMinor, date: t.date, txnId: t.id, notes: t.notes,
    });
  }
}

async function loadAccountChecked(id: string, profileId: string): Promise<Account> {
  const acc = await db.accounts.get(id);
  if (!acc) throw new Error('Account not found');
  if (acc.profileId !== profileId && !acc.sharedWithProfileIds.includes(profileId)) {
    throw new Error('Account does not belong to this profile');
  }
  return acc;
}

/** Validate account/currency rules and return the primary account. */
async function validateAccounts(input: {
  profileId: string;
  type: TxnType;
  accountId: string;
  toAccountId?: string | null;
}): Promise<{ account: Account; toAccount: Account | null }> {
  const account = await loadAccountChecked(input.accountId, input.profileId);
  let toAccount: Account | null = null;
  if (TWO_ACCOUNT_TYPES.includes(input.type)) {
    if (!input.toAccountId) throw new Error('Destination account is required');
    toAccount = await loadAccountChecked(input.toAccountId, input.profileId);
    // PRD rule: internal transfers only between same-currency accounts
    if (toAccount.currency !== account.currency) {
      throw new Error('Transfers are only supported between accounts with the same currency');
    }
    if (input.type === 'cc_payment' && toAccount.type !== 'credit_card') {
      throw new Error('Credit-card payments must go to a credit-card account');
    }
  }
  if (input.type === 'cc_purchase' && account.type !== 'credit_card') {
    throw new Error('Credit-card purchases must use a credit-card account');
  }
  return { account, toAccount };
}

async function applyPostings(postings: Posting[]): Promise<void> {
  for (const p of postings) {
    const acc = await db.accounts.get(p.accountId);
    if (!acc) throw new Error('Account not found while applying postings');
    await db.accounts.update(p.accountId, {
      currentBalanceMinor: acc.currentBalanceMinor + p.deltaMinor,
      updatedAt: nowISO(),
    });
  }
}

/** Resolve the frozen fx values for a transaction (never invents a rate). */
async function resolveFx(
  currency: CurrencyCode,
  amountMinor: number,
  date: string,
  override?: number | null,
): Promise<{ fxRateToBase: number | null; baseAmountMinor: number | null }> {
  const rate = override ?? (await getRateForDate(currency, date));
  if (currency === BASE_CURRENCY) return { fxRateToBase: 1, baseAmountMinor: amountMinor };
  if (rate === null) return { fxRateToBase: null, baseAmountMinor: null };
  return { fxRateToBase: rate, baseAmountMinor: convertToBase(amountMinor, currency, rate) };
}

export async function createTransaction(input: TxnInput): Promise<Transaction> {
  return db.transaction('rw', TXN_TABLES, async () => {
    const { account } = await validateAccounts(input);
    const splits = input.splits ?? [];
    validateSplits(input.amountMinor, splits);
    const { fxRateToBase, baseAmountMinor } = await resolveFx(
      account.currency,
      input.amountMinor,
      input.date,
      input.fxRateToBase,
    );
    const ts = nowISO();
    const txn: Transaction = {
      id: input.id ?? newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: input.profileId,
      type: input.type,
      amountMinor: input.amountMinor,
      currency: account.currency,
      fxRateToBase,
      baseAmountMinor,
      accountId: input.accountId,
      toAccountId: input.toAccountId ?? null,
      categoryId: input.categoryId ?? null,
      subcategoryId: input.subcategoryId ?? null,
      date: input.date,
      paymentMethod: input.paymentMethod ?? null,
      person: input.person ?? '',
      notes: input.notes ?? '',
      linkedTxnId: input.linkedTxnId ?? null,
      debtId: input.debtId ?? null,
      goalId: input.goalId ?? null,
      investmentId: input.investmentId ?? null,
      attachmentIds: [],
      location: input.location ?? '',
      hasSplits: splits.length > 0,
    };
    await db.transactions.add(txn);
    for (const s of splits) {
      await db.splits.add({
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: input.profileId,
        transactionId: txn.id,
        categoryId: s.categoryId,
        subcategoryId: s.subcategoryId ?? null,
        amountMinor: s.amountMinor,
        notes: s.notes ?? '',
      });
    }
    for (const tagId of input.tagIds ?? []) {
      await db.transactionTags.add({
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: input.profileId,
        transactionId: txn.id,
        tagId,
      });
    }
    await applyPostings(
      compilePostings({ ...txn, debtDirection: input.debtDirection ?? null }),
    );
    await recordMutation({
      profileId: input.profileId,
      table: 'transactions',
      rowId: txn.id,
      action: 'create',
      before: null,
      after: txn,
    });
    return txn;
  });
}

export async function updateTransaction(id: string, input: TxnInput): Promise<Transaction> {
  return db.transaction('rw', TXN_TABLES, async () => {
    const old = await db.transactions.get(id);
    if (!old) throw new Error('Transaction not found');
    const oldDirection = await debtDirectionOf(old);
    // 1. reverse the old balance effects
    await applyPostings(reversePostings({ ...old, debtDirection: oldDirection }));
    // 2. validate and build the new version
    const { account } = await validateAccounts(input);
    const splits = input.splits ?? [];
    validateSplits(input.amountMinor, splits);
    const { fxRateToBase, baseAmountMinor } = await resolveFx(
      account.currency,
      input.amountMinor,
      input.date,
      input.fxRateToBase,
    );
    const updated: Transaction = {
      ...old,
      updatedAt: nowISO(),
      type: input.type,
      amountMinor: input.amountMinor,
      currency: account.currency,
      fxRateToBase,
      baseAmountMinor,
      accountId: input.accountId,
      toAccountId: input.toAccountId ?? null,
      categoryId: input.categoryId ?? null,
      subcategoryId: input.subcategoryId ?? null,
      date: input.date,
      paymentMethod: input.paymentMethod ?? null,
      person: input.person ?? '',
      notes: input.notes ?? '',
      linkedTxnId: input.linkedTxnId ?? null,
      debtId: input.debtId ?? null,
      goalId: input.goalId ?? null,
      investmentId: input.investmentId ?? null,
      location: input.location ?? '',
      hasSplits: splits.length > 0,
    };
    await db.transactions.put(updated);
    // 3. replace splits and tags
    await db.splits.where('transactionId').equals(id).delete();
    const ts = updated.updatedAt;
    for (const s of splits) {
      await db.splits.add({
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: updated.profileId,
        transactionId: id,
        categoryId: s.categoryId,
        subcategoryId: s.subcategoryId ?? null,
        amountMinor: s.amountMinor,
        notes: s.notes ?? '',
      });
    }
    if (input.tagIds) {
      await db.transactionTags.where('transactionId').equals(id).delete();
      for (const tagId of input.tagIds) {
        await db.transactionTags.add({
          id: newId(),
          createdAt: ts,
          updatedAt: ts,
          profileId: updated.profileId,
          transactionId: id,
          tagId,
        });
      }
    }
    // 4. apply the new balance effects
    await applyPostings(
      compilePostings({ ...updated, debtDirection: input.debtDirection ?? null }),
    );
    await recordMutation({
      profileId: updated.profileId,
      table: 'transactions',
      rowId: id,
      action: 'update',
      before: old,
      after: updated,
    });
    return updated;
  });
}

/** Debt direction lives on the debt record. */
async function debtDirectionOf(t: Transaction): Promise<'owed_to_me' | 'i_owe' | null> {
  if (t.type !== 'debt_repayment') return null;
  if (!t.debtId) throw new Error('debt_repayment has no linked debt');
  const debt = await db.debts.get(t.debtId);
  if (!debt) throw new Error('Linked debt not found');
  return debt.direction;
}

/** Soft delete: reverse balances, snapshot everything into Trash (90 days). */
export async function deleteTransaction(
  id: string,
  label = '',
  opts: { keepInvestmentRow?: boolean } = {},
): Promise<void> {
  return db.transaction('rw', TXN_TABLES, async () => {
    const txn = await db.transactions.get(id);
    if (!txn) throw new Error('Transaction not found');
    const direction = await debtDirectionOf(txn);
    const splits = await db.splits.where('transactionId').equals(id).toArray();
    const tagLinks = await db.transactionTags.where('transactionId').equals(id).toArray();
    await applyPostings(reversePostings({ ...txn, debtDirection: direction }));
    await adjustDebtForRepayment(txn, 1);
    const goalContribution = await detachGoalContribution(txn);
    const investmentTxn = opts.keepInvestmentRow ? null : await detachInvestmentTxn(txn);
    await db.splits.where('transactionId').equals(id).delete();
    await db.transactionTags.where('transactionId').equals(id).delete();
    await db.transactions.delete(id);
    const ts = nowISO();
    const purge = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    await db.trash.add({
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: txn.profileId,
      table: 'transactions',
      rowId: id,
      payload: JSON.stringify({ txn, splits, tagLinks, goalContribution, investmentTxn }),
      label,
      deletedAt: ts,
      purgeAt: purge,
    });
    await recordMutation({
      profileId: txn.profileId,
      table: 'transactions',
      rowId: id,
      action: 'delete',
      before: txn,
      after: null,
    });
  });
}

/** Restore a transaction from Trash: re-insert rows and re-apply balances. */
export async function restoreTransaction(trashId: string): Promise<void> {
  return db.transaction('rw', TXN_TABLES, async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'transactions') throw new Error('Trash entry not found');
    const { txn, splits, tagLinks, goalContribution, investmentTxn } = JSON.parse(entry.payload) as {
      goalContribution?: SavingsContribution | null;
      investmentTxn?: InvestmentTxn | null;
      txn: Transaction;
      splits: Split[];
      tagLinks: { id: string; transactionId: string; tagId: string; profileId: string; createdAt: string; updatedAt: string }[];
    };
    const account = await db.accounts.get(txn.accountId);
    if (!account) throw new Error('Original account no longer exists');
    await db.transactions.add(txn);
    for (const s of splits) await db.splits.add(s);
    for (const t of tagLinks) await db.transactionTags.add(t);
    const direction = await debtDirectionOf(txn).catch(() => null);
    await applyPostings(compilePostings({ ...txn, debtDirection: direction }));
    await adjustDebtForRepayment(txn, -1);
    await reattachGoalContribution(goalContribution);
    await reattachInvestmentTxn(investmentTxn);
    await db.trash.delete(trashId);
    await recordMutation({
      profileId: txn.profileId,
      table: 'transactions',
      rowId: txn.id,
      action: 'restore',
      before: null,
      after: txn,
    });
  });
}

/** Permanently purge expired trash entries (called on app start). */
export async function purgeExpiredTrash(): Promise<number> {
  const now = nowISO();
  const expired = await db.trash.where('purgeAt').below(now).toArray();
  for (const e of expired) await db.trash.delete(e.id);
  await purgeAttachments(); // files whose Trash entry or owner is now gone for good
  return expired.length;
}
