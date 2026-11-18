import { describe, it, expect } from 'vitest';
import { periodRange, previousPeriodRange, periodsSince, computeBudgetStatus } from './budgets';

describe('periodRange', () => {
  it('daily is the day itself', () => {
    expect(periodRange('daily', '2026-11-17')).toEqual({ from: '2026-11-17', to: '2026-11-17' });
  });
  it('weekly starts on Saturday', () => {
    // 2026-11-17 is a Tuesday; week = Sat 14 → Fri 20
    expect(periodRange('weekly', '2026-11-17')).toEqual({ from: '2026-11-14', to: '2026-11-20' });
    expect(periodRange('weekly', '2026-11-14')).toEqual({ from: '2026-11-14', to: '2026-11-20' });
    expect(periodRange('weekly', '2026-11-20')).toEqual({ from: '2026-11-14', to: '2026-11-20' });
  });
  it('monthly covers the whole month', () => {
    expect(periodRange('monthly', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('monthly', '2028-02-10').to).toBe('2028-02-29'); // leap year
  });
  it('yearly covers the year', () => {
    expect(periodRange('yearly', '2026-06-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('previous period is adjacent', () => {
    expect(previousPeriodRange('monthly', '2026-11-17')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(previousPeriodRange('weekly', '2026-11-17')).toEqual({ from: '2026-11-07', to: '2026-11-13' });
  });
});

describe('periodsSince', () => {
  it('lists every period from start to the current one', () => {
    const ranges = periodsSince({ period: 'monthly', startDate: '2026-08-15' }, '2026-11-17');
    expect(ranges.map((r) => r.from)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
  });
  it('is empty before the budget starts', () => {
    expect(periodsSince({ period: 'monthly', startDate: '2027-01-01' }, '2026-11-17')).toEqual([]);
  });
});

describe('computeBudgetStatus (acceptance #13, #14)', () => {
  const budget = { period: 'monthly' as const, startDate: '2026-09-01', amountMinor: 100_000, rolloverEnabled: true };
  it('rolls unspent amounts into later months', () => {
    // Sep spent 60k (40k left), Oct spent 80k (20k left) → Nov effective = 100k + 60k
    const spent: Record<string, number> = { '2026-09-01': 60_000, '2026-10-01': 80_000, '2026-11-01': 30_000 };
    const s = computeBudgetStatus(budget, '2026-11-17', (r) => spent[r.from] ?? 0);
    expect(s.rolloverMinor).toBe(60_000);
    expect(s.effectiveLimitMinor).toBe(160_000);
    expect(s.remainingMinor).toBe(130_000);
    expect(s.pct).toBe(19);
    expect(s.crossed).toBeNull();
  });
  it('overspent history never reduces the base limit', () => {
    const spent: Record<string, number> = { '2026-09-01': 150_000, '2026-10-01': 120_000, '2026-11-01': 0 };
    const s = computeBudgetStatus(budget, '2026-11-17', (r) => spent[r.from] ?? 0);
    expect(s.rolloverMinor).toBe(0);
    expect(s.effectiveLimitMinor).toBe(100_000);
  });
  it('no rollover when disabled', () => {
    const s = computeBudgetStatus({ ...budget, rolloverEnabled: false }, '2026-11-17', () => 10_000);
    expect(s.rolloverMinor).toBe(0);
  });
  it('crosses thresholds at 50/75/90/100 and beyond', () => {
    const mk = (spentNow: number) =>
      computeBudgetStatus({ ...budget, rolloverEnabled: false }, '2026-11-17', (r) => (r.from === '2026-11-01' ? spentNow : 0));
    expect(mk(49_000).crossed).toBeNull();
    expect(mk(50_000).crossed).toBe(50);
    expect(mk(80_000).crossed).toBe(75);
    expect(mk(90_000).crossed).toBe(90);
    expect(mk(100_000).crossed).toBe(100);
    expect(mk(130_000).crossed).toBe(100); // over budget is allowed, alert stays at 100
    expect(mk(130_000).remainingMinor).toBe(-30_000);
  });
});
