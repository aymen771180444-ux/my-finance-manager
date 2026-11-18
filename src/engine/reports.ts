/**
 * Report builder — pure. Produces one neutral ReportDoc that the screen, the
 * XLSX exporter and the print/PDF view all render. Because every format reads
 * the same numbers, exported totals cannot drift from what the app shows
 * (acceptance #20).
 */

import type { Account, Asset, Category, Debt, Investment, Transaction, TxnType } from '../db/types';
import { convertToBase, type CurrencyCode } from './money';
import { summarize, topEntries, averages, type SplitLine, type PeriodSummary } from './analytics';
import { computeNetWorth } from './networth';
import { countsAsExpense, countsAsIncome, isExpenseReduction, totalsContribution } from './posting';

export type ReportType = 'comprehensive' | 'expense' | 'income' | 'debt' | 'account' | 'networth' | 'custom';

export interface ReportFilters {
  from: string;
  to: string;
  accountId?: string | null;
  currency?: CurrencyCode | null;
  categoryId?: string | null;
  tagId?: string | null;
}

export type CellKind = 'text' | 'money' | 'date' | 'pct' | 'count';

export interface ReportColumn {
  key: string;
  label: string;
  kind: CellKind;
  /** For money columns: currency of the values (default YER). */
  currencyKey?: string;
}

export type CellValue = string | number | null;

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, CellValue>[];
  totals?: Record<string, CellValue>;
}

export interface ReportKpi {
  label: string;
  valueMinor: number;
  kind: 'money' | 'pct';
  tone: 'income' | 'expense' | 'neutral' | 'liability';
}

export interface ReportDoc {
  type: ReportType;
  title: string;
  from: string;
  to: string;
  kpis: ReportKpi[];
  tables: ReportTable[];
  notes: string[];
}

export interface ReportData {
  txns: Transaction[];
  splitsByTxn: Map<string, SplitLine[]>;
  cats: Map<string, Category>;
  accounts: Account[];
  debts: Debt[];
  latestRates: Map<string, number>;
  /** txn ids carrying the filter tag (null when no tag filter). */
  taggedTxnIds: Set<string> | null;
  investments?: Investment[];
  assets?: Asset[];
}

const nwExtras = (d: ReportData) => ({ investments: d.investments ?? [], assets: d.assets ?? [] });

type T = (key: string, params?: Record<string, unknown>) => string;

/** Apply report filters to transactions. Category filter matches parent, child or split lines. */
export function filterTxns(data: ReportData, f: ReportFilters): Transaction[] {
  return data.txns.filter((t) => {
    if (t.date < f.from || t.date > f.to) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (f.currency && t.currency !== f.currency) return false;
    if (data.taggedTxnIds && !data.taggedTxnIds.has(t.id)) return false;
    if (f.categoryId) {
      const match = (id: string | null) => {
        if (!id) return false;
        if (id === f.categoryId) return true;
        return data.cats.get(id)?.parentId === f.categoryId;
      };
      const lines = t.hasSplits ? data.splitsByTxn.get(t.id) ?? [] : [];
      if (!match(t.categoryId) && !match(t.subcategoryId) && !lines.some((l) => match(l.categoryId))) return false;
    }
    return true;
  });
}

function catLabel(id: string, data: ReportData, lang: string, t: T): string {
  if (id === '_none') return t('common.none');
  const c = data.cats.get(id);
  if (!c) return t('common.none');
  return lang.startsWith('ar') ? c.nameAr || c.nameEn : c.nameEn || c.nameAr;
}

function categoryTable(title: string, map: Map<string, number>, total: number, data: ReportData, lang: string, t: T): ReportTable {
  const entries = topEntries(map, 1000);
  return {
    title,
    columns: [
      { key: 'category', label: t('common.category'), kind: 'text' },
      { key: 'amount', label: t('common.amount'), kind: 'money' },
      { key: 'share', label: t('reports.share'), kind: 'pct' },
    ],
    rows: entries.map(([id, v]) => ({
      category: catLabel(id, data, lang, t),
      amount: v,
      share: total > 0 ? Math.round((v / total) * 100) : 0,
    })),
    totals: { category: t('reports.total'), amount: entries.reduce((s, [, v]) => s + v, 0), share: null },
  };
}

/**
 * Transactions table. `income` and `expense` columns hold the signed base
 * contributions, so their totals equal the KPI totals exactly.
 */
