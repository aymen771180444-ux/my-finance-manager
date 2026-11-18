import { describe, it, expect } from 'vitest';
import {
  toMinor,
  minorToDecimalString,
  convertToBase,
  convertBetween,
  formatMoney,
} from './money';

describe('toMinor', () => {
  it('parses whole YER (exponent 0)', () => {
    expect(toMinor('5000', 'YER')).toBe(5000);
    expect(toMinor(5000, 'YER')).toBe(5000);
  });
  it('parses SAR/USD decimals exactly', () => {
    expect(toMinor('12.50', 'SAR')).toBe(1250);
    expect(toMinor('0.01', 'USD')).toBe(1);
    expect(toMinor('.5', 'USD')).toBe(50);
    expect(toMinor('100', 'USD')).toBe(10000);
  });
  it('parses Arabic-Indic digits and separators', () => {
    expect(toMinor('١٢٣', 'YER')).toBe(123);
    expect(toMinor('١٢٫٥٠', 'SAR')).toBe(1250);
    expect(toMinor('1,250', 'YER')).toBe(1250);
  });
  it('rejects invalid input', () => {
    expect(() => toMinor('abc', 'YER')).toThrow();
    expect(() => toMinor('1.2.3', 'USD')).toThrow();
    expect(() => toMinor('', 'USD')).toThrow();
  });
  it('rejects sub-unit precision', () => {
    expect(() => toMinor('0.001', 'USD')).toThrow();
    expect(() => toMinor('5.5', 'YER')).toThrow();
  });
  it('avoids float error (classic 0.1+0.2 class of bugs)', () => {
    expect(toMinor('0.10', 'USD') + toMinor('0.20', 'USD')).toBe(toMinor('0.30', 'USD'));
    expect(toMinor('19.99', 'USD')).toBe(1999); // 19.99*100 === 1998.9999… in floats
  });
});

describe('minorToDecimalString', () => {
  it('round-trips', () => {
    expect(minorToDecimalString(1250, 'SAR')).toBe('12.50');
    expect(minorToDecimalString(-1250, 'SAR')).toBe('-12.50');
    expect(minorToDecimalString(5000, 'YER')).toBe('5000');
    expect(minorToDecimalString(5, 'USD')).toBe('0.05');
  });
});

describe('conversion', () => {
  it('converts USD -> YER at a stored rate', () => {
    // 1 USD = 533.25 YER; $10.00 -> 5333 YER (rounded)
    expect(convertToBase(1000, 'USD', 533.25)).toBe(5333);
  });
  it('converts SAR -> YER', () => {
    // 1 SAR = 142.1 YER; 50.00 SAR -> 7105 YER
    expect(convertToBase(5000, 'SAR', 142.1)).toBe(7105);
  });
  it('base currency is identity', () => {
    expect(convertToBase(999, 'YER', 1)).toBe(999);
  });
  it('converts between two foreign currencies via base', () => {
    // $100 -> YER (53300) -> SAR at 142.1 => 375.09 SAR
    expect(convertBetween(10000, 'USD', 'SAR', 533, 142.1)).toBe(37509);
  });
  it('rejects invalid rates', () => {
    expect(() => convertToBase(100, 'USD', 0)).toThrow();
    expect(() => convertToBase(100, 'USD', -5)).toThrow();
  });
});

describe('formatMoney', () => {
  it('formats for English', () => {
    expect(formatMoney(1250, 'SAR', 'en')).toContain('12.50');
  });
  it('formats for Arabic with Arabic symbol', () => {
    const s = formatMoney(5000, 'YER', 'ar');
    expect(s).toContain('ر.ي');
  });
});
