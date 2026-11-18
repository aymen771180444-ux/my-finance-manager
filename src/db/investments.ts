import { db, newId, nowISO } from './schema';
import type { Investment, InvestmentTxn, InvestmentType } from './types';
import type { CurrencyCode } from '../engine/money';
import { valueOf } from '../engine/investments';
import { recordMutation } from './audit';
import { createTransaction, deleteTransaction, TXN_TABLES } from './transactions';
import { recomputeInvestment } from './investmentCache';

const SCOPE = () => [...TXN_TABLES];

export interface TradeInput {
  quantityMicro: number;
  /** Price per unit, minor units of the investment currency. */
  priceMinor: number;
  feesMinor?: number;
  date: string;
  /** Account the money moves through (must match the investment currency). Optional. */
  accountId?: string | null;
  notes?: string;
}

export interface InvestmentInput {
  profileId: string;
  name: string;
  type: InvestmentType;
  currency: CurrencyCode;
  unit?: string;
  notes?: string;
  initialBuy?: TradeInput | null;
}

function validateTrade(t: TradeInput) {
  if (!Number.isSafeInteger(t.quantityMicro) || t.quantityMicro <= 0) throw new Error('Quantity must be positive');
  if (!Number.isSafeInteger(t.priceMinor) || t.priceMinor < 0) throw new Error('Price must be zero or positive');
  if (t.feesMinor !== undefined && (!Number.isSafeInteger(t.feesMinor) || t.feesMinor < 0)) throw new Error('Fees must be zero or positive');
}

async function addTrade(inv: Investment, kind: 'buy' | 'sell', t: TradeInput): Promise<InvestmentTxn> {
  validateTrade(t);
  const gross = valueOf(t.quantityMicro, t.priceMinor);
  const fees = t.feesMinor ?? 0;
  // buys cost gross + fees; sells yield gross − fees
  const total = kind === 'buy' ? gross + fees : gross - fees;
  if (total < 0) throw new Error('Fees exceed sale proceeds');
  let txnId: string | null = null;
  if (t.accountId && total > 0) {
    const account = await db.accounts.get(t.accountId);
    if (!account) throw new Error('Account not found');
    if (account.currency !== inv.currency) throw new Error('INVESTMENT_ACCOUNT_CURRENCY_MISMATCH');
    const txn = await createTransaction({
      profileId: inv.profileId,
      type: kind === 'buy' ? 'investment_buy' : 'investment_sell',
      amountMinor: total,
      accountId: t.accountId,
      date: t.date,
      notes: t.notes ? `${inv.name} — ${t.notes}` : inv.name,
      investmentId: inv.id,
    });
    txnId = txn.id;
  }
  const ts = nowISO();
  const row: InvestmentTxn = {
    id: newId(),
    createdAt: ts,
    updatedAt: ts,
    profileId: inv.profileId,
    investmentId: inv.id,
    kind,
    quantityMicro: t.quantityMicro,
    priceMinor: t.priceMinor,
    totalMinor: total,
    feesMinor: fees,
    realizedMinor: 0,
    costRemovedMinor: 0,
    date: t.date,
    txnId,
    notes: t.notes ?? '',
  };
  await db.investmentTxns.add(row);
  await recomputeInvestment(inv.id); // throws INSUFFICIENT_QUANTITY → whole operation rolls back
  return row;
}

export async function createInvestment(input: InvestmentInput): Promise<Investment> {
  if (!input.name.trim()) throw new Error('Name is required');
  return db.transaction('rw', SCOPE(), async () => {
    const ts = nowISO();
    const inv: Investment = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: input.profileId,
      name: input.name.trim(),
      type: input.type,
      currency: input.currency,
      unit: input.unit ?? '',
      quantityMicro: 0,
      costBasisMinor: 0,
      realizedMinor: 0,
      lastPriceMinor: null,
      lastPriceDate: null,
      notes: input.notes ?? '',
      status: 'active',
    };
    await db.investments.add(inv);
    if (input.initialBuy) await addTrade(inv, 'buy', input.initialBuy);
    const saved = (await db.investments.get(inv.id))!;
    await recordMutation({ profileId: inv.profileId, table: 'investments', rowId: inv.id, action: 'create', before: null, after: saved });
    return saved;
  });
}

