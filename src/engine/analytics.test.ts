import { describe, it, expect } from 'vitest';
import { summarize, averages, pctChange, generateInsights, netFlowMinor, type PeriodSummary } from './analytics';
import { computeNetWorth } from './networth';
import { buildReport, type ReportData } from './reports';
import type { Transaction, Category, Account, Debt } from '../db/types';

const ts = '2026-11-01T00:00:00.000Z';
function cat(id: string, group: Category['group'], kind: Category['kind'] = 'expense', parentId: string | null = null): Category {
  return { id, createdAt: ts, updatedAt: ts, profileId: 'p', parentId, kind, group, nameKey: id, nameAr: id, nameEn: id, color: '#000', icon: 'Shapes', isArchived: false };
}
let n = 0;
function txn(p: Partial<Transaction>): Transaction {
  n++;
  return {
    id: `t${n}`, createdAt: ts, updatedAt: ts, profileId: 'p', type: 'expense', amountMinor: 1000, currency: 'YER',
    fxRateToBase: 1, baseAmountMinor: p.amountMinor ?? 1000, accountId: 'cash', toAccountId: null, categoryId: null,
    subcategoryId: null, date: '2026-11-10', paymentMethod: null, person: '', notes: '', linkedTxnId: null, debtId: null,
    goalId: null, investmentId: null, attachmentIds: [], location: '', hasSplits: false, ...p,
  };
}
const cats = new Map<string, Category>([
  ['food', cat('food', 'essentials')],
  ['groceries', cat('groceries', 'essentials', 'expense', 'food')],
  ['fun', cat('fun', 'wants')],
  ['salary', cat('salary', 'income', 'income')],
]);

describe('summarize', () => {
  const txns = [
    txn({ type: 'income', amountMinor: 100_000, categoryId: 'salary', date: '2026-11-01' }),
    txn({ amountMinor: 20_000, categoryId: 'groceries', date: '2026-11-07' }), // Saturday
    txn({ amountMinor: 10_000, categoryId: 'fun', date: '2026-11-08' }),
    txn({ type: 'transfer', amountMinor: 50_000, toAccountId: 'bank' }), // excluded
    txn({ type: 'refund', amountMinor: 5_000, categoryId: 'fun', date: '2026-11-09' }),
    txn({ amountMinor: 3_000, baseAmountMinor: null, fxRateToBase: null, currency: 'USD' }), // unconvertible
    txn({ id: 'split1', amountMinor: 8_000, hasSplits: true, date: '2026-11-10' }),
  ];
  const splits = new Map([['split1', [{ categoryId: 'food', amountMinor: 6_000 }, { categoryId: 'fun', amountMinor: 2_000 }]]]);
  const s = summarize(txns, splits, cats);

  it('totals income/expense, excluding transfers and netting refunds', () => {
    expect(s.incomeMinor).toBe(100_000);
    expect(s.expenseMinor).toBe(20_000 + 10_000 - 5_000 + 8_000);
    expect(s.netMinor).toBe(100_000 - 33_000);
    expect(s.savingsRatePct).toBe(67);
  });
  it('rolls subcategories into parents and allocates splits', () => {
    expect(s.expenseByCategory.get('food')).toBe(20_000 + 6_000);
    expect(s.expenseByCategory.get('fun')).toBe(10_000 - 5_000 + 2_000);
  });
  it('category totals reconcile to the expense total', () => {
    const sum = [...s.expenseByCategory.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.expenseMinor);
  });
  it('splits needs vs wants by category group', () => {
    expect(s.needsMinor).toBe(26_000);
    expect(s.wantsMinor).toBe(7_000);
  });
  it('flags unconvertible transactions instead of guessing', () => {
    expect(s.unconvertible).toBe(1);
  });
  it('tracks weekday spending', () => {
    expect(s.expenseByWeekday[6]).toBe(20_000); // Saturday
  });
});

