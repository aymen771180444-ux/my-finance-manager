/**
 * Posting engine — pure functions only (no React, no Dexie).
 *
 * Every transaction compiles to a set of postings: signed balance effects on
 * accounts. The repository layer applies these inside a DB transaction. This is
 * the ONLY path through which account balances may change, and it is where the
 * PRD's accounting rules are enforced:
 *   - transfers / deposits / withdrawals / cc payments are NEVER income or expense
 *   - credit-card purchases are expenses that increase card liability
 *   - credit-card payments settle liability, never a second expense
 *   - refunds reduce expense totals rather than counting as income
 *   - lending/borrowing/repayments move money but are neither income nor expense
 */

import type { Transaction, TxnType, Split } from '../db/types';

export interface Posting {
  accountId: string;
  /** Signed delta in minor units of the ACCOUNT's currency. */
  deltaMinor: number;
}

/** Transaction types that require a counter account (toAccountId). */
export const TWO_ACCOUNT_TYPES: TxnType[] = ['transfer', 'withdrawal', 'deposit', 'cc_payment'];

/** Classification used by every total/report in the app. */
export function countsAsIncome(t: Pick<Transaction, 'type'>): boolean {
  return t.type === 'income';
}

export function countsAsExpense(t: Pick<Transaction, 'type'>): boolean {
  return t.type === 'expense' || t.type === 'cc_purchase';
}

/** Refunds subtract from expense totals (never appear as income). */
export function isExpenseReduction(t: Pick<Transaction, 'type'>): boolean {
  return t.type === 'refund';
}

/** Is this an internal movement between the user's own accounts? */
export function isInternalTransfer(t: Pick<Transaction, 'type'>): boolean {
  return TWO_ACCOUNT_TYPES.includes(t.type);
}

export interface TxnLike {
  type: TxnType;
  amountMinor: number;
  accountId: string;
  toAccountId: string | null;
  debtId?: string | null;
  /** For debt_repayment: 'owed_to_me' => money comes IN, 'i_owe' => money goes OUT. */
  debtDirection?: 'owed_to_me' | 'i_owe' | null;
}

/**
 * Compile a transaction into postings. Throws on structurally invalid input.
 * Amounts are always positive; direction is derived from type.
 */
export function compilePostings(t: TxnLike): Posting[] {
  if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0) {
    throw new Error('Transaction amount must be a positive integer (minor units)');
  }
  const a = t.amountMinor;
  switch (t.type) {
    case 'income':
      return [{ accountId: t.accountId, deltaMinor: +a }];
    case 'expense':
      return [{ accountId: t.accountId, deltaMinor: -a }];
    case 'cc_purchase':
      // expense on the credit card account: balance goes further negative = liability grows
      return [{ accountId: t.accountId, deltaMinor: -a }];
    case 'transfer':
    case 'withdrawal':
    case 'deposit':
    case 'cc_payment': {
      if (!t.toAccountId) throw new Error(`${t.type} requires a destination account`);
      if (t.toAccountId === t.accountId) throw new Error('Source and destination must differ');
      return [
        { accountId: t.accountId, deltaMinor: -a },
        { accountId: t.toAccountId, deltaMinor: +a },
      ];
    }
    case 'lend':
      // money leaves my account; the receivable lives in the debt record
      return [{ accountId: t.accountId, deltaMinor: -a }];
    case 'borrow':
      return [{ accountId: t.accountId, deltaMinor: +a }];
    case 'debt_repayment': {
      if (!t.debtDirection) throw new Error('debt_repayment requires the debt direction');
      return t.debtDirection === 'owed_to_me'
        ? [{ accountId: t.accountId, deltaMinor: +a }] // they pay me back
        : [{ accountId: t.accountId, deltaMinor: -a }]; // I pay my debt
    }
    case 'refund':
      return [{ accountId: t.accountId, deltaMinor: +a }];
    case 'investment_buy':
      return [{ accountId: t.accountId, deltaMinor: -a }];
    case 'investment_sell':
      return [{ accountId: t.accountId, deltaMinor: +a }];
    default: {
      const never: never = t.type;
      throw new Error(`Unknown transaction type: ${never}`);
    }
  }
}

/** Postings that exactly reverse a transaction (used on edit/delete/restore). */
export function reversePostings(t: TxnLike): Posting[] {
  return compilePostings(t).map((p) => ({ ...p, deltaMinor: -p.deltaMinor }));
}

/**
 * Validate a split set against its parent: same-currency children must sum
 * EXACTLY to the parent amount (minor units — no rounding tolerance).
 */
export function validateSplits(parentAmountMinor: number, splits: Pick<Split, 'amountMinor'>[]): void {
  if (splits.length === 0) return;
  for (const s of splits) {
    if (!Number.isSafeInteger(s.amountMinor) || s.amountMinor <= 0) {
      throw new Error('Each split must have a positive amount');
    }
  }
  const sum = splits.reduce((acc, s) => acc + s.amountMinor, 0);
  if (sum !== parentAmountMinor) {
    throw new Error(`Splits (${sum}) must equal the transaction amount (${parentAmountMinor})`);
  }
}

/**
 * Totals helper used by dashboard and reports.
 * Returns the signed contribution of a txn to {income, expense} totals in BASE
 * minor units (null baseAmount => contributes nothing and is reported as unconvertible).
 */
export function totalsContribution(t: Pick<Transaction, 'type' | 'baseAmountMinor'>): {
  incomeMinor: number;
  expenseMinor: number;
  unconvertible: boolean;
} {
  if (t.baseAmountMinor === null) {
    const relevant = countsAsIncome(t) || countsAsExpense(t) || isExpenseReduction(t);
    return { incomeMinor: 0, expenseMinor: 0, unconvertible: relevant };
  }
  if (countsAsIncome(t)) return { incomeMinor: t.baseAmountMinor, expenseMinor: 0, unconvertible: false };
  if (countsAsExpense(t)) return { incomeMinor: 0, expenseMinor: t.baseAmountMinor, unconvertible: false };
  if (isExpenseReduction(t)) return { incomeMinor: 0, expenseMinor: -t.baseAmountMinor, unconvertible: false };
  return { incomeMinor: 0, expenseMinor: 0, unconvertible: false }; // transfers, debt ops, investments
}
