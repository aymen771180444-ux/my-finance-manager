import { describe, it, expect } from 'vitest';
import { evaluate, pctOf, whatPct, pctChangeOf, discount, installmentPlan, monthsToTarget } from './calc';

describe('evaluate', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('10/4')).toBe(2.5);
    expect(evaluate('-3+5')).toBe(2);
    expect(evaluate('2*-3')).toBe(-6);
  });
  it('supports percent, Arabic digits and symbols', () => {
    expect(evaluate('200*15%')).toBe(30);
    expect(evaluate('٢٠٠ × ٣')).toBe(600);
    expect(evaluate('١٠ ÷ ٤')).toBe(2.5);
    expect(evaluate('1,000+1')).toBe(1001);
  });
  it('trims float noise', () => {
    expect(evaluate('0.1+0.2')).toBe(0.3);
  });
  it('rejects invalid and unsafe input', () => {
    expect(() => evaluate('2+')).toThrow();
    expect(() => evaluate('alert(1)')).toThrow();
    expect(() => evaluate('1/0')).toThrow();
    expect(() => evaluate('(1+2')).toThrow();
    expect(() => evaluate('1..2')).toThrow();
  });
});

describe('helpers', () => {
  it('percentages', () => {
    expect(pctOf(15, 200)).toBe(30);
    expect(whatPct(50, 200)).toBe(25);
    expect(whatPct(1, 0)).toBeNull();
    expect(pctChangeOf(100, 125)).toBe(25);
  });
  it('discount', () => {
    expect(discount(1000, 20)).toEqual({ final: 800, saving: 200 });
  });
  it('installments reconcile exactly to the total', () => {
    const p = installmentPlan(100_000, 3)!;
    expect(p.perMonthMinor * 2 + p.lastMinor).toBe(100_000);
    expect(installmentPlan(0, 3)).toBeNull();
  });
  it('months to target', () => {
    expect(monthsToTarget(100_000, 30_000)).toBe(4);
    expect(monthsToTarget(100_000, 0)).toBeNull();
  });
});
