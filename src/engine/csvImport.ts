/**
 * Historical transaction import (PRD §8: "users must be able to import
 * historical transactions") — pure parsing, mapping and validation.
 * Nothing here touches the database; the repo commits validated rows through
 * the normal posting engine, so imported data obeys every accounting rule.
 */

import { toMinor, type CurrencyCode } from './money';
import type { Account, Category, Transaction } from '../db/types';

// ——— CSV parsing (RFC 4180: quotes, escaped quotes, newlines in fields) ———

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<',' | ';' | '\t', number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch as ',' | ';' | '\t']++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as ',' | ';' | '\t');
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// ——— column mapping ———

export type ImportField = 'date' | 'type' | 'amount' | 'currency' | 'account' | 'toAccount' | 'category' | 'subcategory' | 'notes' | 'person';
export const IMPORT_FIELDS: ImportField[] = ['date', 'type', 'amount', 'account', 'toAccount', 'category', 'subcategory', 'notes', 'person', 'currency'];
export type ColumnMap = Partial<Record<ImportField, number>>;

const SYNONYMS: Record<ImportField, string[]> = {
  date: ['date', 'transaction date', 'التاريخ', 'تاريخ'],
  type: ['type', 'kind', 'النوع', 'نوع'],
  amount: ['amount', 'value', 'sum', 'المبلغ', 'مبلغ', 'القيمة'],
  currency: ['currency', 'العملة'],
  account: ['account', 'from account', 'الحساب', 'حساب'],
  toAccount: ['to_account', 'to account', 'إلى حساب', 'الى حساب'],
  category: ['category', 'التصنيف', 'تصنيف', 'الفئة'],
  subcategory: ['subcategory', 'sub category', 'التصنيف الفرعي'],
  notes: ['notes', 'note', 'description', 'memo', 'details', 'ملاحظات', 'الملاحظات', 'البيان', 'الوصف'],
  person: ['person', 'payee', 'merchant', 'party', 'الشخص', 'الجهة', 'الشخص / الجهة'],
};

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/_/g, ' ');

/** Guess which column holds which field from the header row. */
export function guessColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const f of IMPORT_FIELDS) {
      if (map[f] !== undefined) continue;
      if (SYNONYMS[f].some((s) => norm(s) === n)) {
        map[f] = i;
        break;
      }
    }
  });
  return map;
}

// ——— values ———

export type DateFormat = 'ymd' | 'dmy' | 'mdy';

const AR_DIGITS = (s: string) => s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));

/** Parse a date to ISO yyyy-mm-dd, or null when invalid. */
export function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = AR_DIGITS(raw.trim()).split(/[T ]/)[0];
  const parts = s.split(/[-/.]/).map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  let [y, m, d] = [0, 0, 0];
  if (fmt === 'ymd' || parts[0] > 31) [y, m, d] = parts;
  else if (fmt === 'dmy') [d, m, y] = parts;
  else [m, d, y] = parts;
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d, 12);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Pick the first format that makes every sample valid. Order matters:
 * ambiguous dd/mm vs mm/dd resolves to dmy (the norm in Yemen/KSA) unless a
 * sample like 03/25 proves mdy.
 */
export function guessDateFormat(samples: string[]): DateFormat {
  if (!samples.length) return 'dmy';
  return (['ymd', 'dmy', 'mdy'] as DateFormat[]).find((f) => samples.every((s) => parseDate(s, f) !== null)) ?? 'dmy';
}

export type ImportType = 'income' | 'expense' | 'transfer';
const TYPE_WORDS: Record<ImportType, string[]> = {
  income: ['income', 'credit', 'deposit in', 'دخل', 'ايراد', 'إيراد', 'وارد'],
  expense: ['expense', 'debit', 'spending', 'مصروف', 'مصروفات', 'صرف', 'منصرف'],
  transfer: ['transfer', 'تحويل', 'تحويل بين الحسابات'],
};

export function parseType(raw: string | undefined): ImportType | null {
  if (!raw) return null;
  const n = norm(raw);
  for (const [t, words] of Object.entries(TYPE_WORDS) as [ImportType, string[]][]) if (words.some((w) => norm(w) === n)) return t;
  return null;
}

// ——— row building ———

export interface ImportOptions {
  map: ColumnMap;
  dateFormat: DateFormat;
  /** Used when there is no account column (or a row's account is blank). */
  defaultAccountId: string | null;
  hasHeader: boolean;
}

export type RowStatus = 'ok' | 'duplicate' | 'error';