async function trade(investmentId: string, kind: 'buy' | 'sell', t: TradeInput): Promise<Investment> {
  return db.transaction('rw', SCOPE(), async () => {
    const before = await db.investments.get(investmentId);
    if (!before) throw new Error('Investment not found');
    await addTrade(before, kind, t);
    const after = (await db.investments.get(investmentId))!;
    await recordMutation({ profileId: before.profileId, table: 'investments', rowId: investmentId, action: 'update', before, after });
    return after;
  });
}

export const buyInvestment = (id: string, t: TradeInput) => trade(id, 'buy', t);
export const sellInvestment = (id: string, t: TradeInput) => trade(id, 'sell', t);

/** Record a market price observed on a date. Never changes cost basis. */
export async function recordValuation(investmentId: string, priceMinor: number, date: string, notes = ''): Promise<Investment> {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw new Error('Price must be zero or positive');
  return db.transaction('rw', SCOPE(), async () => {
    const before = await db.investments.get(investmentId);
    if (!before) throw new Error('Investment not found');
    const ts = nowISO();
    await db.investmentTxns.add({
      id: newId(), createdAt: ts, updatedAt: ts, profileId: before.profileId, investmentId, kind: 'valuation',
      quantityMicro: 0, priceMinor, totalMinor: 0, feesMinor: 0, realizedMinor: 0, costRemovedMinor: 0, date, txnId: null, notes,
    });
    await recomputeInvestment(investmentId);
    const after = (await db.investments.get(investmentId))!;
    await recordMutation({ profileId: before.profileId, table: 'investments', rowId: investmentId, action: 'update', before, after });
    return after;
  });
}

/** Remove one history entry (reversing its account transaction when there is one). */
export async function deleteInvestmentTxn(id: string): Promise<void> {
  const row = await db.investmentTxns.get(id);
  if (!row) return;
  if (row.txnId) {
    await deleteTransaction(row.txnId); // detaches + recomputes; refuses on history conflicts
    return;
  }
  await db.transaction('rw', SCOPE(), async () => {
    await db.investmentTxns.delete(id);
    try {
      await recomputeInvestment(row.investmentId);
    } catch {
      throw new Error('INVESTMENT_HISTORY_CONFLICT');
    }
  });
}

/**
 * Delete an investment. Its account transactions are deleted (money returns to
 * the accounts, each lands in Trash); the investment and its remaining history
 * go to Trash together.
 */
export async function deleteInvestment(id: string): Promise<void> {
  const inv = await db.investments.get(id);
  if (!inv) throw new Error('Investment not found');
  await db.transaction('rw', SCOPE(), async () => {
    const snapshot = (await db.investments.get(id))!;
    const history = await db.investmentTxns.where('investmentId').equals(id).toArray();
    // reverse the account movements; the investment history itself travels to
    // Trash intact, so restoring the investment + its transactions is exact
    for (const r of history) if (r.txnId) await deleteTransaction(r.txnId, inv.name, { keepInvestmentRow: true });
    await db.investmentTxns.where('investmentId').equals(id).delete();
    await db.investments.delete(id);
    const ts = nowISO();
    await db.trash.add({
      id: newId(), createdAt: ts, updatedAt: ts, profileId: inv.profileId, table: 'investments', rowId: id,
      payload: JSON.stringify({ investment: snapshot, history }), label: inv.name, deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: inv.profileId, table: 'investments', rowId: id, action: 'delete', before: snapshot, after: null });
  });
}

export async function restoreInvestment(trashId: string): Promise<void> {
  return db.transaction('rw', SCOPE(), async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'investments') throw new Error('Trash entry not found');
    const { investment, history } = JSON.parse(entry.payload) as { investment: Investment; history: InvestmentTxn[] };
    await db.investments.add(investment);
    for (const h of history) await db.investmentTxns.add(h);
    await recomputeInvestment(investment.id);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: investment.profileId, table: 'investments', rowId: investment.id, action: 'restore', before: null, after: investment });
  });
}

export async function updateInvestment(id: string, changes: Partial<Pick<Investment, 'name' | 'unit' | 'notes' | 'type'>>): Promise<void> {
  return db.transaction('rw', [db.investments, db.auditLog, db.syncQueue], async () => {
    const before = await db.investments.get(id);
    if (!before) throw new Error('Investment not found');
    const after = { ...before, ...changes, updatedAt: nowISO() };
    await db.investments.put(after);
    await recordMutation({ profileId: before.profileId, table: 'investments', rowId: id, action: 'update', before, after });
  });
}
