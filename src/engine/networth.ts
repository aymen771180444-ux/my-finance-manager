/**
 * Net worth = total assets − total liabilities (PRD §13).
 *
 * De-duplication rules (acceptance #10):
 *  - Savings goals are NOT added: a goal's money already sits in an account
 *    balance (or is just a target), so counting it again would double it.
 *  - Accounts shared into a profile are counted once (dedup by id).
 *  - Positive account balances are assets; negative balances (credit cards,
 *    overdrafts) are liabilities.
 *  - Open debts owed to me are receivables (assets); debts I owe are liabilities.
 *  - Investments count at MARKET value (last recorded price), never cost basis.
 *    The cash spent buying them already left the accounts, so nothing doubles.
 * Foreign-currency items without a rate are reported in `unconverted` and
 * excluded — never estimated.
 */

import type {
  Account, Debt, Investment, Asset, Transaction, DebtRepayment, InvestmentTxn, AssetValuation, ExchangeRate,
} from '../db/types';
import { convertToBase, BASE_CURRENCY, type CurrencyCode } from './money';
import { compilePostings } from './posting';
import { replay, valueOf } from './investments';

export interface NetWorthItem {
  kind: 'account' | 'debt' | 'investment' | 'asset';
  id: string;
  label: string;
  currency: CurrencyCode;
  amountMinor: number; // positive, original currency
  baseMinor: number; // positive, YER
  /** For investments/assets: the date of the value used. */
  asOf?: string | null;
}

export interface NetWorth {
  assetsMinor: number;
  liabilitiesMinor: number;
  netMinor: number;
  assets: NetWorthItem[];
  liabilities: NetWorthItem[];
  unconverted: { label: string; currency: CurrencyCode }[];
}

type RateFn = (cur: CurrencyCode) => number | undefined;

function build(
  items: { item: Omit<NetWorthItem, 'baseMinor'>; liability: boolean }[],
  rateOf: RateFn,
): NetWorth {
  const out: NetWorth = { assetsMinor: 0, liabilitiesMinor: 0, netMinor: 0, assets: [], liabilities: [], unconverted: [] };
  for (const { item, liability } of items) {
    if (item.amountMinor === 0) continue;
    const r = item.currency === BASE_CURRENCY ? 1 : rateOf(item.currency);
    if (r === undefined) {
      out.unconverted.push({ label: item.label, currency: item.currency });
      continue;
    }
    const full = { ...item, baseMinor: item.currency === BASE_CURRENCY ? item.amountMinor : convertToBase(item.amountMinor, item.currency, r) };
    (liability ? out.liabilities : out.assets).push(full);
  }
  out.assetsMinor = out.assets.reduce((s, x) => s + x.baseMinor, 0);
  out.liabilitiesMinor = out.liabilities.reduce((s, x) => s + x.baseMinor, 0);
  out.netMinor = out.assetsMinor - out.liabilitiesMinor;
  return out;
}

export function computeNetWorth(
  accounts: Pick<Account, 'id' | 'name' | 'currency' | 'currentBalanceMinor' | 'status'>[],
  debts: Pick<Debt, 'id' | 'person' | 'currency' | 'remainingMinor' | 'direction' | 'status'>[],
  latestRates: Map<string, number>,
  extras: {
    investments?: Pick<Investment, 'id' | 'name' | 'currency' | 'quantityMicro' | 'lastPriceMinor' | 'lastPriceDate'>[];
    assets?: Pick<Asset, 'id' | 'name' | 'currency' | 'valueMinor' | 'valuationDate' | 'status'>[];
  } = {},
): NetWorth {
  const items: { item: Omit<NetWorthItem, 'baseMinor'>; liability: boolean }[] = [];
  const seen = new Set<string>();
  for (const a of accounts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    items.push({
      item: { kind: 'account', id: a.id, label: a.name, currency: a.currency, amountMinor: Math.abs(a.currentBalanceMinor) },
      liability: a.currentBalanceMinor < 0,
    });
  }
  for (const d of debts) {
    if (d.status !== 'open' || d.remainingMinor <= 0) continue;
    items.push({ item: { kind: 'debt', id: d.id, label: d.person, currency: d.currency, amountMinor: d.remainingMinor }, liability: d.direction === 'i_owe' });
  }
  for (const inv of extras.investments ?? []) {
    if (inv.quantityMicro <= 0 || inv.lastPriceMinor === null) continue;
    items.push({
      item: { kind: 'investment', id: inv.id, label: inv.name, currency: inv.currency, amountMinor: valueOf(inv.quantityMicro, inv.lastPriceMinor), asOf: inv.lastPriceDate },
      liability: false,
    });
  }
  for (const as of extras.assets ?? []) {
    if (as.status !== 'active') continue;
    items.push({ item: { kind: 'asset', id: as.id, label: as.name, currency: as.currency, amountMinor: as.valueMinor, asOf: as.valuationDate }, liability: false });
  }
  return build(items, (c) => latestRates.get(c));
}

