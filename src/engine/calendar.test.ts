import { describe, it, expect } from 'vitest';
import { hijriParts, monthGrid, installmentDates } from './calendar';

describe('Gregorian month grid', () => {
  it('covers the whole month with Saturday-first blanks', () => {
    const g = monthGrid('2026-11-17', 'gregorian');
    expect(g.days[0]).toBe('2026-11-01');
    expect(g.days).toHaveLength(30);
    expect(g.leadingBlanks).toBe(1); // Nov 1 2026 is a Sunday
    expect(g.prevAnchor).toBe('2026-10-31');
    expect(g.nextAnchor).toBe('2026-12-01');
  });
});

describe('Hijri month grid (Umm al-Qura)', () => {
  it('starts on the 1st of the Hijri month and spans 29–30 days', () => {
    const g = monthGrid('2026-11-17', 'hijri');
    expect(hijriParts(g.days[0]).day).toBe(1);
    expect(g.days.length === 29 || g.days.length === 30).toBe(true);
    const month = hijriParts(g.days[0]).month;
    expect(g.days.every((d) => hijriParts(d).month === month)).toBe(true);
    expect(hijriParts(g.nextAnchor).day).toBe(1);
  });
  it('navigation moves to adjacent Hijri months', () => {
    const g = monthGrid('2026-11-17', 'hijri');
    const prev = monthGrid(g.prevAnchor, 'hijri');
    expect(prev.days[prev.days.length - 1] < g.days[0]).toBe(true);
    const h1 = hijriParts(g.days[0]).month;
    const h0 = hijriParts(prev.days[0]).month;
    expect(h0 === h1 - 1 || (h1 === 1 && h0 === 12)).toBe(true);
  });
});

describe('installment schedule', () => {
  it('generates enough installments to cover the principal', () => {
    const dates = installmentDates({ startDate: '2026-01-31', principalMinor: 100_000, installmentMinor: 30_000, installmentPeriod: 'monthly' });
    expect(dates).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  it('none without a plan', () => {
    expect(installmentDates({ startDate: '2026-01-01', principalMinor: 100, installmentMinor: null, installmentPeriod: null })).toEqual([]);
  });
});
