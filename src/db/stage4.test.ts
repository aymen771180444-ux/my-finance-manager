import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { deleteTransaction, restoreTransaction } from './transactions';
import { createInvestment, buyInvestment, sellInvestment, recordValuation, deleteInvestment, restoreInvestment, deleteInvestmentTxn } from './investments';
import { createAsset, revalueAsset } from './assets';
import { createDebt, repayDebt, deleteDebt, restoreDebt } from './debts';
import { performance } from '../engine/investments';
import { totalsContribution } from '../engine/posting';
import { toQuantityMicro } from '../engine/investments';

let profileId: string;
let bank: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  profileId = (await createProfile('T')).id;
  bank = (await createAccount({ profileId, name: 'Bank', type: 'bank', currency: 'YER', openingBalanceMinor: 1_000_000, openedAt: todayISO() })).id;
});
const balance = async (id: string) => (await db.accounts.get(id))!.currentBalanceMinor;

describe('investments through accounts', () => {
  it('buy debits the account as investment_buy (not an expense); sell credits it', async () => {
    const inv = await createInvestment({
      profileId, name: 'Fund', type: 'fund', currency: 'YER', unit: 'units',
      initialBuy: { quantityMicro: toQuantityMicro('10'), priceMinor: 10_000, feesMinor: 500, date: '2026-10-01', accountId: bank },
    });
    expect(inv.costBasisMinor).toBe(100_500);
    expect(await balance(bank)).toBe(899_500);
    const buyTxn = (await db.transactions.where('profileId').equals(profileId).toArray()).find((t) => t.type === 'investment_buy')!;
    expect(totalsContribution(buyTxn).expenseMinor).toBe(0);

    const after = await sellInvestment(inv.id, { quantityMicro: toQuantityMicro('4'), priceMinor: 15_000, date: '2026-11-01', accountId: bank });
    expect(await balance(bank)).toBe(959_500);
    expect(after.quantityMicro).toBe(toQuantityMicro('6'));
    expect(after.costBasisMinor).toBe(60_300); // 100,500 × 6/10
    expect(after.realizedMinor).toBe(60_000 - 40_200);
  });

  it('valuation changes market value but never cost basis (acceptance #11)', async () => {
    const inv = await createInvestment({
      profileId, name: 'Gold', type: 'gold', currency: 'YER', unit: 'g',
      initialBuy: { quantityMicro: toQuantityMicro('2'), priceMinor: 50_000, date: '2026-10-01' },
    });
    const after = await recordValuation(inv.id, 60_000, '2026-11-15');
    const p = performance(after);
    expect(p.costBasisMinor).toBe(100_000);
    expect(p.marketValueMinor).toBe(120_000);
    expect(after.lastPriceDate).toBe('2026-11-15');
  });

  it('rejects overselling and leaves everything unchanged', async () => {
    const inv = await createInvestment({ profileId, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('1'), priceMinor: 1_000, date: '2026-10-01', accountId: bank } });
    const before = await balance(bank);
    await expect(sellInvestment(inv.id, { quantityMicro: toQuantityMicro('2'), priceMinor: 1_000, date: '2026-11-01', accountId: bank })).rejects.toThrow('INSUFFICIENT_QUANTITY');
    expect(await balance(bank)).toBe(before);
    expect(await db.investmentTxns.where('investmentId').equals(inv.id).count()).toBe(1);
  });

  it('rejects an account in another currency', async () => {
    const usd = await createAccount({ profileId, name: 'USD', type: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedAt: todayISO() });
    await expect(createInvestment({ profileId, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: 1_000_000, priceMinor: 100, date: '2026-10-01', accountId: usd.id } }))
      .rejects.toThrow('INVESTMENT_ACCOUNT_CURRENCY_MISMATCH');
  });

  it('deleting a buy that a later sale depends on is refused', async () => {
    const inv = await createInvestment({ profileId, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('1'), priceMinor: 1_000, date: '2026-10-01', accountId: bank } });
    await sellInvestment(inv.id, { quantityMicro: toQuantityMicro('1'), priceMinor: 1_200, date: '2026-11-01', accountId: bank });
    const buy = (await db.transactions.toArray()).find((t) => t.type === 'investment_buy')!;
    await expect(deleteTransaction(buy.id)).rejects.toThrow('INVESTMENT_HISTORY_CONFLICT');
    expect(await db.transactions.get(buy.id)).toBeTruthy();
  });

  it('deleting a sale transaction re-derives the holding; restore re-applies it', async () => {
    const inv = await createInvestment({ profileId, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('2'), priceMinor: 1_000, date: '2026-10-01', accountId: bank } });
    await sellInvestment(inv.id, { quantityMicro: toQuantityMicro('1'), priceMinor: 1_500, date: '2026-11-01', accountId: bank });
    const sell = (await db.transactions.toArray()).find((t) => t.type === 'investment_sell')!;
    await deleteTransaction(sell.id);
    expect((await db.investments.get(inv.id))!.quantityMicro).toBe(toQuantityMicro('2'));
    const entry = (await db.trash.toArray()).find((e) => e.rowId === sell.id)!;
    await restoreTransaction(entry.id);
    const restored = (await db.investments.get(inv.id))!;
    expect(restored.quantityMicro).toBe(toQuantityMicro('1'));
    expect(restored.realizedMinor).toBe(500);
  });

  it('deleting an investment returns its money; restoring investment + transactions is exact', async () => {
    const inv = await createInvestment({ profileId, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('3'), priceMinor: 10_000, date: '2026-10-01', accountId: bank } });
    await buyInvestment(inv.id, { quantityMicro: toQuantityMicro('1'), priceMinor: 12_000, date: '2026-10-10' }); // no account
    await sellInvestment(inv.id, { quantityMicro: toQuantityMicro('2'), priceMinor: 15_000, date: '2026-11-01', accountId: bank });
    const before = (await db.investments.get(inv.id))!;
    const bankBefore = await balance(bank);
    await deleteInvestment(inv.id);
    expect(await balance(bank)).toBe(1_000_000);
    expect(await db.investments.get(inv.id)).toBeUndefined();
    for (const e of await db.trash.toArray()) {
      if (e.table === 'investments') await restoreInvestment(e.id);
    }
    for (const e of await db.trash.toArray()) await restoreTransaction(e.id);
    const after = (await db.investments.get(inv.id))!;
    expect(after.quantityMicro).toBe(before.quantityMicro);
    expect(after.costBasisMinor).toBe(before.costBasisMinor);
    expect(after.realizedMinor).toBe(before.realizedMinor);
    expect(await balance(bank)).toBe(bankBefore);
    expect(await db.investmentTxns.where('investmentId').equals(inv.id).count()).toBe(3);
  });

  it('deleting an account-less history entry works', async () => {
    const inv = await createInvestment({ profileId, name: 'X', type: 'stock', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('1'), priceMinor: 100, date: '2026-10-01' } });
    await recordValuation(inv.id, 200, '2026-11-01');
    const val = (await db.investmentTxns.where('investmentId').equals(inv.id).toArray()).find((r) => r.kind === 'valuation')!;
    await deleteInvestmentTxn(val.id);
    expect((await db.investments.get(inv.id))!.lastPriceMinor).toBe(100);
  });
});

