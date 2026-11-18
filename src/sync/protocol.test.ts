import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from '../db/schema';
import { createProfile } from '../db/profiles';
import { createAccount } from '../db/accounts';
import { createTransaction, updateTransaction, deleteTransaction } from '../db/transactions';
import { createRecurring, processRecurring } from '../db/recurring';
import { addAttachment, readAttachment } from '../db/attachments';
import { setDek } from '../db/keyring';
import { importAesKey } from '../engine/crypto';
import { MemoryStore } from './store';
import { connectRemote, syncOnce, pull, push, snapshot, localChanges, listRestorePoints, restorePoint, adoptOtherVersion, type SyncCtx } from './protocol';

const FAST = 1_000;
const PW = 'family sync password';

// ——— two simulated devices sharing one Drive ———
let drive: MemoryStore;
const saved = new Map<string, Record<string, unknown[]>>();
let current = '';

async function switchTo(device: string) {
  if (current) {
    const dump: Record<string, unknown[]> = {};
    for (const t of db.tables) dump[t.name] = await t.toArray();
    saved.set(current, dump);
  }
  for (const t of db.tables) await t.clear();
  const dump = saved.get(device);
  if (dump) for (const t of db.tables) if (dump[t.name]?.length) await t.bulkAdd(dump[t.name] as never[]);
  current = device;
}

async function connect(device: string): Promise<SyncCtx> {
  const { raw } = await connectRemote(drive, PW, FAST);
  await db.syncState.put({ id: 'sync', deviceId: device, email: null, connectedAt: todayISO(), key: null, applied: [], lastSyncAt: null, lastSnapshotAt: null, lastError: null, failures: 0 });
  return { store: drive, key: await importAesKey(raw), deviceId: device };
}

const balance = async (name: string) => (await db.accounts.toArray()).find((a) => a.name === name)!.currentBalanceMinor;
const txnByNote = async (n: string) => (await db.transactions.toArray()).find((t) => t.notes === n);

let ctxA: SyncCtx;
let ctxB: SyncCtx;
let profileId: string;
let cashId: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  setDek(null);
  drive = new MemoryStore();
  saved.clear();
  current = '';
  // phone A has data and connects first
  await switchTo('A');
  profileId = (await createProfile('Personal')).id;
  cashId = (await createAccount({ profileId, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 100_000, openedAt: '2026-01-01' })).id;
  await createTransaction({ profileId, type: 'expense', amountMinor: 5_000, accountId: cashId, date: '2026-11-01', notes: 'lunch' });
  ctxA = await connect('A');
  await syncOnce(ctxA);
  // phone B is a fresh install joining the same Drive
  await switchTo('B');
  ctxB = await connect('B');
  await syncOnce(ctxB);
});

describe('joining and two-way sync', () => {
  it('a new device receives everything, with balances recomputed locally', async () => {
    expect(await balance('Cash')).toBe(95_000);
    expect((await txnByNote('lunch'))?.amountMinor).toBe(5_000);
    expect((await db.categories.count()) > 0).toBe(true);
    expect(await localChanges()).toHaveLength(0); // nothing to echo back
  });

  it('a wrong password cannot join', async () => {
    await expect(connectRemote(drive, 'wrong password!!', FAST)).rejects.toThrow('SYNC_BAD_PASSWORD');
  });

  it('nothing readable is stored in Drive', async () => {
    const all = [...drive.files.values()].map((f) => new TextDecoder().decode(f.bytes)).join('');
    expect(all).not.toContain('lunch');
    expect(all).not.toContain('Personal');
  });

  it('edits and deletes flow both ways', async () => {
    await createTransaction({ profileId, type: 'income', amountMinor: 20_000, accountId: cashId, date: '2026-11-02', notes: 'gift' });
    await syncOnce(ctxB);
    await switchTo('A');
    await syncOnce(ctxA);
    expect(await balance('Cash')).toBe(115_000);
    await deleteTransaction((await txnByNote('lunch'))!.id);
    await syncOnce(ctxA);
    await switchTo('B');
    await syncOnce(ctxB);
    expect(await txnByNote('lunch')).toBeUndefined();
    expect(await balance('Cash')).toBe(120_000);
  });
});

describe('conflicts', () => {
  it('both devices edit the same record: newer wins everywhere, the other version is kept', async () => {
    const lunch = (await txnByNote('lunch'))!;
    await switchTo('A');
    await updateTransaction(lunch.id, { profileId, type: 'expense', amountMinor: 6_000, accountId: cashId, date: '2026-11-01', notes: 'lunch' });
    await syncOnce(ctxA);
    await new Promise((r) => setTimeout(r, 5)); // B's edit is later
    await switchTo('B');
    await updateTransaction(lunch.id, { profileId, type: 'expense', amountMinor: 7_000, accountId: cashId, date: '2026-11-01', notes: 'lunch' });
    const r = await syncOnce(ctxB);
    expect(r.conflicts).toBe(1);
    const c = (await db.syncConflicts.toArray())[0];
    expect(c.kept).toBe('local');
    expect(JSON.parse(c.remote!).amountMinor).toBe(6_000); // A's version is not lost
    await switchTo('A');
    await syncOnce(ctxA);
    expect((await db.transactions.get(lunch.id))!.amountMinor).toBe(7_000);
    expect(await balance('Cash')).toBe(93_000);
  });

  it('an edit beats a delete (no silent loss of an edit)', async () => {
    const lunch = (await txnByNote('lunch'))!;
    await switchTo('A');
    await deleteTransaction(lunch.id);
    await syncOnce(ctxA);
    await switchTo('B');
    await updateTransaction(lunch.id, { profileId, type: 'expense', amountMinor: 5_000, accountId: cashId, date: '2026-11-01', notes: 'lunch (edited)' });
    await syncOnce(ctxB);
    expect((await db.transactions.get(lunch.id))!.notes).toBe('lunch (edited)');
    await switchTo('A');
    await syncOnce(ctxA);
    expect((await db.transactions.get(lunch.id))!.notes).toBe('lunch (edited)');
  });
});

