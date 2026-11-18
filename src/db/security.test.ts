import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { createTransaction, deleteTransaction, purgeExpiredTrash } from './transactions';
import {
  enableLock, unlockWithPin, unlockWithRecovery, changePin, disableLock, getVault, backoffMs,
} from './security';
import { addAttachment, readAttachment, listAttachments, deleteAttachment, restoreAttachment } from './attachments';
import { setDek, getDek } from './keyring';

const FAST = 1_000;
let profileId: string;
let txnId: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  setDek(null);
  profileId = (await createProfile('T')).id;
  const acc = await createAccount({ profileId, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 1000, openedAt: todayISO() });
  txnId = (await createTransaction({ profileId, type: 'expense', amountMinor: 100, accountId: acc.id, date: todayISO() })).id;
});

const receipt = () => new Blob([new Uint8Array([1, 2, 3, 4, 250])], { type: 'image/jpeg' });
const bytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

describe('app lock vault', () => {
  it('stores no plaintext key or PIN', async () => {
    await enableLock('1234', 'my recovery phrase', FAST);
    const v = (await getVault())!;
    const json = JSON.stringify(v);
    expect(json).not.toContain('1234');
    expect(json).not.toContain('my recovery phrase');
    expect(v.pinWrapped.data).toBeTruthy();
  });

  it('unlocks with the PIN or the recovery password; rejects wrong ones', async () => {
    await enableLock('1234', 'my recovery phrase', FAST);
    setDek(null);
    await expect(unlockWithPin('9999')).rejects.toThrow(/WRONG_SECRET/);
    await expect(unlockWithPin('1234')).resolves.toBeTruthy();
    setDek(null);
    await expect(unlockWithRecovery('my recovery phrase')).resolves.toBeTruthy();
    expect(getDek()).not.toBeNull();
  });

  it('locks out after repeated failures, with growing waits', async () => {
    await enableLock('1234', 'my recovery phrase', FAST);
    for (let i = 0; i < 4; i++) await expect(unlockWithPin('0000')).rejects.toThrow(/WRONG_SECRET/);
    await expect(unlockWithPin('0000')).rejects.toThrow(/LOCKED_OUT/);
    // even the right PIN is refused during the lockout window
    await expect(unlockWithPin('1234')).rejects.toThrow(/LOCKED_OUT/);
    expect(backoffMs(5)).toBe(30_000);
    expect(backoffMs(6)).toBe(60_000);
    expect(backoffMs(30)).toBe(15 * 60_000);
  });

  it('changing the PIN keeps the same data key (attachments stay readable)', async () => {
    const dek = await enableLock('1234', 'my recovery phrase', FAST);
    const a = await addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'r.jpg', blob: receipt() });
    await changePin(dek, '567890');
    setDek(null);
    await expect(unlockWithPin('1234')).rejects.toThrow();
    await unlockWithPin('567890');
    expect(await bytes(await readAttachment(a.id))).toEqual([1, 2, 3, 4, 250]);
  });
});

describe('attachments', () => {
  it('stored as plaintext without a lock, encrypted with one', async () => {
    const plain = await addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'a.jpg', blob: receipt() });
    expect(plain.encrypted).toBe(false);
    // enabling the lock encrypts existing files
    await enableLock('1234', 'my recovery phrase', FAST);
    const stored = (await db.attachments.get(plain.id))!;
    expect(stored.encrypted).toBe(true);
    expect(await bytes(stored.data)).not.toEqual([1, 2, 3, 4, 250]);
    expect(await bytes(await readAttachment(plain.id))).toEqual([1, 2, 3, 4, 250]);
  });

  it('cannot be read or added while locked', async () => {
    await enableLock('1234', 'my recovery phrase', FAST);
    const a = await addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'a.jpg', blob: receipt() });
    setDek(null);
    await expect(readAttachment(a.id)).rejects.toThrow('APP_LOCKED');
    await expect(addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'b.jpg', blob: receipt() })).rejects.toThrow('APP_LOCKED');
  });

  it('disabling the lock decrypts files back', async () => {
    const dek = await enableLock('1234', 'my recovery phrase', FAST);
    const a = await addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'a.jpg', blob: receipt() });
    await disableLock(dek);
    expect(await getVault()).toBeUndefined();
    const stored = (await db.attachments.get(a.id))!;
    expect(stored.encrypted).toBe(false);
    expect(await bytes(stored.data)).toEqual([1, 2, 3, 4, 250]);
  });

  it('delete goes to Trash and restores (acceptance #21 for attachments)', async () => {
    const a = await addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'a.jpg', blob: receipt() });
    await deleteAttachment(a.id);
    expect(await listAttachments('transaction', txnId)).toHaveLength(0);
    const entry = (await db.trash.toArray()).find((e) => e.table === 'attachments')!;
    await restoreAttachment(entry.id);
    expect(await listAttachments('transaction', txnId)).toHaveLength(1);
  });

  it('survive while their transaction is in Trash; purged once it is gone for good', async () => {
    const a = await addAttachment({ profileId, ownerType: 'transaction', ownerId: txnId, name: 'a.jpg', blob: receipt() });
    await deleteTransaction(txnId);
    await purgeExpiredTrash();
    expect(await db.attachments.get(a.id)).toBeTruthy(); // transaction still restorable
    // simulate the 90 days passing
    for (const e of await db.trash.toArray()) await db.trash.update(e.id, { purgeAt: '2000-01-01T00:00:00.000Z' });
    await purgeExpiredTrash();
    expect(await db.attachments.get(a.id)).toBeUndefined();
  });
});