export interface ImportRow {
  line: number; // 1-based line in the file
  status: RowStatus;
  error?: 'date' | 'amount' | 'account' | 'toAccount' | 'currency' | 'type' | 'sameAccount';
  date?: string;
  type?: ImportType;
  amountMinor?: number;
  accountId?: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  notes?: string;
  person?: string;
  raw: string[];
}

const findAccount = (name: string, accounts: Account[]) => {
  const n = norm(name);
  return accounts.find((a) => norm(a.name) === n);
};

/** Matches "Food", "الطعام", or this app's export form "Food / الطعام". */
function findCategory(name: string, cats: Category[], parentId: string | null): Category | undefined {
  const candidates = name.split(' / ').map(norm).filter(Boolean);
  if (!candidates.length) return undefined;
  return cats.find((c) => (parentId === null ? true : c.parentId === parentId) && candidates.some((x) => x === norm(c.nameAr) || x === norm(c.nameEn)));
}

/** Same date, amount, account and notes as an existing transaction = probable duplicate. */
export const dupKey = (t: { date: string; amountMinor: number; accountId: string; notes: string }) =>
  `${t.date}|${t.amountMinor}|${t.accountId}|${norm(t.notes)}`;

export function buildRows(
  table: string[][],
  opts: ImportOptions,
  ctx: { accounts: Account[]; categories: Category[]; existing: Pick<Transaction, 'date' | 'amountMinor' | 'accountId' | 'notes'>[] },
): ImportRow[] {
  const seen = new Set(ctx.existing.map(dupKey));
  const body = opts.hasHeader ? table.slice(1) : table;
  const offset = opts.hasHeader ? 2 : 1;
  const cell = (r: string[], f: ImportField) => (opts.map[f] === undefined ? '' : (r[opts.map[f]!] ?? '').trim());
  return body.map((raw, i) => {
    const row: ImportRow = { line: i + offset, status: 'ok', raw };
    const fail = (error: ImportRow['error']): ImportRow => ({ ...row, status: 'error', error });

    const date = parseDate(cell(raw, 'date'), opts.dateFormat);
    if (!date) return fail('date');

    const accName = cell(raw, 'account');
    const account = accName ? findAccount(accName, ctx.accounts) : ctx.accounts.find((a) => a.id === opts.defaultAccountId);
    if (!account) return fail('account');

    const cur = cell(raw, 'currency').toUpperCase();
    if (cur && cur !== account.currency) return fail('currency');

    // amount: strip currency symbols/spaces, keep sign
    const amountText = AR_DIGITS(cell(raw, 'amount')).replace(/[^\d.,٫\-−]/g, '').replace(/−/g, '-');
    const negative = amountText.startsWith('-') || /^\(.*\)$/.test(cell(raw, 'amount'));
    let minor: number;
    try {
      minor = Math.abs(toMinor(amountText.replace(/^-/, '').replace(/,(?=\d{3}\b)/g, ''), account.currency as CurrencyCode));
    } catch {
      return fail('amount');
    }
    if (minor === 0) return fail('amount');

    // type column wins; otherwise the amount's sign decides (negative = expense)
    const typeText = cell(raw, 'type');
    const type = typeText ? parseType(typeText) : negative ? 'expense' : 'income';
    if (!type) return fail('type');

    let toAccountId: string | null = null;
    if (type === 'transfer') {
      const to = findAccount(cell(raw, 'toAccount'), ctx.accounts);
      if (!to) return fail('toAccount');
      if (to.id === account.id) return fail('sameAccount');
      if (to.currency !== account.currency) return fail('currency');
      toAccountId = to.id;
    }

    const kind = type === 'income' ? 'income' : 'expense';
    const cats = ctx.categories.filter((c) => c.kind === kind && !c.isArchived);
    const cat = type === 'transfer' ? undefined : findCategory(cell(raw, 'category'), cats.filter((c) => !c.parentId), null);
    const sub = cat ? findCategory(cell(raw, 'subcategory'), cats, cat.id) : undefined;
    const notes = cell(raw, 'notes');
    const built: ImportRow = {
      ...row, date, type, amountMinor: minor, accountId: account.id, toAccountId,
      categoryId: cat?.id ?? null, subcategoryId: sub?.id ?? null, notes, person: cell(raw, 'person'),
    };
    const key = dupKey({ date, amountMinor: minor, accountId: account.id, notes });
    if (seen.has(key)) return { ...built, status: 'duplicate' };
    seen.add(key); // also catches the same row twice inside one file
    return built;
  });
}
