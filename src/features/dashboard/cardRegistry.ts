/** Dashboard cards (PRD §5), in default order. */
export const CARD_IDS = [
  'totalBalance',
  'incomeExpense',
  'forecast',
  'remainingBudget',
  'upcomingBills',
  'upcomingDebts',
  'netWorth',
  'savingsBalance',
  'goalsProgress',
  'spendingByCategory',
  'incomeVsExpense',
  'cashFlow',
  'recentTransactions',
] as const;

export type CardId = (typeof CARD_IDS)[number];
export interface CardPref {
  id: string;
  visible: boolean;
}

export const DEFAULT_LAYOUT: CardPref[] = CARD_IDS.map((id) => ({ id, visible: true }));

/**
 * Merge a saved layout with the registry: keeps the user's order/visibility,
 * drops ids that no longer exist, and appends new cards (visible) so features
 * added in later versions show up for existing users.
 */
/** The Stage-1 default; a saved layout identical to it was never customized. */
const LEGACY_DEFAULT = ['totalBalance', 'incomeExpense', 'netWorth', 'spendingByCategory', 'incomeVsExpense', 'cashFlow', 'recentTransactions'];

export function mergeLayout(saved: CardPref[] | undefined | null): CardPref[] {
  if (saved && saved.length === LEGACY_DEFAULT.length && saved.every((p, i) => p.id === LEGACY_DEFAULT[i] && p.visible)) {
    return DEFAULT_LAYOUT;
  }
  const known = new Set<string>(CARD_IDS);
  const out: CardPref[] = [];
  const seen = new Set<string>();
  for (const p of saved ?? []) {
    if (!known.has(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, visible: p.visible });
  }
  for (const id of CARD_IDS) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}

export function moveCard(layout: CardPref[], index: number, dir: -1 | 1): CardPref[] {
  const j = index + dir;
  if (j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