describe('assets', () => {
  it('revaluations keep history; latest by date wins', async () => {
    const a = await createAsset({ profileId, name: 'Gold', kind: 'gold', currency: 'YER', valueMinor: 200_000, valuationDate: '2026-01-01' });
    await revalueAsset(a.id, 260_000, '2026-07-01');
    await revalueAsset(a.id, 210_000, '2026-03-01'); // back-dated correction doesn't override the newer value
    const saved = (await db.assets.get(a.id))!;
    expect(saved.valueMinor).toBe(260_000);
    expect(await db.assetValuations.where('assetId').equals(a.id).count()).toBe(3);
  });
});

describe('debt repayment history', () => {
  it('records every repayment, with or without an account', async () => {
    const d = await createDebt({ profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 50_000, currency: 'YER', startDate: '2026-01-01', moveAccountId: bank });
    await repayDebt({ debtId: d.id, amountMinor: 10_000, date: '2026-02-01', accountId: bank });
    await repayDebt({ debtId: d.id, amountMinor: 5_000, date: '2026-03-01' });
    const rows = await db.debtRepayments.where('debtId').equals(d.id).toArray();
    expect(rows.map((r) => r.amountMinor).sort()).toEqual([10_000, 5_000].sort());
  });
  it('delete + restore of a debt and its repayments never double-applies them', async () => {
    const d = await createDebt({ profileId, person: 'Ali', direction: 'owed_to_me', principalMinor: 50_000, currency: 'YER', startDate: '2026-01-01', moveAccountId: bank });
    await repayDebt({ debtId: d.id, amountMinor: 20_000, date: '2026-02-01', accountId: bank });
    await repayDebt({ debtId: d.id, amountMinor: 5_000, date: '2026-03-01' }); // no account
    expect((await db.debts.get(d.id))!.remainingMinor).toBe(25_000);
    await deleteDebt(d.id);
    expect(await balance(bank)).toBe(1_000_000);
    const debtEntry = (await db.trash.toArray()).find((e) => e.table === 'debts')!;
    await restoreDebt(debtEntry.id);
    for (const e of (await db.trash.toArray()).filter((x) => x.table === 'transactions')) await restoreTransaction(e.id);
    const after = (await db.debts.get(d.id))!;
    expect(after.remainingMinor).toBe(25_000);
    expect(await db.debtRepayments.where('debtId').equals(d.id).count()).toBe(2);
    expect(await balance(bank)).toBe(1_000_000 - 50_000 + 20_000);
  });
});
