import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from './schema';
import { createProfile, saveSettings } from './profiles';
import { createAccount } from './accounts';
import { createTransaction, deleteTransaction } from './transactions';
import { createDebt, repayDebt } from './debts';
import { createGoal, contributeToGoal } from './goals';
import { createBudget } from './budgets';
import { createInvestment, recordValuation } from './investments';
import { createAsset } from './assets';
import { addRate } from './rates';
import { addAttachment, readAttachment } from './attachments';
import { enableLock } from './security';
import { setDek } from './keyring';
import { createBackup, openBackup, restorePayload, BACKUP_TABLES } from './backup';
import { toQuantityMicro } from '../engine/investments';

const FAST = 1_000;

async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) {
    const rows = await db.table(name).toArray();
    out[name] = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

async function seed() {
  const p = await createProfile('Personal');
  await saveSettings({ activeProfileId: p.id, onboardingDone: true });
  const cash = await createAccount({ profileId: p.id, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 500_000, openedAt: todayISO() });
  const usd = await createAccount({ profileId: p.id, name: 'USD', type: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedAt: todayISO() });
  await addRate({ currency: 'USD', rateToBase: 533, date: '2026-01-01' });
  const food = (await db.categories.toArray()).find((c) => c.nameKey === 'food')!;
  const t1 = await createTransaction({ profileId: p.id, type: 'expense', amountMinor: 7_000, accountId: cash.id, categoryId: food.id, date: todayISO(),
    splits: [{ categoryId: food.id, subcategoryId: null, amountMinor: 7_000, notes: '' }] });
  const t2 = await createTransaction({ profileId: p.id, type: 'expense', amountMinor: 1_999, accountId: usd.id, date: todayISO() });
  await deleteTransaction(t2.id); // something in Trash
  const d = await createDebt({ profileId: p.id, person: 'Ali', direction: 'owed_to_me', principalMinor: 30_000, currency: 'YER', startDate: todayISO(), moveAccountId: cash.id });
  await repayDebt({ debtId: d.id, amountMinor: 10_000, date: todayISO(), accountId: cash.id });
  const g = await createGoal({ profileId: p.id, name: 'Hajj', targetMinor: 900_000, currency: 'YER' });
  await contributeToGoal({ goalId: g.id, amountMinor: 50_000, date: todayISO() });
  await createBudget({ profileId: p.id, name: 'Food', categoryId: food.id, period: 'monthly', amountMinor: 50_000, startDate: todayISO() });
  const inv = await createInvestment({ profileId: p.id, name: 'Gold', type: 'gold', currency: 'YER', initialBuy: { quantityMicro: toQuantityMicro('2.5'), priceMinor: 40_000, date: todayISO(), accountId: cash.id } });
  await recordValuation(inv.id, 45_000, todayISO());
  await createAsset({ profileId: p.id, name: 'Jewelry', kind: 'gold', currency: 'YER', valueMinor: 300_000, valuationDate: todayISO() });
  const att = await addAttachment({ profileId: p.id, ownerType: 'transaction', ownerId: t1.id, name: 'receipt.jpg', blob: new Blob([new Uint8Array([9, 8, 7, 255, 0])], { type: 'image/jpeg' }) });
  return { att };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  setDek(null);
});

describe('backup & restore (acceptance #18)', () => {
  it('round-trips every financial table and attachment exactly', async () => {
    const { att } = await seed();
    const before = await snapshot();
    const { text, counts } = await createBackup('correct horse battery', FAST);
    expect(counts.attachments).toBe(1);
    expect(text).not.toContain('Hajj'); // encrypted, not readable

    // a new device: wipe everything
    await db.delete();
    await db.open();
    const payload = await openBackup(text, 'correct horse battery');
    await restorePayload(payload);
    const after = await snapshot();
    for (const name of BACKUP_TABLES) {
      if (name === 'settings') continue; // lastBackupAt differs by design
      expect(after[name], name).toEqual(before[name]);
    }
    const bytes = new Uint8Array(await (await readAttachment(att.id)).arrayBuffer());
    expect([...bytes]).toEqual([9, 8, 7, 255, 0]);
  });

  it('rejects a wrong password and leaves current data untouched', async () => {
    await seed();
    const { text } = await createBackup('correct horse battery', FAST);
    const before = await snapshot();
    await expect(openBackup(text, 'wrong password!')).rejects.toThrow('BACKUP_BAD_PASSWORD');
    expect(await snapshot()).toEqual(before);
  });

  it('detects a tampered or truncated file before replacing anything', async () => {
    await seed();
    const { text } = await createBackup('correct horse battery', FAST);
    const env = JSON.parse(text);
    const bytes = Uint8Array.from(atob(env.data), (c) => c.charCodeAt(0));
    bytes[10] ^= 0xff;
    env.data = btoa(String.fromCharCode(...bytes));
    await expect(openBackup(JSON.stringify(env), 'correct horse battery')).rejects.toThrow();
    await expect(openBackup(text.slice(0, text.length / 2), 'correct horse battery')).rejects.toThrow('BACKUP_NOT_A_BACKUP');
    await expect(openBackup('{"hello":1}', 'x')).rejects.toThrow('BACKUP_NOT_A_BACKUP');
  });

  it('restoring onto a locked-enabled device re-encrypts attachments with that device key', async () => {
    const { att } = await seed();
    const { text } = await createBackup('correct horse battery', FAST);
    await db.delete();
    await db.open();
    await enableLock('2468', 'device recovery pw', FAST); // new device has its own lock
    await restorePayload(await openBackup(text, 'correct horse battery'));
    const stored = (await db.attachments.get(att.id))!;
    expect(stored.encrypted).toBe(true);
    const bytes = new Uint8Array(await (await readAttachment(att.id)).arrayBuffer());
    expect([...bytes]).toEqual([9, 8, 7, 255, 0]);
  });

  it('cannot back up encrypted attachments while locked', async () => {
    await seed();
    await enableLock('2468', 'device recovery pw', FAST);
    setDek(null);
    await expect(createBackup('correct horse battery', FAST)).rejects.toThrow('APP_LOCKED');
  });

  it('records the last successful backup date', async () => {
    await seed();
    await createBackup('correct horse battery', FAST);
    expect((await db.settings.get('settings'))!.lastBackupAt).toBeTruthy();
  });
});
