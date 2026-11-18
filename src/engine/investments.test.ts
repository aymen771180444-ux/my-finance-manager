import { describe, it, expect } from 'vitest';
import { mulDiv, valueOf, toQuantityMicro, quantityToString, replay, performance } from './investments';

let n = 0;
const tx = (kind: 'buy' | 'sell' | 'valuation', q: string, price: number, total: number, date: string) => ({
  id: `i${++n}`,
  kind,
  quantityMicro: q === '0' ? 0 : toQuantityMicro(q),
  priceMinor: price,
  totalMinor: total,
  date,
  createdAt: `2026-01-01T00:00:0${n % 10}Z`,
});

describe('quantity & math helpers', () => {
  it('parses fractional quantities exactly', () => {
    expect(toQuantityMicro('0.5')).toBe(500_000);
    expect(toQuantityMicro('١٢٫٢٥')).toBe(12_250_000);
    expect(quantityToString(12_250_000)).toBe('12.25');
    expect(() => toQuantityMicro('1.1234567')).toThrow();
    expect(() => toQuantityMicro('0')).toThrow();
  });
  it('mulDiv rounds and survives huge products', () => {
    expect(mulDiv(10, 1, 3)).toBe(3);
    expect(mulDiv(20, 1, 3)).toBe(7);
    // 1,000,000 units × 900,000,000 minor price — product exceeds 2^53
    expect(valueOf(1_000_000 * 1_000_000, 900_000_000)).toBe(900_000_000_000_000);
  });
});

describe('average-cost replay (acceptance #11)', () => {
  it('keeps cost basis and market value separate', () => {
    const h = replay([
      tx('buy', '10', 1_000, 10_000, '2026-01-10'), // 10 @ 10.00
      tx('buy', '10', 2_000, 20_000, '2026-02-10'), // 10 @ 20.00 → avg 15.00
      tx('valuation', '0', 3_000, 0, '2026-03-01'), // market now 30.00
    ]);
    expect(h.quantityMicro).toBe(20_000_000);
    expect(h.costBasisMinor).toBe(30_000);
    const p = performance(h);
    expect(p.marketValueMinor).toBe(60_000);
    expect(p.unrealizedMinor).toBe(30_000);
    expect(p.unrealizedPct).toBe(100);
  });
  it('a valuation never changes cost basis', () => {
    const h1 = replay([tx('buy', '5', 1_000, 5_000, '2026-01-10')]);
    const h2 = replay([tx('buy', '5', 1_000, 5_000, '2026-01-10'), tx('valuation', '0', 9_999, 0, '2026-02-01')]);
    expect(h2.costBasisMinor).toBe(h1.costBasisMinor);
  });
  it('sells remove average cost and realize gain', () => {
    const sell = tx('sell', '5', 3_000, 15_000, '2026-03-05');
    const h = replay([
      tx('buy', '10', 1_000, 10_000, '2026-01-10'),
      tx('buy', '10', 2_000, 20_000, '2026-02-10'),
      sell,
    ]);
    expect(h.quantityMicro).toBe(15_000_000);
    expect(h.costBasisMinor).toBe(22_500); // 30,000 − 5×1,500
    expect(h.realizedMinor).toBe(7_500); // 15,000 − 7,500
    expect(h.sells.get(sell.id)).toEqual({ realizedMinor: 7_500, costRemovedMinor: 7_500 });
  });
  it('selling everything clears cost basis exactly (no rounding residue)', () => {
    const h = replay([tx('buy', '3', 333, 1_000, '2026-01-01'), tx('sell', '1', 400, 400, '2026-01-02'), tx('sell', '2', 400, 800, '2026-01-03')]);
    expect(h.quantityMicro).toBe(0);
    expect(h.costBasisMinor).toBe(0);
    expect(h.realizedMinor).toBe(200);
  });
  it('rejects overselling at any point in history', () => {
    expect(() => replay([tx('buy', '1', 100, 100, '2026-01-02'), tx('sell', '2', 100, 200, '2026-01-03')])).toThrow('INSUFFICIENT_QUANTITY');
    // back-dated sell before the buy
    expect(() => replay([tx('sell', '1', 100, 100, '2026-01-01'), tx('buy', '1', 100, 100, '2026-01-02')])).toThrow('INSUFFICIENT_QUANTITY');
  });
  it('replays up to a date for historical net worth', () => {
    const txns = [tx('buy', '10', 1_000, 10_000, '2026-01-10'), tx('valuation', '0', 2_000, 0, '2026-03-01')];
    const jan = replay(txns, '2026-01-31');
    expect(jan.lastPriceMinor).toBe(1_000);
    expect(replay(txns, '2025-12-31').quantityMicro).toBe(0);
  });
  it('no recorded price → market value is unknown, not invented', () => {
    const p = performance({ quantityMicro: 1_000_000, costBasisMinor: 500, realizedMinor: 0, lastPriceMinor: null });
    expect(p.marketValueMinor).toBeNull();
    expect(p.unrealizedMinor).toBeNull();
  });
});
