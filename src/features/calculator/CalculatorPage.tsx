import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Delete } from 'lucide-react';
import { Card, Field, TextInput, Select, Segmented } from '../../components/ui';
import { evaluate, pctOf, whatPct, pctChangeOf, discount, installmentPlan, monthsToTarget } from '../../engine/calc';
import { convertBetween, formatMoney, toMinor, CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { db } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';

type Tab = 'basic' | 'percent' | 'discount' | 'currency' | 'financial';

function num(s: string): number | null {
  if (!s.trim()) return null;
  try {
    return evaluate(s);
  } catch {
    return null;
  }
}

export default function CalculatorPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('basic');
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('calculator.title')}</h1>
      </div>
      <div className="mb-3 overflow-x-auto">
        <div className="min-w-[440px]">
          <Segmented
            options={(['basic', 'percent', 'discount', 'currency', 'financial'] as const).map((v) => ({ value: v, label: t(`calculator.${v}`) }))}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>
      {tab === 'basic' && <Basic />}
      {tab === 'percent' && <Percent />}
      {tab === 'discount' && <Discount />}
      {tab === 'currency' && <CurrencyConv />}
      {tab === 'financial' && <Financial />}
    </div>
  );
}

const toWesternDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/٫/g, '.');

const nf = (lang: string, v: number, max = 2) => new Intl.NumberFormat(lang, { maximumFractionDigits: max }).format(v);

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between rounded-2xl bg-primary-soft px-3 py-2.5">
      <span className="text-sm text-primary">{label}</span>
      <span className="text-lg font-bold text-primary" dir="ltr">{value}</span>
    </div>
  );
}

function Basic() {
  const { t, i18n } = useTranslation();
  const [expr, setExpr] = useState('');
  let result: string;
  try {
    result = expr.trim() ? nf(i18n.language, evaluate(expr), 10) : '0';
  } catch {
    result = t('calculator.invalid');
  }
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '-', '0', '.', '%', '+', '(', ')', 'C', '⌫'];
  const press = (k: string) => {
    if (k === 'C') setExpr('');
    else if (k === '⌫') setExpr(expr.slice(0, -1));
    else setExpr(expr + k);
  };
  return (
    <Card className="p-4">
      {/* Arabic-Indic digits are bidi class AN, which reorders "١٥٠٠٠ × ١٥" for display; show Western digits */}
      <TextInput dir="ltr" className="mb-2 text-end text-lg" value={expr} onChange={(e) => setExpr(toWesternDigits(e.target.value))} placeholder="0" aria-label={t('calculator.expression')} />
      <p className="mb-3 text-end text-3xl font-bold" dir="ltr">{result}</p>
      <div className="grid grid-cols-4 gap-2" dir="ltr">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            className={`h-12 rounded-2xl text-lg font-semibold active:opacity-70 ${/[0-9.]/.test(k) ? 'bg-surface-2' : k === 'C' ? 'bg-expense-soft text-expense' : 'bg-primary-soft text-primary'}`}
          >
            {k === '⌫' ? <Delete size={18} className="mx-auto" /> : k}
          </button>
        ))}
      </div>
    </Card>
  );
}

function Percent() {
  const { t, i18n } = useTranslation();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const A = num(a);
  const B = num(b);
  const fmt = (v: number | null, suffix = '') => (v === null ? '—' : nf(i18n.language, v) + suffix);
  return (
    <Card className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calculator.a')}><TextInput dir="ltr" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label={t('calculator.b')}><TextInput dir="ltr" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      </div>
      <Result label={t('calculator.pctOf', { a: a || 'A', b: b || 'B' })} value={fmt(A !== null && B !== null ? pctOf(A, B) : null)} />
      <Result label={t('calculator.whatPct', { a: a || 'A', b: b || 'B' })} value={fmt(A !== null && B !== null ? whatPct(A, B) : null, '%')} />
      <Result label={t('calculator.change')} value={fmt(A !== null && B !== null ? pctChangeOf(A, B) : null, '%')} />
    </Card>
  );
}

