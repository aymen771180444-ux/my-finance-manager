import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './schema';
import { createProfile } from './profiles';
import { createAccount, reconcileAccount } from './accounts';
import { createTransaction } from './transactions';
import { createDebt, repayDebt } from './debts';
import { createGoal, contributeToGoal } from './goals';
import { createInvestment, sellInvestment } from './investments';
import { createAsset, revalueAsset } from './assets';
import { rebuildDerived } from './rebuild';
import { toQuantityMicro } from '../engine/investments';

async function derivedSnapshot() {
  return {
    accounts: (await db.accounts.toArray()).map((a) => [a.id, a.currentBalanceMinor]),
    debts: (await db.debts.toArray()).map((d) => [d.id, d.remainingMinor, d.status]),
    goals: (await db.savingsGoals.toArray()).map((g) => [g.id, g.savedMinor, g.status]),
    inv: (await db.investments.toArray()).map((i) => [i.id, i.quantityMicro, i.costBasisMinor, i.realizedMinor, i.lastPriceMinor]),
    assets: (await db.assets.toArray()).map((a) => [a.id, a.valueMinor, a.valuationDate]),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('rebuildDerived', () => {
  it('recomputes every cached figure exactly as the normal operations left them', async () => {
    const p = (await createProfile('T')).id;
    const bank = (await createAccount({ profileId: p, name: 'Bank', type: 'bank', currency: 'YER', openingBalanceMinor: 500_000, openedAt: '2026-01-01' })).id;
    const card = (await createAccount({ profileId: p, name: 'Card', type: 'credit_card', currency: 'YER', openingBalanceMinor: 0, openedAt: '2026-01-01' })).id;
    const sav = (await createAccount({ profileId: p, name: 'Sav', type: 'savings', currency: 'YER', openingBalanceMinor: 0, openedAt: '2026-01-01' })).id;
    await createTransaction({ profileId: p, type: 'expense', amountMinor: 7_000, accountId: bank, date: '2026-02-01' });
    await createTransaction({ profileId: p, type: 'cc_purchase', amountMinor: 9_000, accountId: card, date: '2026-02-02' });
    await createTransaction({ profileId: p, type: 'cc_payment', amountMinor: 4_000, accountId: bank, toAccountId: card, date: '2026-02-03' });
    const d = await createDebt({ profileId: p, person: 'Ali', direction: 'i_owe', principalMinor: 50_000, currency: 'YER', startDate: '2026-02-01', moveAccountId: bank });
    await repayDebt({ debtId: d.id, amountMinor: 20_000, date: '2026-02-05', accountId: bank });
    await repayDebt({ debtId: d.id, amountMinor: 5_000, date: '2026-02-06' });
    const g = await createGoal({ profileId: p, name: 'G', targetMinor: 100_000, currency: 'YER', linkedAccountId: sav });
    await contributeToGoal({ goalId: g.id, amountMinor: 30_000, date: '2026-02-07', fromAccountId: bank });
    const inv = await createInvestment({ profileId: p, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('4'), priceMinor: 1_000, date: '2026-02-08', accountId: bank } });
    await sellInvestment(inv.id, { quantityMicro: toQuantityMicro('1'), priceMinor: 1_500, date: '2026-02-09', accountId: bank });
    const a = await createAsset({ profileId: p, name: 'Gold', kind: 'gold', currency: 'YER', valueMinor: 100, valuationDate: '2026-01-01' });
    await revalueAsset(a.id, 150, '2026-03-01');
    await reconcileAccount(bank, 400_000);

    const correct = await derivedSnapshot();
    // corrupt every cache
    for (const x of await db.accounts.toArray()) await db.accounts.update(x.id, { currentBalanceMinor: 1 });
    for (const x of await db.debts.toArray()) await db.debts.update(x.id, { remainingMinor: 1, status: 'settled' });
    for (const x of await db.savingsGoals.toArray()) await db.savingsGoals.update(x.id, { savedMinor: 1 });
    for (const x of await db.investments.toArray()) await db.investments.update(x.id, { quantityMicro: 1, costBasisMinor: 1 });
    for (const x of await db.assets.toArray()) await db.assets.update(x.id, { valueMinor: 1 });

    const { changed } = await rebuildDerived();
    expect(changed).toBeGreaterThan(0);
    expect(await derivedSnapshot()).toEqual(correct);
    expect((await rebuildDerived()).changed).toBe(0); // idempotent
  });

  it('does not touch updatedAt (so sync does not see derived changes as edits)', async () => {
    const p = (await createProfile('T')).id;
    const bank = await createAccount({ profileId: p, name: 'Bank', type: 'bank', currency: 'YER', openingBalanceMinor: 10, openedAt: '2026-01-01' });
    await db.accounts.update(bank.id, { currentBalanceMinor: 999 });
    const before = (await db.accounts.get(bank.id))!.updatedAt;
    await rebuildDerived();
    expect((await db.accounts.get(bank.id))!.updatedAt).toBe(before);
  });
});
