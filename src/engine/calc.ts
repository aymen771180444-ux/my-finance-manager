/**
 * Safe arithmetic evaluator for the calculator (no eval / Function).
 * Grammar:  expr := term (('+'|'-') term)*
 *           term := factor (('*'|'/') factor)*
 *           factor := ('+'|'-') factor | number '%'? | '(' expr ')' '%'?
 * A trailing % divides by 100. Accepts Arabic-Indic digits, × ÷ − and ٫ as decimal point.
 */

export function normalizeExpression(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬,]/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '');
}

export function evaluate(input: string): number {
  const s = normalizeExpression(input);
  if (!s) throw new Error('empty');
  let i = 0;
  const peek = () => s[i];
  const eat = (c: string) => {
    if (s[i] === c) {
      i++;
      return true;
    }
    return false;
  };
  function number(): number {
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const text = s.slice(start, i);
    if (!text || (text.match(/\./g) ?? []).length > 1) throw new Error('bad number');
    return parseFloat(text);
  }
  function factor(): number {
    if (eat('+')) return factor();
    if (eat('-')) return -factor();
    let v: number;
    if (eat('(')) {
      v = expr();
      if (!eat(')')) throw new Error('missing )');
    } else {
      v = number();
    }
    if (eat('%')) v = v / 100;
    return v;
  }
  function term(): number {
    let v = factor();
    for (;;) {
      if (eat('*')) v *= factor();
      else if (eat('/')) {
        const d = factor();
        if (d === 0) throw new Error('division by zero');
        v /= d;
      } else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }
  const result = expr();
  if (i !== s.length || peek() !== undefined) throw new Error('unexpected input');
  if (!Number.isFinite(result)) throw new Error('not finite');
  // trim float noise for display (calculator utility, not ledger math)
  return Math.round(result * 1e10) / 1e10;
}

export const pctOf = (pct: number, base: number) => (pct / 100) * base;
export const whatPct = (part: number, whole: number) => (whole === 0 ? null : (part / whole) * 100);
export const pctChangeOf = (from: number, to: number) => (from === 0 ? null : ((to - from) / Math.abs(from)) * 100);
export function discount(price: number, pct: number) {
  const saving = (price * pct) / 100;
  return { final: price - saving, saving };
}
/** Interest-free installments: per-month payment, last payment absorbs remainder. Works in minor units. */
export function installmentPlan(totalMinor: number, months: number): { perMonthMinor: number; lastMinor: number } | null {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0 || !Number.isInteger(months) || months <= 0) return null;
  const per = Math.floor(totalMinor / months);
  return { perMonthMinor: per, lastMinor: totalMinor - per * (months - 1) };
}
export function monthsToTarget(targetMinor: number, perMonthMinor: number): number | null {
  if (targetMinor <= 0 || perMonthMinor <= 0) return null;
  return Math.ceil(targetMinor / perMonthMinor);
}
