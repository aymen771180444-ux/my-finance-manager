import { describe, it, expect } from 'vitest';
import { mergeLayout, moveCard, CARD_IDS, DEFAULT_LAYOUT } from './cardRegistry';

describe('dashboard layout', () => {
  it('keeps user order/visibility, drops unknown ids, appends new cards', () => {
    const merged = mergeLayout([
      { id: 'recentTransactions', visible: true },
      { id: 'totalBalance', visible: false },
      { id: 'removedCard', visible: true },
      { id: 'totalBalance', visible: true }, // duplicate ignored
    ]);
    expect(merged[0]).toEqual({ id: 'recentTransactions', visible: true });
    expect(merged[1]).toEqual({ id: 'totalBalance', visible: false });
    expect(merged.some((p) => p.id === 'removedCard')).toBe(false);
    expect(merged).toHaveLength(CARD_IDS.length);
    expect(merged.find((p) => p.id === 'forecast')!.visible).toBe(true);
  });
  it('an untouched Stage-1 default layout upgrades to the full default', () => {
    const legacy = ['totalBalance', 'incomeExpense', 'netWorth', 'spendingByCategory', 'incomeVsExpense', 'cashFlow', 'recentTransactions'].map((id) => ({ id, visible: true }));
    expect(mergeLayout(legacy)).toEqual(DEFAULT_LAYOUT);
  });
  it('empty saved layout = defaults', () => {
    expect(mergeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });
  it('moves cards and stops at the edges', () => {
    const l = mergeLayout(undefined);
    expect(moveCard(l, 1, -1)[0].id).toBe(l[1].id);
    expect(moveCard(l, 0, -1)).toBe(l);
    expect(moveCard(l, l.length - 1, 1)).toBe(l);
  });
});
