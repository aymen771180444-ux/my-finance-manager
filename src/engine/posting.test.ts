import { describe, it, expect } from 'vitest';
import {
  compilePostings,
  reversePostings,
  validateSplits,
  totalsContribution,
  countsAsExpense,
  countsAsIncome,
  isInternalTransfer,
} from './posting';

const base = { accountId: 'A', toAccountId: null, amountMinor: 1000 };

describe('compilePostings', () => {
  it('income increases the account', () => {
    expect(compilePostings({ ...base, type: 'income' })).toEqual([{ accountId: 'A', deltaMinor: 1000 }]);
  });
  it('expense decreases the account', () => {
    expect(compilePostings({ ...base, type: 'expense' })).toEqual([{ accountId: 'A', deltaMinor: -1000 }]);
  });
  it('transfer moves between two accounts, zero-sum', () => {
    const p = compilePostings({ ...base, type: 'transfer', toAccountId: 'B' });
    expect(p).toEqual([
      { accountId: 'A', deltaMinor: -1000 },
      { accountId: 'B', deltaMinor: 1000 },
    ]);
    expect(p.reduce((s, x) => s + x.deltaMinor, 0)).toBe(0);
  });
  it('rejects transfer to the same account or missing destination', () => {
    expect(() => compilePostings({ ...base, type: 'transfer', toAccountId: 'A' })).toThrow();
    expect(() => compilePostings({ ...base, type: 'transfer' })).toThrow();
  });
  it('credit-card purchase increases card liability (negative balance)', () => {
    expect(compilePostings({ ...base, type: 'cc_purchase' })).toEqual([{ accountId: 'A', deltaMinor: -1000 }]);
  });
  it('credit-card payment is a settlement transfer, not an expense', () => {
    const p = compilePostings({ ...base, type: 'cc_payment', toAccountId: 'CARD' });
    expect(p).toEqual([
      { accountId: 'A', deltaMinor: -1000 },
      { accountId: 'CARD', deltaMinor: 1000 },
    ]);
    expect(countsAsExpense({ type: 'cc_payment' })).toBe(false);
  });
  it('debt repayment direction follows the debt', () => {
    expect(compilePostings({ ...base, type: 'debt_repayment', debtDirection: 'owed_to_me' })).toEqual([
      { accountId: 'A', deltaMinor: 1000 },
    ]);
    expect(compilePostings({ ...base, type: 'debt_repayment', debtDirection: 'i_owe' })).toEqual([
      { accountId: 'A', deltaMinor: -1000 },
    ]);
    expect(() => compilePostings({ ...base, type: 'debt_repayment' })).toThrow();
  });
  it('rejects zero, negative, and non-integer amounts', () => {
    expect(() => compilePostings({ ...base, type: 'income', amountMinor: 0 })).toThrow();
    expect(() => compilePostings({ ...base, type: 'income', amountMinor: -5 })).toThrow();
    expect(() => compilePostings({ ...base, type: 'income', amountMinor: 10.5 })).toThrow();
  });
});

describe('reversePostings', () => {
  it('exactly negates every posting', () => {
    const t = { ...base, type: 'transfer' as const, toAccountId: 'B' };
    const fwd = compilePostings(t);
    const rev = reversePostings(t);
    for (let i = 0; i < fwd.length; i++) {
      expect(rev[i].deltaMinor).toBe(-fwd[i].deltaMinor);
    }
  });
});

describe('classification (PRD §8)', () => {
  it('transfers / deposits / withdrawals / cc payments are never income or expense', () => {
    for (const type of ['transfer', 'withdrawal', 'deposit', 'cc_payment'] as const) {
      expect(countsAsIncome({ type })).toBe(false);
      expect(countsAsExpense({ type })).toBe(false);
      expect(isInternalTransfer({ type })).toBe(true);
    }
  });
  it('lend/borrow/debt repayments are neither income nor expense', () => {
    for (const type of ['lend', 'borrow', 'debt_repayment'] as const) {
      expect(countsAsIncome({ type })).toBe(false);
      expect(countsAsExpense({ type })).toBe(false);
    }
  });
  it('refund reduces expenses instead of counting as income', () => {
    const c = totalsContribution({ type: 'refund', baseAmountMinor: 500 });
    expect(c.incomeMinor).toBe(0);
    expect(c.expenseMinor).toBe(-500);
  });
  it('unconvertible amounts contribute nothing and are flagged', () => {
    const c = totalsContribution({ type: 'expense', baseAmountMinor: null });
    expect(c.expenseMinor).toBe(0);
    expect(c.unconvertible).toBe(true);
  });
});

describe('validateSplits (PRD acceptance #6)', () => {
  it('accepts splits that sum exactly', () => {
    expect(() => validateSplits(1000, [{ amountMinor: 400 }, { amountMinor: 600 }])).not.toThrow();
  });
  it('rejects any mismatch — no rounding tolerance', () => {
    expect(() => validateSplits(1000, [{ amountMinor: 400 }, { amountMinor: 599 }])).toThrow();
    expect(() => validateSplits(1000, [{ amountMinor: 400 }, { amountMinor: 601 }])).toThrow();
  });
  it('rejects non-positive split parts', () => {
    expect(() => validateSplits(1000, [{ amountMinor: 1000 }, { amountMinor: 0 }])).toThrow();
    expect(() => validateSplits(0, [{ amountMinor: -500 }, { amountMinor: 500 }])).toThrow();
  });
});
