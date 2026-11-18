import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from './schema';
import { createProfile } from './profiles';
import { createAccount, reconcileAccount, deleteAccount } from './accounts';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  restoreTransaction,
} from './transactions';
import { addRate, correctRate, listRates } from './rates';
import { totalsContribution } from '../engine/posting';

let profileId: string;
let cash: string;
let bank: string;
let card: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const p = await createProfile('Test');
  profileId = p.id;
  cash = (await createAccount({ profileId, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 100_000, openedAt: todayISO() })).id;
  bank = (await createAccount({ profileId, name: 'Bank', type: 'bank', currency: 'YER', openingBalanceMinor: 500_000, openedAt: todayISO() })).id;
  card = (await createAccount({ profileId, name: 'Card', type: 'credit_card', currency: 'YER', openingBalanceMinor: 0, openedAt: todayISO() })).id;
});

async function balance(id: string): Promise<number> {
  return (await db.accounts.get(id))!.currentBalanceMinor;
}

describe('acceptance #1 & #2 — expenses and income move the right balance', () => {
  it('expense reduces the account', async () => {
    await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    expect(await balance(cash)).toBe(95_000);
  });
  it('income increases the account', async () => {
    await createTransaction({ profileId, type: 'income', amountMinor: 20_000, accountId: bank, date: todayISO() });
    expect(await balance(bank)).toBe(520_000);
  });
});

describe('acceptance #3 — internal transfers do not affect income/expense totals', () => {
  it('transfer moves money, totals unchanged', async () => {
    const t = await createTransaction({ profileId, type: 'transfer', amountMinor: 50_000, accountId: bank, toAccountId: cash, date: todayISO() });
    expect(await balance(bank)).toBe(450_000);
    expect(await balance(cash)).toBe(150_000);
    const c = totalsContribution(t);
    expect(c.incomeMinor).toBe(0);
    expect(c.expenseMinor).toBe(0);
  });
  it('rejects cross-currency transfers (PRD rule 4)', async () => {
    const usd = await createAccount({ profileId, name: 'USD', type: 'bank', currency: 'USD', openingBalanceMinor: 10000, openedAt: todayISO() });
    await expect(
      createTransaction({ profileId, type: 'transfer', amountMinor: 1000, accountId: bank, toAccountId: usd.id, date: todayISO() }),
    ).rejects.toThrow(/same currency/i);
  });
});

describe('acceptance #4 & #5 — credit cards', () => {
  it('cc purchase creates an expense and grows the liability', async () => {
    const t = await createTransaction({ profileId, type: 'cc_purchase', amountMinor: 30_000, accountId: card, date: todayISO() });
    expect(await balance(card)).toBe(-30_000); // liability
    expect(totalsContribution(t).expenseMinor).toBe(30_000);
  });
  it('cc payment settles the debt without a second expense', async () => {
    await createTransaction({ profileId, type: 'cc_purchase', amountMinor: 30_000, accountId: card, date: todayISO() });
    const pay = await createTransaction({ profileId, type: 'cc_payment', amountMinor: 30_000, accountId: bank, toAccountId: card, date: todayISO() });
    expect(await balance(card)).toBe(0);
    expect(await balance(bank)).toBe(470_000);
    expect(totalsContribution(pay).expenseMinor).toBe(0);
  });
  it('cc purchase must use a credit card account', async () => {
    await expect(
      createTransaction({ profileId, type: 'cc_purchase', amountMinor: 1000, accountId: bank, date: todayISO() }),
    ).rejects.toThrow();
  });
});

describe('acceptance #6 — split transactions reconcile exactly', () => {
  it('accepts exact splits and stores them', async () => {
    const t = await createTransaction({
      profileId, type: 'expense', amountMinor: 10_000, accountId: cash, date: todayISO(),
      splits: [
        { categoryId: 'c1', subcategoryId: null, amountMinor: 4000, notes: '' },
        { categoryId: 'c2', subcategoryId: null, amountMinor: 6000, notes: '' },
      ],
    });
    expect(t.hasSplits).toBe(true);
    expect(await db.splits.where('transactionId').equals(t.id).count()).toBe(2);
  });
  it('rejects mismatched splits and leaves balances untouched', async () => {
    await expect(
      createTransaction({
        profileId, type: 'expense', amountMinor: 10_000, accountId: cash, date: todayISO(),
        splits: [{ categoryId: 'c1', subcategoryId: null, amountMinor: 9999, notes: '' }],
      }),
    ).rejects.toThrow();
    expect(await balance(cash)).toBe(100_000);
  });
});