describe('netFlowMinor', () => {
  const none = () => null;
  it('transfers net to zero; lending/borrowing move balances', () => {
    expect(netFlowMinor(txn({ type: 'transfer', amountMinor: 5_000, toAccountId: 'bank' }), none)).toBe(0);
    expect(netFlowMinor(txn({ type: 'lend', amountMinor: 5_000 }), none)).toBe(-5_000);
    expect(netFlowMinor(txn({ type: 'income', amountMinor: 5_000 }), none)).toBe(5_000);
  });
  it('repayment direction comes from the debt', () => {
    expect(netFlowMinor(txn({ type: 'debt_repayment', amountMinor: 2_000, debtId: 'd' }), () => 'owed_to_me')).toBe(2_000);
    expect(netFlowMinor(txn({ type: 'debt_repayment', amountMinor: 2_000, debtId: 'd' }), () => 'i_owe')).toBe(-2_000);
  });
  it('uses the frozen base amount for foreign currency', () => {
    expect(netFlowMinor(txn({ type: 'expense', amountMinor: 1_000, currency: 'USD', baseAmountMinor: 5_330 }), none)).toBe(-5_330);
  });
});

describe('averages / pctChange', () => {
  it('averages over calendar days', () => {
    const a = averages(30_000, '2026-11-01', '2026-11-30');
    expect(a.dailyMinor).toBe(1_000);
    expect(a.weeklyMinor).toBe(7_000);
  });
  it('pctChange has no baseline when previous is zero', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
  });
});

describe('insights only from real data (PRD §17)', () => {
  const empty = summarize([], new Map(), cats);
  it('no insights without a baseline', () => {
    const cur = summarize([txn({ amountMinor: 99_000, categoryId: 'food' })], new Map(), cats);
    const ins = generateInsights({ current: cur, previous: empty, daysElapsed: 10, daysTotal: 30, upcomingObligationsMinor: 0, liquidBalanceMinor: 0, totalBudgetMinor: 0 });
    expect(ins.find((i) => i.kind === 'spendingUp')).toBeUndefined();
  });
  it('detects spending increase at the same point in the period', () => {
    const prev: PeriodSummary = { ...empty, expenseMinor: 30_000 };
    const cur: PeriodSummary = { ...empty, expenseMinor: 15_000 }; // 10/30 days: prev pace = 10k
    const ins = generateInsights({ current: cur, previous: prev, daysElapsed: 10, daysTotal: 30, upcomingObligationsMinor: 0, liquidBalanceMinor: 0, totalBudgetMinor: 0 });
    expect(ins.find((i) => i.kind === 'spendingUp')?.params.pct).toBe(50);
  });
  it('warns when obligations exceed the liquid balance', () => {
    const ins = generateInsights({ current: empty, previous: empty, daysElapsed: 10, daysTotal: 30, upcomingObligationsMinor: 50_000, liquidBalanceMinor: 20_000, totalBudgetMinor: 0 });
    expect(ins.some((i) => i.kind === 'obligationsVsBalance')).toBe(true);
  });
  it('projects overspending from current pace', () => {
    const cur: PeriodSummary = { ...empty, expenseMinor: 50_000 };
    const ins = generateInsights({ current: cur, previous: empty, daysElapsed: 10, daysTotal: 30, upcomingObligationsMinor: 0, liquidBalanceMinor: 0, totalBudgetMinor: 100_000 });
    expect(ins.find((i) => i.kind === 'paceOverspend')?.params.projected).toBe(150_000);
  });
});

const acc = (id: string, bal: number, currency: Account['currency'] = 'YER', status: Account['status'] = 'active') =>
  ({ id, name: id, currency, currentBalanceMinor: bal, status }) as Account;
const debt = (id: string, remaining: number, direction: Debt['direction'], status: Debt['status'] = 'open') =>
  ({ id, person: id, currency: 'YER', remainingMinor: remaining, direction, status }) as Debt;