function txnTable(title: string, txns: Transaction[], data: ReportData, lang: string, t: T, only?: (x: Transaction) => boolean): ReportTable {
  const list = (only ? txns.filter(only) : txns).slice().sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  const accName = new Map(data.accounts.map((a) => [a.id, a.name]));
  let inc = 0;
  let exp = 0;
  const rows = list.map((x) => {
    const c = totalsContribution(x);
    inc += c.incomeMinor;
    exp += c.expenseMinor;
    return {
      date: x.date,
      type: t(`txn.types.${x.type}`),
      category: x.hasSplits ? t('txn.split') : x.categoryId ? catLabel(data.cats.get(x.categoryId)?.parentId ?? x.categoryId, data, lang, t) : '',
      account: accName.get(x.accountId) ?? '',
      notes: [x.person, x.notes].filter(Boolean).join(' — '),
      amount: x.amountMinor,
      currency: x.currency,
      income: c.incomeMinor || null,
      expense: c.expenseMinor || null,
      base: x.baseAmountMinor,
    } as Record<string, CellValue>;
  });
  return {
    title,
    columns: [
      { key: 'date', label: t('common.date'), kind: 'date' },
      { key: 'type', label: t('txn.type'), kind: 'text' },
      { key: 'category', label: t('common.category'), kind: 'text' },
      { key: 'account', label: t('common.account'), kind: 'text' },
      { key: 'notes', label: t('common.notes'), kind: 'text' },
      { key: 'amount', label: t('reports.originalAmount'), kind: 'money', currencyKey: 'currency' },
      { key: 'income', label: t('dashboard.income'), kind: 'money' },
      { key: 'expense', label: t('dashboard.expenses'), kind: 'money' },
    ],
    rows,
    totals: { date: t('reports.total'), income: inc, expense: exp },
  };
}

function accountTable(data: ReportData, t: T): ReportTable {
  const rows = data.accounts.map((a) => {
    const r = a.currency === 'YER' ? 1 : data.latestRates.get(a.currency);
    return {
      name: a.name,
      type: t(`accounts.types.${a.type}`),
      status: t(`accounts.${a.status}`),
      balance: a.currentBalanceMinor,
      currency: a.currency,
      base: r === undefined ? null : convertToBase(a.currentBalanceMinor, a.currency, r),
    } as Record<string, CellValue>;
  });
  const missing = rows.some((r) => r.base === null);
  return {
    title: t('reports.accountsSection'),
    columns: [
      { key: 'name', label: t('common.name'), kind: 'text' },
      { key: 'type', label: t('txn.type'), kind: 'text' },
      { key: 'status', label: t('common.status'), kind: 'text' },
      { key: 'balance', label: t('accounts.currentBalance'), kind: 'money', currencyKey: 'currency' },
      { key: 'base', label: t('reports.inBase'), kind: 'money' },
    ],
    rows,
    totals: { name: t('reports.total'), base: missing ? null : rows.reduce((s, r) => s + (r.base as number), 0) },
  };
}

function debtTable(data: ReportData, t: T): ReportTable {
  const rows = data.debts.map((d) => ({
    person: d.person,
    direction: t(d.direction === 'owed_to_me' ? 'debts.owedToMe' : 'debts.iOwe'),
    principal: d.principalMinor,
    remaining: d.remainingMinor,
    currency: d.currency,
    due: d.dueDate,
    status: t(d.status === 'open' ? 'debts.open' : 'debts.settled'),
  }));
  return {
    title: t('reports.debtsSection'),
    columns: [
      { key: 'person', label: t('debts.person'), kind: 'text' },
      { key: 'direction', label: t('txn.type'), kind: 'text' },
      { key: 'principal', label: t('debts.principal'), kind: 'money', currencyKey: 'currency' },
      { key: 'remaining', label: t('debts.remaining'), kind: 'money', currencyKey: 'currency' },
      { key: 'due', label: t('debts.dueDate'), kind: 'date' },
      { key: 'status', label: t('common.status'), kind: 'text' },
    ],
    rows,
  };
}

function kpisFor(s: PeriodSummary, t: T): ReportKpi[] {
  const k: ReportKpi[] = [
    { label: t('dashboard.income'), valueMinor: s.incomeMinor, kind: 'money', tone: 'income' },
    { label: t('dashboard.expenses'), valueMinor: s.expenseMinor, kind: 'money', tone: 'expense' },
    { label: t('reports.net'), valueMinor: s.netMinor, kind: 'money', tone: 'neutral' },
  ];
  if (s.savingsRatePct !== null) k.push({ label: t('reports.savingsRate'), valueMinor: s.savingsRatePct, kind: 'pct', tone: 'neutral' });
  return k;
}