function Discount() {
  const { t, i18n } = useTranslation();
  const [price, setPrice] = useState('');
  const [pct, setPct] = useState('');
  const P = num(price);
  const D = num(pct);
  const r = P !== null && D !== null ? discount(P, D) : null;
  return (
    <Card className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calculator.price')}><TextInput dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={t('calculator.discountPct')}><TextInput dir="ltr" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
      </div>
      <Result label={t('calculator.finalPrice')} value={r ? nf(i18n.language, r.final) : '—'} />
      <Result label={t('calculator.youSave')} value={r ? nf(i18n.language, r.saving) : '—'} />
    </Card>
  );
}

function CurrencyConv() {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState<CurrencyCode>('USD');
  const [to, setTo] = useState<CurrencyCode>('YER');
  const latest = useLiveQuery(async () => {
    const rows = await db.exchangeRates.toArray();
    rows.sort((x, y) => x.date.localeCompare(y.date));
    const m = new Map<string, { rate: number; date: string }>();
    for (const r of rows) m.set(r.currency, { rate: r.rateToBase, date: r.date });
    return m;
  }, []);
  const rateOf = (c: CurrencyCode) => (c === 'YER' ? { rate: 1, date: '' } : latest?.get(c));
  const fr = rateOf(from);
  const tr = rateOf(to);
  const missing = [from, to].filter((c) => !rateOf(c));
  const result = useMemo(() => {
    if (!amount || !fr || !tr) return null;
    try {
      return convertBetween(toMinor(amount, from), from, to, fr.rate, tr.rate);
    } catch {
      return null;
    }
  }, [amount, from, to, fr, tr]);
  return (
    <Card className="space-y-3 p-4">
      <Field label={t('common.amount')}><TextInput dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('calculator.from')}>
          <Select value={from} onChange={(e) => setFrom(e.target.value as CurrencyCode)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Field label={t('calculator.to')}>
          <Select value={to} onChange={(e) => setTo(e.target.value as CurrencyCode)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
      </div>
      {missing.length > 0 ? (
        <p className="rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{t('calculator.noRate', { currency: missing.join(', ') })}</p>
      ) : (
        <>
          <Result label={t('calculator.result')} value={result === null ? '—' : formatMoney(result, to, i18n.language)} />
          {[from, to].filter((c) => c !== 'YER').map((c) => {
            const r = rateOf(c)!;
            return (
              <p key={c} className="text-xs text-ink-dim">
                {t('calculator.rateUsed', { rate: `1 ${c} = ${r.rate} YER`, date: formatDate(r.date, i18n.language, calendar) })}
              </p>
            );
          })}
        </>
      )}
    </Card>
  );
}

function Financial() {
  const { t, i18n } = useTranslation();
  const [total, setTotal] = useState('');
  const [months, setMonths] = useState('');
  const [target, setTarget] = useState('');
  const [perMonth, setPerMonth] = useState('');
  const fmt = (m: number) => formatMoney(m, 'YER', i18n.language);
  let plan: ReturnType<typeof installmentPlan> = null;
  let needed: number | null = null;
  try {
    plan = total && months ? installmentPlan(toMinor(total, 'YER'), parseInt(months, 10)) : null;
  } catch {
    plan = null;
  }
  try {
    needed = target && perMonth ? monthsToTarget(toMinor(target, 'YER'), toMinor(perMonth, 'YER')) : null;
  } catch {
    needed = null;
  }
  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('calculator.installment')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('calculator.principal')} (YER)`}><TextInput dir="ltr" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
          <Field label={t('calculator.months')}><TextInput dir="ltr" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
        </div>
        <Result label={t('calculator.monthly')} value={plan ? (plan.lastMinor === plan.perMonthMinor ? fmt(plan.perMonthMinor) : `${fmt(plan.perMonthMinor)} … ${fmt(plan.lastMinor)}`) : '—'} />
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('calculator.savingsPlan')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('calculator.target')} (YER)`}><TextInput dir="ltr" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label={`${t('calculator.perMonth')} (YER)`}><TextInput dir="ltr" inputMode="decimal" value={perMonth} onChange={(e) => setPerMonth(e.target.value)} /></Field>
        </div>
        <Result label={t('calculator.monthsNeeded')} value={needed === null ? '—' : nf(i18n.language, needed, 0)} />
      </Card>
    </div>
  );
}
