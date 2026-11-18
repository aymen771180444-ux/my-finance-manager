import { describe, it, expect } from 'vitest';
import { forecastMonth, plannedExpenses, type BudgetLine, type UpcomingItem } from './forecast';
import { netWorthAt, computeNetWorth, monthEnds, yearEnds, rateAt, type HistoryInputs } from './networth';
import type { Account, Transaction, Debt, ExchangeRate, Investment, InvestmentTxn, Asset, AssetValuation } from '../db/types';

const ts = '2026-01-01T00:00:00.000Z';
const base = { createdAt: ts, updatedAt: ts, profileId: 'p' };

describe('plannedExpenses — no double counting', () => {
  const rent: UpcomingItem = { kind: 'recurring_expense', label: 'Rent', date: '2026-11-25', baseMinor: 80_000, categoryId: 'rent' };
  const gym: UpcomingItem = { kind: 'recurring_expense', label: 'Gym', date: '2026-11-26', baseMinor: 5_000, categoryId: 'fun' };
  it('a bill inside a category budget is not added twice', () => {
    const budgets: BudgetLine[] = [{ id: 'b', name: 'Housing', categoryIds: new Set(['rent']), limitMinor: 100_000, spentMinor: 0 }];
    // remaining 100k already includes rent → 100k, plus the uncovered gym 5k
    expect(plannedExpenses(budgets, [rent, gym])).toBe(105_000);
  });
  it('a bill larger than what is left in its budget still counts in full', () => {
    const budgets: BudgetLine[] = [{ id: 'b', name: 'Housing', categoryIds: new Set(['rent']), limitMinor: 100_000, spentMinor: 90_000 }];
    expect(plannedExpenses(budgets, [rent])).toBe(80_000);
  });
  it('an overall budget covers every bill', () => {
    const budgets: BudgetLine[] = [{ id: 'o', name: 'All', categoryIds: null, limitMinor: 200_000, spentMinor: 50_000 }];
    expect(plannedExpenses(budgets, [rent, gym])).toBe(150_000);
  });
  it('without budgets, bills alone', () => {
    expect(plannedExpenses([], [rent, gym])).toBe(85_000);
  });
});

describe('forecastMonth', () => {
  const upcoming: UpcomingItem[] = [
    { kind: 'recurring_income', label: 'Salary', date: '2026-11-28', baseMinor: 300_000 },
    { kind: 'recurring_expense', label: 'Rent', date: '2026-11-25', baseMinor: 80_000, categoryId: 'rent' },
    { kind: 'debt_payable', label: 'Bank', date: '2026-11-29', baseMinor: 20_000 },
    { kind: 'debt_receivable', label: 'Ali', date: '2026-11-27', baseMinor: 50_000 },
  ];
  const f = forecastMonth({
    daysLeft: 10, daysElapsed: 20, daysTotal: 30, liquidBalanceMinor: 100_000,
    history: { incomeMinor: 900_000, expenseMinor: 450_000, days: 90 },
    upcoming,
    budgets: [{ id: 'f', name: 'Food', categoryIds: new Set(['food']), limitMinor: 60_000, spentMinor: 50_000 }],
  });
  it('method 1 projects from historical daily averages', () => {
    expect(f.historical!.expectedIncomeMinor).toBe(100_000);
    expect(f.historical!.expectedExpenseMinor).toBe(50_000);
    expect(f.historical!.endBalanceMinor).toBe(100_000 + 100_000 - 50_000 - 20_000);
  });
  it('method 2 uses budgets + recurring; receivables are never counted as income', () => {
    expect(f.planned.expectedIncomeMinor).toBe(300_000);
    expect(f.planned.expectedExpenseMinor).toBe(10_000 + 80_000);
    expect(f.planned.endBalanceMinor).toBe(100_000 + 300_000 - 90_000 - 20_000);
  });
  it('flags budgets whose pace overshoots', () => {
    expect(f.overspendRisks).toEqual([{ id: 'f', name: 'Food', projectedMinor: 75_000, limitMinor: 60_000 }]);
  });
  it('no history → method 1 is unavailable (not guessed)', () => {
    const g = forecastMonth({ daysLeft: 10, daysElapsed: 20, daysTotal: 30, liquidBalanceMinor: 0, history: null, upcoming: [], budgets: [] });
    expect(g.historical).toBeNull();
  });
});

// ——— net worth history ———
const acc = (id: string, bal: number, openedAt = '2025-01-01', currency: Account['currency'] = 'YER'): Account =>
  ({ ...base, id, name: id, type: 'bank', currency, openingBalanceMinor: 0, currentBalanceMinor: bal, openedAt, notes: '', status: 'active', sharedWithProfileIds: [] });
const txn = (p: Partial<Transaction>): Transaction =>
  ({ ...base, id: Math.random().toString(36), type: 'expense', amountMinor: 0, currency: 'YER', fxRateToBase: 1, baseAmountMinor: 0, accountId: 'bank',
     toAccountId: null, categoryId: null, subcategoryId: null, date: '2026-01-01', paymentMethod: null, person: '', notes: '', linkedTxnId: null,
     debtId: null, goalId: null, investmentId: null, attachmentIds: [], location: '', hasSplits: false, ...p }) as Transaction;
const empty: HistoryInputs = { accounts: [], txns: [], debts: [], repayments: [], investments: [], investmentTxns: [], assets: [], valuations: [], rates: [] };

