import { useLiveQuery } from 'dexie-react-hooks';
import { db, todayISO } from '../db/schema';
import { useActiveProfileId } from './data';
import { loadReportData } from '../db/reportData';
import { budgetStatus } from '../db/budgets';
import { summarize, netFlowMinor, topEntries } from '../engine/analytics';
import { computeNetWorth, type NetWorth } from '../engine/networth';
import { periodRange } from '../engine/budgets';
import { occurrencesBetween } from '../engine/recurring';
import { installmentDates } from '../engine/calendar';
import { convertToBase, type CurrencyCode } from '../engine/money';
import type { Category, SavingsGoal, Transaction } from '../db/types';

export interface UpcomingRow {
  date: string;
  label: string;
  amountMinor: number;
  currency: CurrencyCode;
  direction?: 'in' | 'out';
}

export interface DashboardData {
  balance: { sum: number; missing: boolean };
  savings: { sum: number; missing: boolean };
  month: { income: number; expense: number; unconvertible: number };
  byCategory: { id: string; value: number }[];
  cats: Map<string, Category>;
  last6: { month: string; income: number; expense: number }[];
  cashFlow: { date: string; cumulative: number }[];
  netWorth: NetWorth;
  budget: { limit: number; spent: number; count: number } | null;
  goals: SavingsGoal[];
  bills: UpcomingRow[];
  debts: UpcomingRow[];
  recent: Transaction[];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function useDashboardData(): DashboardData | undefined {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => {
    if (!profileId) return undefined;
    const today = todayISO();
    const month = periodRange('monthly', today);
    const now = new Date(`${today}T12:00:00`);
    const sixStart = iso(new Date(now.getFullYear(), now.getMonth() - 5, 1, 12));
    const data = await loadReportData(profileId, sixStart, month.to);
    const rate = (c: CurrencyCode) => (c === 'YER' ? 1 : data.latestRates.get(c));
    const toBase = (m: number, c: CurrencyCode) => {
      const r = rate(c);
      return r === undefined ? null : convertToBase(m, c, r);
    };

    const active = data.accounts.filter((a) => a.status === 'active');
    const sumOf = (list: typeof active) => {
      let sum = 0;
      let missing = false;
      for (const a of list) {
        const b = toBase(a.currentBalanceMinor, a.currency);
        if (b === null) missing = true;
        else sum += b;
      }
      return { sum, missing };
    };

    const monthTxns = data.txns.filter((t) => t.date >= month.from && t.date <= month.to);
    const s = summarize(monthTxns, data.splitsByTxn, data.cats);

    const last6: DashboardData['last6'] = [];
    for (let i = 5; i >= 0; i--) {
      const r = periodRange('monthly', iso(new Date(now.getFullYear(), now.getMonth() - i, 1, 12)));
      const ms = summarize(data.txns.filter((t) => t.date >= r.from && t.date <= r.to), data.splitsByTxn, data.cats);
      last6.push({ month: r.from, income: ms.incomeMinor, expense: ms.expenseMinor });
    }

    // cumulative net flow through today (transfers net to zero)
    const debtDir = new Map(data.debts.map((d) => [d.id, d.direction]));
    const daily = new Map<string, number>();
    for (const t of monthTxns) {
      if (t.date > today) continue;
      daily.set(t.date, (daily.get(t.date) ?? 0) + netFlowMinor(t, (id) => (id ? debtDir.get(id) ?? null : null)));
    }
    const cashFlow: DashboardData['cashFlow'] = [];
    let cum = 0;
    for (let d = month.from; d <= today && d <= month.to; ) {
      cum += daily.get(d) ?? 0;
      cashFlow.push({ date: d, cumulative: cum });
      const n = new Date(`${d}T12:00:00`);
      n.setDate(n.getDate() + 1);
      d = iso(n);
    }

    // monthly budgets: overall ones win (category budgets would be inside them)
    const budgets = (await db.budgets.where('profileId').equals(profileId).toArray()).filter(
      (b) => !b.isArchived && b.period === 'monthly' && (!b.endDate || b.endDate >= today),
    );
    const overall = budgets.filter((b) => b.categoryId === null);
    const counted = overall.length ? overall : budgets;
    let limit = 0;
    let spent = 0;
    for (const b of counted) {
      const st = await budgetStatus(b, today);
      limit += st.effectiveLimitMinor;
      spent += st.spentMinor;
    }
    const budget: DashboardData['budget'] = counted.length ? { limit, spent, count: counted.length } : null;

    // next 30 days
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 30);
    const until = iso(horizon);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const accById = new Map(data.accounts.map((a) => [a.id, a]));
    const bills: UpcomingRow[] = [];
    for (const r of await db.recurringObligations.where('[profileId+status]').equals([profileId, 'active']).toArray()) {
      if (r.kind !== 'expense') continue;
      const cur = accById.get(r.accountId)?.currency ?? 'YER';
      for (const date of occurrencesBetween(r, iso(yesterday), until)) bills.push({ date, label: r.name, amountMinor: r.amountMinor, currency: cur });
    }
    const debts: UpcomingRow[] = [];
    for (const d of data.debts) {
      if (d.status !== 'open') continue;
      const dir = d.direction === 'i_owe' ? 'out' : 'in';
      const inst = installmentDates(d).filter((x) => x >= today && x <= until);
      for (const date of inst) debts.push({ date, label: d.person, amountMinor: Math.min(d.installmentMinor ?? d.remainingMinor, d.remainingMinor), currency: d.currency, direction: dir });
      if (d.dueDate && d.dueDate <= until && !inst.includes(d.dueDate)) {
        // overdue items stay visible until settled
        debts.push({ date: d.dueDate, label: d.person, amountMinor: d.remainingMinor, currency: d.currency, direction: dir });
      }
    }

    const goals = (await db.savingsGoals.where('profileId').equals(profileId).toArray()).filter((g) => g.status === 'active');
    const recent = (await db.transactions.where('profileId').equals(profileId).toArray())
      .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
      .slice(0, 5);

    return {
      balance: sumOf(active),
      savings: sumOf(active.filter((a) => a.type === 'savings')),
      month: { income: s.incomeMinor, expense: s.expenseMinor, unconvertible: s.unconvertible },
      byCategory: topEntries(s.expenseByCategory, 100).map(([id, value]) => ({ id, value })),
      cats: data.cats,
      last6,
      cashFlow,
      netWorth: computeNetWorth(active, data.debts, data.latestRates, { investments: data.investments, assets: data.assets }),
      budget,
      goals,
      bills: bills.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5),
      debts: debts.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5),
      recent,
    };
  }, [profileId]);
}