export function buildReport(type: ReportType, data: ReportData, f: ReportFilters, t: T, lang: string): ReportDoc {
  const txns = filterTxns(data, f);
  const s = summarize(txns, data.splitsByTxn, data.cats);
  const doc: ReportDoc = { type, title: t(`reports.types.${type}`), from: f.from, to: f.to, kpis: [], tables: [], notes: [] };
  if (s.unconvertible > 0) doc.notes.push(t('dashboard.unconvertedNote', { count: s.unconvertible }));
  const isInc = (x: Transaction) => countsAsIncome(x);
  const isExp = (x: Transaction) => countsAsExpense(x) || isExpenseReduction(x);

  switch (type) {
    case 'comprehensive': {
      doc.kpis = kpisFor(s, t);
      const nw = computeNetWorth(data.accounts.filter((a) => a.status === 'active'), data.debts, data.latestRates, nwExtras(data));
      doc.kpis.push({ label: t('dashboard.netWorth'), valueMinor: nw.netMinor, kind: 'money', tone: 'neutral' });
      doc.tables.push(categoryTable(t('reports.expenseByCategory'), s.expenseByCategory, s.expenseMinor, data, lang, t));
      doc.tables.push(categoryTable(t('reports.incomeBySource'), s.incomeByCategory, s.incomeMinor, data, lang, t));
      doc.tables.push(accountTable(data, t));
      if (data.debts.length) doc.tables.push(debtTable(data, t));
      doc.tables.push(txnTable(t('reports.transactionsSection'), txns, data, lang, t));
      break;
    }
    case 'expense': {
      const avg = averages(s.expenseMinor, f.from, f.to);
      doc.kpis = [
        { label: t('dashboard.expenses'), valueMinor: s.expenseMinor, kind: 'money', tone: 'expense' },
        { label: t('analytics.avgDaily'), valueMinor: avg.dailyMinor, kind: 'money', tone: 'neutral' },
        { label: t('analytics.avgMonthly'), valueMinor: avg.monthlyMinor, kind: 'money', tone: 'neutral' },
      ];
      doc.tables.push(categoryTable(t('reports.expenseByCategory'), s.expenseByCategory, s.expenseMinor, data, lang, t));
      doc.tables.push(txnTable(t('reports.transactionsSection'), txns, data, lang, t, isExp));
      break;
    }
    case 'income': {
      doc.kpis = [{ label: t('dashboard.income'), valueMinor: s.incomeMinor, kind: 'money', tone: 'income' }];
      doc.tables.push(categoryTable(t('reports.incomeBySource'), s.incomeByCategory, s.incomeMinor, data, lang, t));
      doc.tables.push(txnTable(t('reports.transactionsSection'), txns, data, lang, t, isInc));
      break;
    }
    case 'debt': {
      const nw = computeNetWorth([], data.debts, data.latestRates);
      doc.kpis = [
        { label: t('debts.totalOwedToMe'), valueMinor: nw.assetsMinor, kind: 'money', tone: 'income' },
        { label: t('debts.totalIOwe'), valueMinor: nw.liabilitiesMinor, kind: 'money', tone: 'liability' },
      ];
      doc.tables.push(debtTable(data, t));
      const debtTypes: TxnType[] = ['lend', 'borrow', 'debt_repayment'];
      doc.tables.push(txnTable(t('debts.repaymentHistory'), txns, data, lang, t, (x) => debtTypes.includes(x.type)));
      break;
    }
    case 'account': {
      const accounts = f.accountId ? data.accounts.filter((a) => a.id === f.accountId) : data.accounts;
      doc.tables.push(accountTable({ ...data, accounts }, t));
      doc.kpis = kpisFor(s, t);
      doc.tables.push(txnTable(t('reports.transactionsSection'), txns, data, lang, t));
      break;
    }
    case 'networth': {
      const nw = computeNetWorth(data.accounts.filter((a) => a.status === 'active'), data.debts, data.latestRates, nwExtras(data));
      doc.kpis = [
        { label: t('reports.assets'), valueMinor: nw.assetsMinor, kind: 'money', tone: 'income' },
        { label: t('reports.liabilities'), valueMinor: nw.liabilitiesMinor, kind: 'money', tone: 'liability' },
        { label: t('dashboard.netWorth'), valueMinor: nw.netMinor, kind: 'money', tone: 'neutral' },
      ];
      const itemTable = (title: string, items: typeof nw.assets): ReportTable => ({
        title,
        columns: [
          { key: 'label', label: t('common.name'), kind: 'text' },
          { key: 'kind', label: t('txn.type'), kind: 'text' },
          { key: 'amount', label: t('reports.originalAmount'), kind: 'money', currencyKey: 'currency' },
          { key: 'base', label: t('reports.inBase'), kind: 'money' },
        ],
        rows: items.map((x) => ({
          label: x.label,
          kind: t({ account: 'common.account', debt: 'more.debts', investment: 'more.investments', asset: 'more.assets' }[x.kind]),
          amount: x.amountMinor,
          currency: x.currency,
          base: x.baseMinor,
        })),
        totals: { label: t('reports.total'), base: items.reduce((sum, x) => sum + x.baseMinor, 0) },
      });
      doc.tables.push(itemTable(t('reports.assets'), nw.assets), itemTable(t('reports.liabilities'), nw.liabilities));
      for (const u of nw.unconverted) doc.notes.push(`${u.label} (${u.currency}): ${t('common.cannotConvert')}`);
      doc.notes.push(t('reports.netWorthNote'));
      break;
    }
    case 'custom': {
      doc.kpis = kpisFor(s, t);
      doc.tables.push(txnTable(t('reports.transactionsSection'), txns, data, lang, t));
      break;
    }
  }
  return doc;
}