describe('netWorthAt — historical reconstruction', () => {
  it('rolls account balances back by reversing later postings', () => {
    const h: HistoryInputs = {
      ...empty,
      accounts: [acc('bank', 500_000), acc('cash', 50_000)],
      txns: [
        txn({ type: 'income', amountMinor: 300_000, date: '2026-11-01' }),
        txn({ type: 'expense', amountMinor: 100_000, date: '2026-10-15' }),
        txn({ type: 'transfer', amountMinor: 20_000, accountId: 'bank', toAccountId: 'cash', date: '2026-11-05' }),
      ],
    };
    expect(netWorthAt(h, '2026-11-30').netMinor).toBe(550_000); // today = current
    expect(netWorthAt(h, '2026-10-31').netMinor).toBe(250_000); // before the 300k salary; transfer irrelevant
    expect(netWorthAt(h, '2026-09-30').netMinor).toBe(350_000); // before the 100k expense too
  });
  it('excludes accounts not yet opened', () => {
    const h = { ...empty, accounts: [acc('new', 10_000, '2026-06-01')] };
    expect(netWorthAt(h, '2026-05-31').netMinor).toBe(0);
  });
  it('debts use the repayment history up to the date', () => {
    const debt = { ...base, id: 'd', person: 'Ali', direction: 'i_owe', principalMinor: 100_000, currency: 'YER', startDate: '2026-01-01', dueDate: null,
      installmentMinor: null, installmentPeriod: null, remainingMinor: 40_000, notes: '', status: 'open' } as Debt;
    const h: HistoryInputs = { ...empty, debts: [debt], repayments: [{ ...base, id: 'r', debtId: 'd', amountMinor: 60_000, date: '2026-06-01', txnId: null, notes: '' }] };
    expect(netWorthAt(h, '2026-05-31').netMinor).toBe(-100_000);
    expect(netWorthAt(h, '2026-06-30').netMinor).toBe(-40_000);
    expect(netWorthAt(h, '2025-12-31').netMinor).toBe(0);
  });
  it('investments and assets use the value recorded as of the date', () => {
    const inv = { ...base, id: 'i', name: 'Gold fund', type: 'fund', currency: 'YER', unit: '', quantityMicro: 0, costBasisMinor: 0, realizedMinor: 0,
      lastPriceMinor: null, lastPriceDate: null, notes: '', status: 'active' } as Investment;
    const itx = (kind: 'buy' | 'valuation', q: number, price: number, date: string): InvestmentTxn =>
      ({ ...base, id: `${kind}${date}`, investmentId: 'i', kind, quantityMicro: q, priceMinor: price, totalMinor: kind === 'buy' ? (q / 1e6) * price : 0,
         feesMinor: 0, realizedMinor: 0, costRemovedMinor: 0, date, txnId: null, notes: '' });
    const asset = { ...base, id: 'a', name: 'Gold', kind: 'gold', currency: 'YER', valueMinor: 0, valuationDate: '', quantityNote: '', notes: '', status: 'active' } as Asset;
    const val = (v: number, date: string): AssetValuation => ({ ...base, id: `v${date}`, assetId: 'a', valueMinor: v, date });
    const h: HistoryInputs = {
      ...empty,
      investments: [inv],
      investmentTxns: [itx('buy', 10_000_000, 1_000, '2026-02-01'), itx('valuation', 0, 1_500, '2026-08-01')],
      assets: [asset],
      valuations: [val(200_000, '2026-01-15'), val(260_000, '2026-07-01')],
    };
    expect(netWorthAt(h, '2026-03-31').netMinor).toBe(10_000 + 200_000);
    expect(netWorthAt(h, '2026-09-30').netMinor).toBe(15_000 + 260_000);
  });
  it('uses the exchange rate effective on that date, and flags missing ones', () => {
    const rates: ExchangeRate[] = [
      { ...base, id: 'r1', currency: 'USD', rateToBase: 500, date: '2026-01-01', source: 'manual' },
      { ...base, id: 'r2', currency: 'USD', rateToBase: 600, date: '2026-07-01', source: 'manual' },
    ];
    const h = { ...empty, accounts: [acc('usd', 10_000, '2025-01-01', 'USD')], rates };
    expect(netWorthAt(h, '2026-03-31').netMinor).toBe(50_000);
    expect(netWorthAt(h, '2026-08-31').netMinor).toBe(60_000);
    expect(netWorthAt(h, '2025-12-31').unconverted).toHaveLength(1);
    expect(rateAt(rates, 'USD', '2026-06-30')).toBe(500);
  });
});

describe('investments in current net worth (acceptance #10, #11)', () => {
  it('counts market value, not cost basis', () => {
    const nw = computeNetWorth([], [], new Map(), {
      investments: [{ id: 'i', name: 'X', currency: 'YER', quantityMicro: 2_000_000, lastPriceMinor: 7_000, lastPriceDate: '2026-11-01' }],
    });
    expect(nw.assetsMinor).toBe(14_000);
  });
});

describe('trend dates', () => {
  it('month ends end with today', () => {
    expect(monthEnds('2026-11-18', 3)).toEqual(['2026-09-30', '2026-10-31', '2026-11-18']);
    expect(yearEnds('2026-11-18', 3)).toEqual(['2024-12-31', '2025-12-31', '2026-11-18']);
  });
});