describe('acceptance #7 & #8 — historical exchange rates are frozen', () => {
  it('records the rate at transaction time; later corrections do not rewrite history', async () => {
    const usd = await createAccount({ profileId, name: 'USD acc', type: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedAt: todayISO() });
    await addRate({ currency: 'USD', rateToBase: 533, date: '2026-01-01' });
    const t = await createTransaction({ profileId, type: 'expense', amountMinor: 10_000, accountId: usd.id, date: todayISO() }); // $100
    expect(t.fxRateToBase).toBe(533);
    expect(t.baseAmountMinor).toBe(53_300);
    // a NEW later rate must not change the stored txn
    await addRate({ currency: 'USD', rateToBase: 600, date: todayISO() });
    const stored = await db.transactions.get(t.id);
    expect(stored!.fxRateToBase).toBe(533);
    expect(stored!.baseAmountMinor).toBe(53_300);
  });
  it('without any rate, baseAmount is null — never invented', async () => {
    const usd = await createAccount({ profileId, name: 'USD acc', type: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedAt: todayISO() });
    const t = await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: usd.id, date: todayISO() });
    expect(t.fxRateToBase).toBeNull();
    expect(t.baseAmountMinor).toBeNull();
  });
  it('correcting a stored rate keeps rate history editable', async () => {
    const r = await addRate({ currency: 'USD', rateToBase: 530, date: '2026-01-01' });
    await correctRate(r.id, 535);
    const rates = await listRates('USD');
    expect(rates[0].rateToBase).toBe(535);
  });
});

describe('editing and deleting keep balances consistent', () => {
  it('edit reverses old effect and applies the new one', async () => {
    const t = await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    await updateTransaction(t.id, { profileId, type: 'expense', amountMinor: 8000, accountId: cash, date: todayISO() });
    expect(await balance(cash)).toBe(92_000);
  });
  it('edit can move a txn between accounts', async () => {
    const t = await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    await updateTransaction(t.id, { profileId, type: 'expense', amountMinor: 5000, accountId: bank, date: todayISO() });
    expect(await balance(cash)).toBe(100_000);
    expect(await balance(bank)).toBe(495_000);
  });
  it('delete restores the balance and lands in trash; restore re-applies (acceptance #21)', async () => {
    const t = await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    await deleteTransaction(t.id);
    expect(await balance(cash)).toBe(100_000);
    const trash = await db.trash.toArray();
    expect(trash).toHaveLength(1);
    await restoreTransaction(trash[0].id);
    expect(await balance(cash)).toBe(95_000);
    expect(await db.transactions.get(t.id)).toBeTruthy();
    expect(await db.trash.count()).toBe(0);
  });
});

describe('audit trail (PRD §22)', () => {
  it('create/update/delete all write audit entries with before/after', async () => {
    const t = await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    await updateTransaction(t.id, { profileId, type: 'expense', amountMinor: 6000, accountId: cash, date: todayISO() });
    await deleteTransaction(t.id);
    const entries = await db.auditLog.where('[table+rowId]').equals(['transactions', t.id]).toArray();
    const actions = entries.map((e) => e.action).sort();
    expect(actions).toEqual(['create', 'delete', 'update']);
    const upd = entries.find((e) => e.action === 'update')!;
    expect(JSON.parse(upd.before!).amountMinor).toBe(5000);
    expect(JSON.parse(upd.after!).amountMinor).toBe(6000);
  });
  it('every mutation lands in the sync outbox as pending', async () => {
    await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    const pending = await db.syncQueue.where('status').equals('pending').count();
    expect(pending).toBeGreaterThan(0);
  });
});

describe('accounts', () => {
  it('reconcile absorbs the difference without touching transactions', async () => {
    await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    const acc = await reconcileAccount(cash, 90_000); // user counted 90,000 in reality
    expect(acc.currentBalanceMinor).toBe(90_000);
    expect(acc.openingBalanceMinor).toBe(95_000); // shifted by the -5000 discrepancy
    expect(await db.transactions.count()).toBe(1);
  });
  it('refuses to delete an account that has transactions', async () => {
    await createTransaction({ profileId, type: 'expense', amountMinor: 5000, accountId: cash, date: todayISO() });
    await expect(deleteAccount(cash)).rejects.toThrow('ACCOUNT_HAS_TRANSACTIONS');
  });
  it('profile separation: accounts of one profile are rejected for another (acceptance #22)', async () => {
    const p2 = await createProfile('Business');
    await expect(
      createTransaction({ profileId: p2.id, type: 'expense', amountMinor: 1000, accountId: cash, date: todayISO() }),
    ).rejects.toThrow(/profile/i);
  });
  it('explicitly shared accounts are usable from the other profile (PRD §25)', async () => {
    const p2 = await createProfile('Business');
    const acc = await db.accounts.get(cash);
    await db.accounts.update(cash, { sharedWithProfileIds: [...acc!.sharedWithProfileIds, p2.id] });
    await expect(
      createTransaction({ profileId: p2.id, type: 'expense', amountMinor: 1000, accountId: cash, date: todayISO() }),
    ).resolves.toBeTruthy();
  });
});
