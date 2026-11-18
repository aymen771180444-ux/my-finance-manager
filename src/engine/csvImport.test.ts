import { describe, it, expect } from 'vitest';
import { parseCsv, guessColumns, parseDate, guessDateFormat, parseType, buildRows } from './csvImport';
import type { Account, Category } from '../db/types';

const ts = '2026-01-01T00:00:00.000Z';
const acc = (id: string, name: string, currency: Account['currency'] = 'YER') =>
  ({ id, name, currency, createdAt: ts, updatedAt: ts, profileId: 'p', type: 'bank', openingBalanceMinor: 0, currentBalanceMinor: 0, openedAt: ts, notes: '', status: 'active', sharedWithProfileIds: [] }) as Account;
const cat = (id: string, en: string, ar: string, kind: Category['kind'], parentId: string | null = null) =>
  ({ id, nameEn: en, nameAr: ar, kind, parentId, isArchived: false, group: 'essentials', createdAt: ts, updatedAt: ts, profileId: 'p', nameKey: null, color: '#000', icon: 'Shapes' }) as Category;

const accounts = [acc('cash', 'النقد'), acc('bank', 'Bank'), acc('usd', 'USD acc', 'USD')];
const categories = [cat('food', 'Food', 'الطعام', 'expense'), cat('groc', 'Groceries', 'البقالة', 'expense', 'food'), cat('sal', 'Salary', 'الراتب', 'income')];

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines, BOM and CRLF', () => {
    const rows = parseCsv('﻿date,notes\r\n2026-01-02,"lunch, ""big""\nwith team"\r\n');
    expect(rows).toEqual([['date', 'notes'], ['2026-01-02', 'lunch, "big"\nwith team']]);
  });
  it('detects semicolon delimiters (European/Arabic Excel)', () => {
    expect(parseCsv('a;b\n1,5;2')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
  it('skips blank lines', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']]);
  });
});

describe('column guessing', () => {
  it('recognizes English, Arabic and this app\'s export headers', () => {
    expect(guessColumns(['التاريخ', 'المبلغ', 'البيان', 'الحساب'])).toEqual({ date: 0, amount: 1, notes: 2, account: 3 });
    expect(guessColumns(['date', 'type', 'amount', 'currency', 'rate_to_YER', 'amount_YER', 'account', 'to_account', 'category'])).toMatchObject({
      date: 0, type: 1, amount: 2, currency: 3, account: 6, toAccount: 7, category: 8,
    });
  });
});

describe('dates', () => {
  it('parses each format and rejects impossible dates', () => {
    expect(parseDate('2026-03-05', 'dmy')).toBe('2026-03-05'); // yyyy-first is unambiguous
    expect(parseDate('05/03/2026', 'dmy')).toBe('2026-03-05');
    expect(parseDate('03/05/2026', 'mdy')).toBe('2026-03-05');
    expect(parseDate('٠٥/٠٣/٢٠٢٦', 'dmy')).toBe('2026-03-05');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('hello', 'dmy')).toBeNull();
  });
  it('guesses dmy when a day > 12 appears, mdy when only that fits', () => {
    expect(guessDateFormat(['25/03/2026', '01/04/2026'])).toBe('dmy');
    expect(guessDateFormat(['03/25/2026'])).toBe('mdy');
    expect(guessDateFormat(['2026-03-25'])).toBe('ymd');
  });
  it('recognizes Arabic and English type words', () => {
    expect(parseType('مصروف')).toBe('expense');
    expect(parseType('Income')).toBe('income');
    expect(parseType('تحويل')).toBe('transfer');
    expect(parseType('???')).toBeNull();
  });
});

describe('buildRows', () => {
  const opts = (map: Record<string, number>, defaultAccountId: string | null = 'cash') =>
    ({ map, dateFormat: 'dmy' as const, defaultAccountId, hasHeader: true });

  it('signed amounts without a type column: negative = expense, positive = income', () => {
    const table = [['date', 'amount', 'notes'], ['01/03/2026', '-5,000', 'lunch'], ['02/03/2026', '200000', 'salary']];
    const rows = buildRows(table, opts({ date: 0, amount: 1, notes: 2 }), { accounts, categories, existing: [] });
    expect(rows.map((r) => [r.type, r.amountMinor, r.accountId])).toEqual([['expense', 5000, 'cash'], ['income', 200000, 'cash']]);
  });

  it('matches accounts, categories and subcategories by Arabic or English name', () => {
    const table = [['date', 'type', 'amount', 'account', 'category', 'subcategory'], ['01/03/2026', 'مصروف', '7000', 'bank', 'Food / الطعام', 'البقالة']];
    const [r] = buildRows(table, opts({ date: 0, type: 1, amount: 2, account: 3, category: 4, subcategory: 5 }), { accounts, categories, existing: [] });
    expect(r).toMatchObject({ status: 'ok', accountId: 'bank', categoryId: 'food', subcategoryId: 'groc' });
  });

  it('uses the account currency for decimals and rejects mismatched currency', () => {
    const table = [['date', 'amount', 'account', 'currency'], ['01/03/2026', '19.99', 'USD acc', 'USD'], ['01/03/2026', '10', 'USD acc', 'SAR']];
    const rows = buildRows(table, opts({ date: 0, amount: 1, account: 2, currency: 3 }), { accounts, categories, existing: [] });
    expect(rows[0].amountMinor).toBe(1999);
    expect(rows[1]).toMatchObject({ status: 'error', error: 'currency' });
  });

  it('flags invalid rows with a reason instead of guessing', () => {
    const table = [['date', 'amount', 'account'], ['31/02/2026', '5', ''], ['01/03/2026', 'abc', ''], ['01/03/2026', '5', 'Unknown bank'], ['01/03/2026', '0', '']];
    const rows = buildRows(table, opts({ date: 0, amount: 1, account: 2 }), { accounts, categories, existing: [] });
    expect(rows.map((r) => r.error)).toEqual(['date', 'amount', 'account', 'amount']);
    expect(rows[0].line).toBe(2);
  });

  it('transfers need a same-currency destination', () => {
    const table = [['date', 'type', 'amount', 'account', 'to'], ['01/03/2026', 'transfer', '100', 'Bank', 'النقد'], ['01/03/2026', 'transfer', '100', 'Bank', 'Bank'], ['01/03/2026', 'transfer', '100', 'Bank', 'USD acc']];
    const rows = buildRows(table, opts({ date: 0, type: 1, amount: 2, account: 3, toAccount: 4 }), { accounts, categories, existing: [] });
    expect(rows.map((r) => r.status === 'ok' ? r.toAccountId : r.error)).toEqual(['cash', 'sameAccount', 'currency']);
  });

  it('marks duplicates of existing transactions and repeats within the file', () => {
    const table = [['date', 'amount', 'notes'], ['01/03/2026', '-5000', 'Lunch'], ['01/03/2026', '-5000', 'lunch'], ['02/03/2026', '-5000', 'Lunch']];
    const existing = [{ date: '2026-03-02', amountMinor: 5000, accountId: 'cash', notes: 'lunch' }];
    const rows = buildRows(table, opts({ date: 0, amount: 1, notes: 2 }), { accounts, categories, existing });
    expect(rows.map((r) => r.status)).toEqual(['ok', 'duplicate', 'duplicate']);
  });
});
