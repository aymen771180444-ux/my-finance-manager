/**
 * Investment engine — pure. Cost basis (what was paid) and market value (what
 * it is worth at the last RECORDED price) are always kept separate
 * (acceptance #11). Average-cost method for sells.
 *
 * Quantities are integer micro-units (QTY_SCALE = 1e6); money is integer minor units.
 */

import { QTY_SCALE, type InvestmentTxn } from '../db/types';

/** round(a × b / c) using BigInt so large quantity × price never loses precision. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new Error('division by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an + ad / 2n) / ad; // round half away from zero
  const r = Number(neg ? -q : q);
  if (!Number.isSafeInteger(r)) throw new Error('amount out of range');
  return r;
}

/** Value of a quantity at a per-unit price (minor units). */
export function valueOf(quantityMicro: number, priceMinor: number): number {
  return mulDiv(quantityMicro, priceMinor, QTY_SCALE);
}

/** Parse a user quantity like "0.5" or "١٢٫٥" into micro-units (max 6 decimals). */
export function toQuantityMicro(input: string): number {
  const s = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/,/g, '');
  if (!/^\d+(\.\d{0,6})?$|^\.\d{1,6}$/.test(s)) throw new Error(`Invalid quantity: ${input}`);
  const [i = '0', f = ''] = s.split('.');
  const v = parseInt(i || '0', 10) * QTY_SCALE + parseInt((f + '000000').slice(0, 6), 10);
  if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`Invalid quantity: ${input}`);
  return v;
}

export function quantityToString(micro: number): string {
  const i = Math.floor(micro / QTY_SCALE);
  const f = String(micro % QTY_SCALE).padStart(6, '0').replace(/0+$/, '');
  return f ? `${i}.${f}` : String(i);
}

export interface Holding {
  quantityMicro: number;
  costBasisMinor: number;
  realizedMinor: number;
  lastPriceMinor: number | null;
  lastPriceDate: string | null;
  /** Per-sell results, keyed by txn id, so the repo can store them. */
  sells: Map<string, { realizedMinor: number; costRemovedMinor: number }>;
}

type ReplayTxn = Pick<InvestmentTxn, 'id' | 'kind' | 'quantityMicro' | 'priceMinor' | 'totalMinor' | 'date' | 'createdAt'>;

function chronological(txns: ReplayTxn[]): ReplayTxn[] {
  return [...txns].sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
}

/**
 * Replay history (optionally up to `asOf` inclusive). Throws
 * INSUFFICIENT_QUANTITY if any sell exceeds the holding at that point.
 */
export function replay(txns: ReplayTxn[], asOf?: string): Holding {
  const h: Holding = { quantityMicro: 0, costBasisMinor: 0, realizedMinor: 0, lastPriceMinor: null, lastPriceDate: null, sells: new Map() };
  for (const t of chronological(txns)) {
    if (asOf && t.date > asOf) break;
    if (t.kind === 'buy') {
      h.quantityMicro += t.quantityMicro;
      h.costBasisMinor += t.totalMinor;
    } else if (t.kind === 'sell') {
      if (t.quantityMicro > h.quantityMicro) throw new Error('INSUFFICIENT_QUANTITY');
      const costRemoved =
        t.quantityMicro === h.quantityMicro ? h.costBasisMinor : mulDiv(h.costBasisMinor, t.quantityMicro, h.quantityMicro);
      h.costBasisMinor -= costRemoved;
      h.quantityMicro -= t.quantityMicro;
      const realized = t.totalMinor - costRemoved;
      h.realizedMinor += realized;
      h.sells.set(t.id, { realizedMinor: realized, costRemovedMinor: costRemoved });
    }
    // every buy, sell and manual valuation is a recorded market price
    if (t.priceMinor > 0) {
      h.lastPriceMinor = t.priceMinor;
      h.lastPriceDate = t.date;
    }
  }
  return h;
}

export interface Performance {
  costBasisMinor: number;
  /** null when no price has ever been recorded. */
  marketValueMinor: number | null;
  /** market value − cost basis; null without a price. */
  unrealizedMinor: number | null;
  unrealizedPct: number | null;
  realizedMinor: number;
}

export function performance(h: Pick<Holding, 'quantityMicro' | 'costBasisMinor' | 'realizedMinor' | 'lastPriceMinor'>): Performance {
  const mv = h.lastPriceMinor === null ? null : valueOf(h.quantityMicro, h.lastPriceMinor);
  const un = mv === null ? null : mv - h.costBasisMinor;
  return {
    costBasisMinor: h.costBasisMinor,
    marketValueMinor: mv,
    unrealizedMinor: un,
    unrealizedPct: un === null || h.costBasisMinor === 0 ? null : Math.round((un / h.costBasisMinor) * 1000) / 10,
    realizedMinor: h.realizedMinor,
  };
}
