/**
 * End-of-month forecasting (PRD §14) — pure. Two methods:
 *   1. historical: average daily income/expense from recent history
 *   2. planned: registered budgets + recurring obligations + debts falling due
 * Every output is an ESTIMATE and is labelled as such in the UI.
 * All amounts are base-currency (YER) minor units.
 */

export interface UpcomingItem {
  kind: 'recurring_expense' | 'recurring_income' | 'debt_payable' | 'debt_receivable';
  label: string;
  date: string;
  baseMinor: number;
  /** Category of a recurring expense (for budget-coverage checks). */
  categoryId?: string | null;
}

export interface BudgetLine {
  id: string;
  name: string;
  /** null = overall budget covering every category. */
  categoryIds: Set<string> | null;
  limitMinor: number; // effective limit (incl. rollover)
  spentMinor: number;
}

export interface ForecastInput {
  /** Days left in the month AFTER today. */
  daysLeft: number;
  daysElapsed: number;
  daysTotal: number;
  liquidBalanceMinor: number;
  /** Recent history used for method 1. */
  history: { incomeMinor: number; expenseMinor: number; days: number } | null;
  /** Items due after today up to month end. */
  upcoming: UpcomingItem[];
  budgets: BudgetLine[];
}

export interface Projection {
  expectedIncomeMinor: number;
  expectedExpenseMinor: number;
  /** Debt payments due (cash out, not expenses). */
  expectedDebtOutMinor: number;
  endBalanceMinor: number;
}

export interface Forecast {
  historical: Projection | null; // null: no history to average
  planned: Projection;
  /** Budgets whose current pace projects past their limit. */
  overspendRisks: { id: string; name: string; projectedMinor: number; limitMinor: number }[];
  upcoming: UpcomingItem[];
}

function sumKind(items: UpcomingItem[], kind: UpcomingItem['kind']): number {
  return items.filter((i) => i.kind === kind).reduce((s, i) => s + i.baseMinor, 0);
}

/**
 * Planned expenses without double counting: a recurring bill whose category is
 * covered by a budget is already part of that budget's remaining amount, so per
 * budget we take max(remaining budget, recurring bills it covers). Bills no
 * budget covers are added on top.
 */
export function plannedExpenses(budgets: BudgetLine[], upcoming: UpcomingItem[]): number {
  const bills = upcoming.filter((u) => u.kind === 'recurring_expense');
  const overall = budgets.filter((b) => b.categoryIds === null);
  if (overall.length > 0) {
    const remaining = overall.reduce((s, b) => s + Math.max(0, b.limitMinor - b.spentMinor), 0);
    return Math.max(remaining, bills.reduce((s, b) => s + b.baseMinor, 0));
  }
  let total = 0;
  const covered = new Set<UpcomingItem>();
  for (const b of budgets) {
    const mine = bills.filter((u) => u.categoryId && b.categoryIds!.has(u.categoryId) && !covered.has(u));
    mine.forEach((u) => covered.add(u));
    total += Math.max(Math.max(0, b.limitMinor - b.spentMinor), mine.reduce((s, u) => s + u.baseMinor, 0));
  }
  for (const u of bills) if (!covered.has(u)) total += u.baseMinor;
  return total;
}

export function forecastMonth(i: ForecastInput): Forecast {
  const debtOut = sumKind(i.upcoming, 'debt_payable');

  let historical: Projection | null = null;
  if (i.history && i.history.days > 0) {
    const inc = Math.round((i.history.incomeMinor * i.daysLeft) / i.history.days);
    const exp = Math.round((i.history.expenseMinor * i.daysLeft) / i.history.days);
    historical = {
      expectedIncomeMinor: inc,
      expectedExpenseMinor: exp,
      expectedDebtOutMinor: debtOut,
      endBalanceMinor: i.liquidBalanceMinor + inc - exp - debtOut,
    };
  }

  // receivables are NOT counted as expected income — repayment by others is uncertain
  const plannedInc = sumKind(i.upcoming, 'recurring_income');
  const plannedExp = plannedExpenses(i.budgets, i.upcoming);
  const planned: Projection = {
    expectedIncomeMinor: plannedInc,
    expectedExpenseMinor: plannedExp,
    expectedDebtOutMinor: debtOut,
    endBalanceMinor: i.liquidBalanceMinor + plannedInc - plannedExp - debtOut,
  };

  const overspendRisks: Forecast['overspendRisks'] = [];
  if (i.daysElapsed > 0) {
    for (const b of i.budgets) {
      const projected = Math.round((b.spentMinor * i.daysTotal) / i.daysElapsed);
      if (projected > b.limitMinor) overspendRisks.push({ id: b.id, name: b.name, projectedMinor: projected, limitMinor: b.limitMinor });
    }
  }
  return { historical, planned, overspendRisks, upcoming: [...i.upcoming].sort((a, b) => a.date.localeCompare(b.date)) };
}
