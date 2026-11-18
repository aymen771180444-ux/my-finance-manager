import { db, newId, nowISO } from './schema';
import { BASE_CURRENCY, type CurrencyCode } from '../engine/money';
import type { ExchangeRate } from './types';

/**
 * The rate effective on a given date: the most recent stored rate whose date
 * is on or before that date. Returns null when no usable rate exists — the
 * caller must surface "cannot convert", NEVER invent a rate.
 */
export async function getRateForDate(currency: CurrencyCode, date: string): Promise<number | null> {
  if (currency === BASE_CURRENCY) return 1;
  const rows = await db.exchangeRates.where('currency').equals(currency).toArray();
  const usable = rows.filter((r) => r.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (usable.length > 0) return usable[0].rateToBase;
  return null;
}

export async function getLatestRate(currency: CurrencyCode): Promise<ExchangeRate | null> {
  if (currency === BASE_CURRENCY) return null;
  const rows = await db.exchangeRates.where('currency').equals(currency).toArray();
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows[0] ?? null;
}

/** Add a dated rate (manual entry or future auto-update). History is append-only. */
export async function addRate(opts: {
  currency: CurrencyCode;
  rateToBase: number;
  date: string;
  source?: 'manual' | 'auto';
}): Promise<ExchangeRate> {
  if (opts.currency === BASE_CURRENCY) throw new Error('Base currency rate is always 1');
  if (!(opts.rateToBase > 0)) throw new Error('Rate must be positive');
  const ts = nowISO();
  const row: ExchangeRate = {
    id: newId(),
    createdAt: ts,
    updatedAt: ts,
    currency: opts.currency,
    rateToBase: opts.rateToBase,
    date: opts.date,
    source: opts.source ?? 'manual',
  };
  await db.exchangeRates.add(row);
  return row;
}

/** Correct a stored historical rate in place (PRD allows manual correction). */
export async function correctRate(id: string, rateToBase: number): Promise<void> {
  if (!(rateToBase > 0)) throw new Error('Rate must be positive');
  await db.exchangeRates.update(id, { rateToBase, updatedAt: nowISO() });
}

export async function deleteRate(id: string): Promise<void> {
  await db.exchangeRates.delete(id);
}

export async function listRates(currency?: CurrencyCode): Promise<ExchangeRate[]> {
  const rows = currency
    ? await db.exchangeRates.where('currency').equals(currency).toArray()
    : await db.exchangeRates.toArray();
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}