// ——— Historical reconstruction (monthly / yearly trend) ———

export interface HistoryInputs {
  accounts: Account[];
  txns: Transaction[];
  debts: Debt[];
  repayments: DebtRepayment[];
  investments: Investment[];
  investmentTxns: InvestmentTxn[];
  assets: Asset[];
  valuations: AssetValuation[];
  rates: ExchangeRate[];
}

/** Rate effective on a date: latest stored rate dated on/before it. */
export function rateAt(rates: ExchangeRate[], currency: CurrencyCode, date: string): number | undefined {
  let best: ExchangeRate | undefined;
  for (const r of rates) if (r.currency === currency && r.date <= date && (!best || r.date > best.date)) best = r;
  return best?.rateToBase;
}

/**
 * Net worth as it stood at the end of `date`. Account balances are rolled back
 * from today's balance by reversing every posting dated after `date` — so the
 * result always reconciles with the current balance. Uses the exchange rate
 * effective on that date.
 */
export function netWorthAt(h: HistoryInputs, date: string): NetWorth {
  const debtDir = new Map(h.debts.map((d) => [d.id, d.direction]));
  const balance = new Map(h.accounts.map((a) => [a.id, a.currentBalanceMinor]));
  for (const t of h.txns) {
    if (t.date <= date) continue;
    const dir = t.type === 'debt_repayment' ? debtDir.get(t.debtId ?? '') ?? null : null;
    if (t.type === 'debt_repayment' && !dir) continue;
    for (const p of compilePostings({ ...t, debtDirection: dir })) {
      if (balance.has(p.accountId)) balance.set(p.accountId, balance.get(p.accountId)! - p.deltaMinor);
    }
  }
  const items: { item: Omit<NetWorthItem, 'baseMinor'>; liability: boolean }[] = [];
  for (const a of h.accounts) {
    if (a.openedAt.slice(0, 10) > date) continue;
    const b = balance.get(a.id)!;
    items.push({ item: { kind: 'account', id: a.id, label: a.name, currency: a.currency, amountMinor: Math.abs(b) }, liability: b < 0 });
  }
  for (const d of h.debts) {
    if (d.startDate > date) continue;
    const repaid = h.repayments.filter((r) => r.debtId === d.id && r.date <= date).reduce((s, r) => s + r.amountMinor, 0);
    const remaining = Math.max(0, d.principalMinor - repaid);
    items.push({ item: { kind: 'debt', id: d.id, label: d.person, currency: d.currency, amountMinor: remaining }, liability: d.direction === 'i_owe' });
  }
  for (const inv of h.investments) {
    const txns = h.investmentTxns.filter((x) => x.investmentId === inv.id);
    let held;
    try {
      held = replay(txns, date);
    } catch {
      continue;
    }
    if (held.quantityMicro <= 0 || held.lastPriceMinor === null) continue;
    items.push({ item: { kind: 'investment', id: inv.id, label: inv.name, currency: inv.currency, amountMinor: valueOf(held.quantityMicro, held.lastPriceMinor), asOf: held.lastPriceDate }, liability: false });
  }
  for (const as of h.assets) {
    let latest: AssetValuation | undefined;
    for (const v of h.valuations) if (v.assetId === as.id && v.date <= date && (!latest || v.date > latest.date || (v.date === latest.date && v.createdAt > latest.createdAt))) latest = v;
    if (!latest) continue;
    items.push({ item: { kind: 'asset', id: as.id, label: as.name, currency: as.currency, amountMinor: latest.valueMinor, asOf: latest.date }, liability: false });
  }
  return build(items, (c) => rateAt(h.rates, c, date));
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Month-end dates for the last `n` months, ending with `today` for the current month. */
export function monthEnds(today: string, n: number): string[] {
  const d = new Date(`${today}T12:00:00`);
  const out: string[] = [];
  for (let i = n - 1; i >= 1; i--) out.push(iso(new Date(d.getFullYear(), d.getMonth() - i + 1, 0, 12)));
  out.push(today);
  return out;
}

/** Year-end dates for the last `n` years, ending with `today`. */
export function yearEnds(today: string, n: number): string[] {
  const y = parseInt(today.slice(0, 4), 10);
  const out: string[] = [];
  for (let i = n - 1; i >= 1; i--) out.push(`${y - i}-12-31`);
  out.push(today);
  return out;
}
