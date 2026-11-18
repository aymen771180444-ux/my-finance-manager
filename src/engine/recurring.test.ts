import { describe, it, expect } from 'vitest';
import { advance, occurrencesBetween, nextDueDate, daysBefore } from './recurring';

describe('advance', () => {
  it('handles daily/weekly', () => {
    expect(advance('2026-11-17', 'daily', 1)).toBe('2026-11-18');
    expect(advance('2026-11-17', 'weekly', 2)).toBe('2026-12-01');
  });
  it('clamps month-end correctly', () => {
    expect(advance('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(advance('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
    expect(advance('2026-10-31', 'monthly', 1)).toBe('2026-11-30');
  });
  it('handles yearly with Feb 29', () => {
    expect(advance('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
  });
});

describe('occurrencesBetween', () => {
  const rent = { startDate: '2026-09-01', endDate: null, frequency: 'monthly' as const, interval: 1 };
  it('catch-up: all unprocessed occurrences up to today', () => {
    expect(occurrencesBetween(rent, null, '2026-11-17')).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
  });
  it('afterDate is exclusive (already-processed occurrences skipped)', () => {
    expect(occurrencesBetween(rent, '2026-10-01', '2026-11-17')).toEqual(['2026-11-01']);
  });
  it('month-end schedules do not drift after a short month', () => {
    const endOfMonth = { startDate: '2026-01-31', endDate: null, frequency: 'monthly' as const, interval: 1 };
    expect(occurrencesBetween(endOfMonth, null, '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
  });
  it('respects endDate', () => {
    expect(occurrencesBetween({ ...rent, endDate: '2026-10-15' }, null, '2026-12-31')).toEqual(['2026-09-01', '2026-10-01']);
  });
});

describe('nextDueDate / daysBefore', () => {
  it('finds the next due date', () => {
    const rent = { startDate: '2026-09-01', endDate: null, frequency: 'monthly' as const, interval: 1 };
    expect(nextDueDate(rent, '2026-11-17')).toBe('2026-12-01');
    expect(nextDueDate({ ...rent, endDate: '2026-11-30' }, '2026-11-17')).toBeNull();
  });
  it('computes reminder dates', () => {
    expect(daysBefore('2026-12-01', 3)).toBe('2026-11-28');
  });
});