describe('net worth (acceptance #10)', () => {
  it('assets − liabilities, card debt as liability, receivables as assets', () => {
    const nw = computeNetWorth(
      [acc('cash', 100_000), acc('savings', 50_000), acc('card', -30_000)],
      [debt('ali', 20_000, 'owed_to_me'), debt('bank', 40_000, 'i_owe'), debt('old', 10_000, 'i_owe', 'settled')],
      new Map(),
    );
    expect(nw.assetsMinor).toBe(170_000);
    expect(nw.liabilitiesMinor).toBe(70_000);
    expect(nw.netMinor).toBe(100_000);
  });
  it('a shared account appearing twice is counted once', () => {
    const nw = computeNetWorth([acc('cash', 100_000), acc('cash', 100_000)], [], new Map());
    expect(nw.assetsMinor).toBe(100_000);
  });
  it('converts foreign balances and reports missing rates', () => {
    const nw = computeNetWorth([acc('usd', 10_000, 'USD'), acc('sar', 10_000, 'SAR')], [], new Map([['USD', 533]]));
    expect(nw.assetsMinor).toBe(53_300);
    expect(nw.unconverted).toEqual([{ label: 'sar', currency: 'SAR' }]);
  });
});

describe('report totals (acceptance #20)', () => {
  const t = (k: string) => k;
  const data: ReportData = {
    txns: [
      txn({ type: 'income', amountMinor: 100_000, categoryId: 'salary', date: '2026-11-01' }),
      txn({ amountMinor: 20_000, categoryId: 'groceries', date: '2026-11-05' }),
      txn({ amountMinor: 7_000, categoryId: 'fun', date: '2026-11-06', accountId: 'bank' }),
      txn({ type: 'refund', amountMinor: 2_000, categoryId: 'fun', date: '2026-11-07' }),
      txn({ type: 'transfer', amountMinor: 5_000, toAccountId: 'bank', date: '2026-11-08' }),
      txn({ amountMinor: 9_999, categoryId: 'food', date: '2026-10-30' }), // outside range
    ],
    splitsByTxn: new Map(),
    cats,
    accounts: [acc('cash', 100_000), acc('bank', 50_000)],
    debts: [],
    latestRates: new Map(),
    taggedTxnIds: null,
  };
  const f = { from: '2026-11-01', to: '2026-11-30' };

  it('transaction-table totals equal the KPI totals', () => {
    const doc = buildReport('comprehensive', data, f, t, 'en');
    const income = doc.kpis.find((k) => k.label === 'dashboard.income')!.valueMinor;
    const expense = doc.kpis.find((k) => k.label === 'dashboard.expenses')!.valueMinor;
    expect(income).toBe(100_000);
    expect(expense).toBe(25_000);
    const txTable = doc.tables.find((x) => x.title === 'reports.transactionsSection')!;
    expect(txTable.totals!.income).toBe(income);
    expect(txTable.totals!.expense).toBe(expense);
    expect(txTable.rows).toHaveLength(5); // out-of-range row excluded, transfer listed
  });
  it('category table totals equal the expense KPI', () => {
    const doc = buildReport('expense', data, f, t, 'en');
    const catTable = doc.tables.find((x) => x.title === 'reports.expenseByCategory')!;
    expect(catTable.totals!.amount).toBe(25_000);
  });
  it('account filter restricts transactions', () => {
    const doc = buildReport('custom', data, { ...f, accountId: 'bank' }, t, 'en');
    const txTable = doc.tables[0];
    // the 7,000 expense paid from bank + the transfer INTO bank
    expect(txTable.rows).toHaveLength(2);
    expect(txTable.totals!.expense).toBe(7_000);
  });
  it('category filter includes subcategories', () => {
    const doc = buildReport('custom', data, { ...f, categoryId: 'food' }, t, 'en');
    expect(doc.tables[0].totals!.expense).toBe(20_000);
  });
  it('account balances total in base currency', () => {
    const doc = buildReport('account', data, f, t, 'en');
    expect(doc.tables[0].totals!.base).toBe(150_000);
  });
});
