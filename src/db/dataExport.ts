/**
 * Unencrypted, human-readable export (PRD §24 "Data export"): a ZIP of CSV
 * files (UTF-8 with BOM so Excel shows Arabic correctly) plus attachment files.
 * Amounts are written as exact decimal strings from minor units.
 */

import { db } from './schema';
import { readAttachment } from './attachments';
import { minorToDecimalString, type CurrencyCode } from '../engine/money';
import { quantityToString } from '../engine/investments';

export type ExportSet = 'transactions' | 'accounts' | 'budgets' | 'debts' | 'goals' | 'investments' | 'assets' | 'attachments';
export const EXPORT_SETS: ExportSet[] = ['transactions', 'accounts', 'budgets', 'debts', 'goals', 'investments', 'assets', 'attachments'];

type Cell = string | number | null | undefined;

export function toCsv(header: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

const money = (m: number | null | undefined, c: CurrencyCode) => (m === null || m === undefined ? '' : minorToDecimalString(m, c));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

export async function buildExportZip(profileId: string, sets: ExportSet[]): Promise<Uint8Array<ArrayBuffer>> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const accounts = await db.accounts.toArray();
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const cats = new Map((await db.categories.where('profileId').equals(profileId).toArray()).map((c) => [c.id, `${c.nameEn || c.nameAr}${c.nameAr && c.nameEn ? ` / ${c.nameAr}` : ''}`]));
  const cat = (id: string | null) => (id ? cats.get(id) ?? '' : '');

  if (sets.includes('transactions')) {
    const txns = (await db.transactions.where('profileId').equals(profileId).toArray()).sort((a, b) => a.date.localeCompare(b.date));
    const tagName = new Map((await db.tags.where('profileId').equals(profileId).toArray()).map((t) => [t.id, t.name]));
    const tagsByTxn = new Map<string, string[]>();
    for (const l of await db.transactionTags.where('profileId').equals(profileId).toArray()) {
      tagsByTxn.set(l.transactionId, [...(tagsByTxn.get(l.transactionId) ?? []), tagName.get(l.tagId) ?? '']);
    }
    zip.file('transactions.csv', toCsv(
      ['date', 'type', 'amount', 'currency', 'rate_to_YER', 'amount_YER', 'account', 'to_account', 'category', 'subcategory', 'person', 'notes', 'tags', 'payment_method', 'id'],
      txns.map((t) => [t.date, t.type, money(t.amountMinor, t.currency), t.currency, t.fxRateToBase ?? '', money(t.baseAmountMinor, 'YER'),
        accName.get(t.accountId), t.toAccountId ? accName.get(t.toAccountId) : '', t.hasSplits ? '(split)' : cat(t.categoryId), cat(t.subcategoryId),
        t.person, t.notes, (tagsByTxn.get(t.id) ?? []).join('; '), t.paymentMethod ?? '', t.id]),
    ));
    const splits = await db.splits.toArray();
    const mine = new Set(txns.map((t) => t.id));
    const cur = new Map(txns.map((t) => [t.id, t.currency]));
    zip.file('transaction_splits.csv', toCsv(['transaction_id', 'category', 'amount', 'notes'],
      splits.filter((s) => mine.has(s.transactionId)).map((s) => [s.transactionId, cat(s.categoryId), money(s.amountMinor, cur.get(s.transactionId) ?? 'YER'), s.notes])));
  }
  if (sets.includes('accounts')) {
    zip.file('accounts.csv', toCsv(['name', 'type', 'currency', 'opening_balance', 'current_balance', 'opened', 'status', 'notes', 'id'],
      accounts.filter((a) => a.profileId === profileId || a.sharedWithProfileIds.includes(profileId))
        .map((a) => [a.name, a.type, a.currency, money(a.openingBalanceMinor, a.currency), money(a.currentBalanceMinor, a.currency), a.openedAt.slice(0, 10), a.status, a.notes, a.id])));
  }
  if (sets.includes('budgets')) {
    zip.file('budgets.csv', toCsv(['name', 'category', 'period', 'amount_YER', 'start', 'end', 'rollover', 'alerts', 'archived'],
      (await db.budgets.where('profileId').equals(profileId).toArray()).map((b) => [b.name, b.categoryId ? cat(b.categoryId) : '(overall)', b.period, money(b.amountMinor, 'YER'), b.startDate, b.endDate ?? '', b.rolloverEnabled ? 'yes' : 'no', b.alertsEnabled ? 'yes' : 'no', b.isArchived ? 'yes' : 'no'])));
  }
  if (sets.includes('debts')) {
    const debts = await db.debts.where('profileId').equals(profileId).toArray();
    zip.file('debts.csv', toCsv(['person', 'direction', 'principal', 'remaining', 'currency', 'start', 'due', 'status', 'notes', 'id'],
      debts.map((d) => [d.person, d.direction, money(d.principalMinor, d.currency), money(d.remainingMinor, d.currency), d.currency, d.startDate, d.dueDate ?? '', d.status, d.notes, d.id])));
    const cur = new Map(debts.map((d) => [d.id, d.currency]));
    zip.file('debt_repayments.csv', toCsv(['debt_id', 'date', 'amount', 'notes'],
      (await db.debtRepayments.toArray()).filter((r) => cur.has(r.debtId)).map((r) => [r.debtId, r.date, money(r.amountMinor, cur.get(r.debtId)!), r.notes])));
  }
  if (sets.includes('goals')) {
    const goals = await db.savingsGoals.where('profileId').equals(profileId).toArray();
    zip.file('savings_goals.csv', toCsv(['name', 'target', 'saved', 'currency', 'target_date', 'status', 'id'],
      goals.map((g) => [g.name, money(g.targetMinor, g.currency), money(g.savedMinor, g.currency), g.currency, g.targetDate ?? '', g.status, g.id])));
    const cur = new Map(goals.map((g) => [g.id, g.currency]));
    zip.file('savings_contributions.csv', toCsv(['goal_id', 'date', 'amount', 'notes'],
      (await db.savingsContributions.toArray()).filter((c) => cur.has(c.goalId)).map((c) => [c.goalId, c.date, money(c.amountMinor, cur.get(c.goalId)!), c.notes])));
  }
  if (sets.includes('investments')) {
    const invs = await db.investments.where('profileId').equals(profileId).toArray();
    zip.file('investments.csv', toCsv(['name', 'type', 'unit', 'quantity', 'cost_basis', 'last_price', 'last_price_date', 'realized', 'currency', 'id'],
      invs.map((i) => [i.name, i.type, i.unit, quantityToString(i.quantityMicro), money(i.costBasisMinor, i.currency), money(i.lastPriceMinor, i.currency), i.lastPriceDate ?? '', money(i.realizedMinor, i.currency), i.currency, i.id])));
    const cur = new Map(invs.map((i) => [i.id, i.currency]));
    zip.file('investment_history.csv', toCsv(['investment_id', 'date', 'kind', 'quantity', 'price', 'fees', 'total', 'realized'],
      (await db.investmentTxns.toArray()).filter((x) => cur.has(x.investmentId)).map((x) => {
        const c = cur.get(x.investmentId)!;
        return [x.investmentId, x.date, x.kind, quantityToString(x.quantityMicro), money(x.priceMinor, c), money(x.feesMinor, c), money(x.totalMinor, c), money(x.realizedMinor, c)];
      })));
  }
  if (sets.includes('assets')) {
    zip.file('assets.csv', toCsv(['name', 'kind', 'value', 'currency', 'valued_on', 'quantity', 'status', 'id'],
      (await db.assets.where('profileId').equals(profileId).toArray()).map((a) => [a.name, a.kind, money(a.valueMinor, a.currency), a.currency, a.valuationDate, a.quantityNote, a.status, a.id])));
  }
  if (sets.includes('attachments')) {
    const list = (await db.attachments.where('profileId').equals(profileId).toArray()).filter((a) => !a.deletedAt);
    const used = new Set<string>();
    for (const a of list) {
      let name = `${a.ownerType}-${a.ownerId.slice(0, 8)}-${safeName(a.name)}`;
      while (used.has(name)) name = `_${name}`;
      used.add(name);
      zip.file(`attachments/${name}`, new Uint8Array(await (await readAttachment(a.id)).arrayBuffer()));
    }
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}
