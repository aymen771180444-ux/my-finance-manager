/**
 * Money module — ALL financial amounts in the app are integers in "minor units"
 * (e.g. 12.50 SAR -> 1250). No floating point arithmetic is ever used on money.
 */

export type CurrencyCode = 'YER' | 'SAR' | 'USD';

export interface CurrencyInfo {
  code: CurrencyCode;
  exponent: number; // decimal places
  symbolEn: string;
  symbolAr: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  YER: { code: 'YER', exponent: 0, symbolEn: 'YER', symbolAr: 'ر.ي' },
  SAR: { code: 'SAR', exponent: 2, symbolEn: 'SAR', symbolAr: 'ر.س' },
  USD: { code: 'USD', exponent: 2, symbolEn: '$', symbolAr: '$' },
};

export const BASE_CURRENCY: CurrencyCode = 'YER';

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** 10^exponent as integer */
function pow10(n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= 10;
  return r;
}

/**
 * Parse a user-entered decimal string (or number) into minor units.
 * Parsing is string-based to avoid float error. Accepts Arabic-Indic digits.
 * Throws on invalid input or too many decimal places.
 */
export function toMinor(value: string | number, currency: CurrencyCode): number {
  const exp = CURRENCIES[currency].exponent;
  let s = String(value).trim();
  // normalize Arabic-Indic digits and separators
  s = s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٬,]/g, '')
    .replace(/٫/g, '.');
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(s)) {
    throw new Error(`Invalid amount: ${value}`);
  }
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const [intPart = '0', fracRaw = ''] = s.split('.');
  if (fracRaw.length > exp) {
    // reject precision beyond the currency's smallest unit
    if (/[1-9]/.test(fracRaw.slice(exp))) {
      throw new Error(`Too many decimal places for ${currency}: ${value}`);
    }
  }
  const frac = fracRaw.slice(0, exp).padEnd(exp, '0');
  const minor = parseInt(intPart || '0', 10) * pow10(exp) + (exp > 0 ? parseInt(frac || '0', 10) : 0);
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${value}`);
  return negative ? -minor : minor;
}

/** Minor units -> decimal string, e.g. 1250 SAR -> "12.50" */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  const exp = CURRENCIES[currency].exponent;
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const p = pow10(exp);
  const intPart = Math.floor(abs / p);
  const frac = abs % p;
  const s = exp > 0 ? `${intPart}.${String(frac).padStart(exp, '0')}` : String(intPart);
  return neg ? `-${s}` : s;
}

/** Locale-aware display formatting (grouping etc.) — display only, never parsed back. */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  locale: string,
  opts: { withSymbol?: boolean; signDisplay?: 'auto' | 'always' | 'never' } = {},
): string {
  const { withSymbol = true, signDisplay = 'auto' } = opts;
  const exp = CURRENCIES[currency].exponent;
  const value = minor / pow10(exp); // display only
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
    signDisplay,
  });
  const num = nf.format(value);
  if (!withSymbol) return num;
  const symbol = locale.startsWith('ar') ? CURRENCIES[currency].symbolAr : CURRENCIES[currency].symbolEn;
  return locale.startsWith('ar') ? `${num} ${symbol}` : `${symbol === '$' ? '$' + num : num + ' ' + symbol}`;
}

/**
 * Convert minor units between currencies using an explicit rate.
 * `rateToBase` of a currency = how many BASE currency major-units equal 1 major-unit of that currency.
 * (e.g. USD rateToBase = 533 means 1 USD = 533 YER). Base currency rateToBase = 1.
 *
 * Math is done via scaled integers: the rate is expressed with up to 6 decimal
 * places, converted to an integer numerator, so no float multiplication of money.
 */
export const RATE_SCALE = 1_000_000;

export function rateToScaled(rate: number): number {
  const scaled = Math.round(rate * RATE_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error(`Invalid exchange rate: ${rate}`);
  return scaled;
}

/** Convert amount in `from` currency minor units to BASE currency minor units. */
export function convertToBase(minor: number, from: CurrencyCode, rateToBase: number): number {
  if (from === BASE_CURRENCY) return minor;
  const scaled = rateToScaled(rateToBase);
  const fromExp = CURRENCIES[from].exponent;
  const baseExp = CURRENCIES[BASE_CURRENCY].exponent;
  // major value of amount = minor / 10^fromExp
  // base minor = major * rate * 10^baseExp
  //            = minor * scaledRate * 10^baseExp / (RATE_SCALE * 10^fromExp)
  const numerator = minor * scaled * pow10(baseExp);
  const denominator = RATE_SCALE * pow10(fromExp);
  const result = Math.round(numerator / denominator);
  if (!Number.isSafeInteger(result)) throw new Error('Converted amount out of range');
  return result;
}

/** Convert between any two currencies given each currency's rate to base. */
export function convertBetween(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  fromRateToBase: number,
  toRateToBase: number,
): number {
  if (from === to) return minor;
  const baseMinor = convertToBase(minor, from, fromRateToBase);
  if (to === BASE_CURRENCY) return baseMinor;
  // base minor -> to minor: inverse of convertToBase for `to`
  const scaled = rateToScaled(toRateToBase);
  const toExp = CURRENCIES[to].exponent;
  const baseExp = CURRENCIES[BASE_CURRENCY].exponent;
  const numerator = baseMinor * RATE_SCALE * pow10(toExp);
  const denominator = scaled * pow10(baseExp);
  const result = Math.round(numerator / denominator);
  if (!Number.isSafeInteger(result)) throw new Error('Converted amount out of range');
  return result;
}