describe('automatic entries on two devices', () => {
  it('a recurring bill processed on both phones is recorded once', async () => {
    await switchTo('A');
    await createRecurring({ profileId, name: 'Internet', kind: 'expense', amountMinor: 10_000, accountId: cashId, frequency: 'monthly', startDate: todayISO(), mode: 'auto' });
    await syncOnce(ctxA);
    await processRecurring(profileId);
    await switchTo('B');
    await syncOnce(ctxB); // gets the schedule
    await processRecurring(profileId); // B processes the same day too
    await syncOnce(ctxB); // ...and receives A's entry
    await switchTo('A');
    await syncOnce(ctxA);
    const internet = (await db.transactions.toArray()).filter((t) => t.notes === 'Internet');
    expect(internet).toHaveLength(1);
    expect(await db.syncConflicts.count()).toBe(0);
  });
});

describe('reliability', () => {
  it('a failed upload keeps changes pending and succeeds on retry', async () => {
    await createTransaction({ profileId, type: 'expense', amountMinor: 1_000, accountId: cashId, date: '2026-11-03', notes: 'taxi' });
    drive.failNext = 'network down';
    await expect(syncOnce(ctxB)).rejects.toThrow('network down');
    expect((await localChanges()).length).toBeGreaterThan(0);
    await syncOnce(ctxB);
    expect(await localChanges()).toHaveLength(0);
    await switchTo('A');
    await syncOnce(ctxA);
    expect(await txnByNote('taxi')).toBeTruthy();
  });

  it('a device offline long enough for old files to be cleaned up loses nothing', async () => {
    // B makes an edit but stays offline
    await createTransaction({ profileId, type: 'expense', amountMinor: 2_000, accountId: cashId, date: '2026-11-04', notes: 'offline edit on B' });
    await switchTo('A');
    for (let day = 1; day <= 9; day++) {
      await createTransaction({ profileId, type: 'expense', amountMinor: 100, accountId: cashId, date: '2026-11-05', notes: `A day ${day}` });
      await pull(ctxA);
      await push(ctxA);
      await snapshot(ctxA); // daily snapshot + cleanup of covered change files
    }
    expect((await listRestorePoints(drive)).length).toBe(7); // only the newest 7 kept
    await switchTo('B');
    await syncOnce(ctxB);
    for (let day = 1; day <= 9; day++) expect(await txnByNote(`A day ${day}`)).toBeTruthy();
    expect(await txnByNote('offline edit on B')).toBeTruthy();
    await switchTo('A');
    await syncOnce(ctxA);
    expect(await txnByNote('offline edit on B')).toBeTruthy();
    expect(await balance('Cash')).toBe(100_000 - 5_000 - 2_000 - 900);
  });
});

describe('attachments', () => {
  it('receipt files reach the other device intact', async () => {
    const lunch = (await txnByNote('lunch'))!;
    await switchTo('A');
    await addAttachment({ profileId, ownerType: 'transaction', ownerId: lunch.id, name: 'r.jpg', blob: new Blob([new Uint8Array([7, 7, 8])], { type: 'image/jpeg' }) });
    await syncOnce(ctxA);
    await switchTo('B');
    await syncOnce(ctxB);
    const att = (await db.attachments.toArray())[0];
    expect([...new Uint8Array(await (await readAttachment(att.id)).arrayBuffer())]).toEqual([7, 7, 8]);
  });
});

describe('restore points', () => {
  it('rolling back to a Drive restore point propagates to the other device', async () => {
    const [point] = await listRestorePoints(drive); // state with just "lunch"
    await createTransaction({ profileId, type: 'expense', amountMinor: 3_000, accountId: cashId, date: '2026-11-06', notes: 'mistake' });
    await syncOnce(ctxB);
    await switchTo('A');
    await syncOnce(ctxA);
    expect(await txnByNote('mistake')).toBeTruthy();
    await restorePoint(ctxA, point);
    expect(await txnByNote('mistake')).toBeUndefined();
    await switchTo('B');
    await syncOnce(ctxB);
    expect(await txnByNote('mistake')).toBeUndefined();
    expect(await balance('Cash')).toBe(95_000);
  });
});

describe('resolving a conflict by hand', () => {
  it('"use the other version" brings back the losing edit on every device', async () => {
    const lunch = (await txnByNote('lunch'))!;
    await switchTo('A');
    await updateTransaction(lunch.id, { profileId, type: 'expense', amountMinor: 6_000, accountId: cashId, date: '2026-11-01', notes: 'lunch' });
    await syncOnce(ctxA);
    await new Promise((r) => setTimeout(r, 5));
    await switchTo('B');
    await updateTransaction(lunch.id, { profileId, type: 'expense', amountMinor: 7_000, accountId: cashId, date: '2026-11-01', notes: 'lunch' });
    await syncOnce(ctxB); // B's 7,000 wins
    const c = (await db.syncConflicts.toArray())[0];
    await adoptOtherVersion(c.id);
    expect((await db.transactions.get(lunch.id))!.amountMinor).toBe(6_000);
    expect(await balance('Cash')).toBe(94_000);
    expect((await db.syncConflicts.get(c.id))!.resolvedAt).toBeTruthy();
    await syncOnce(ctxB);
    await switchTo('A');
    await syncOnce(ctxA);
    expect((await db.transactions.get(lunch.id))!.amountMinor).toBe(6_000);
    expect(await balance('Cash')).toBe(94_000);
  });
});
