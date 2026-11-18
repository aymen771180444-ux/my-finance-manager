/**
 * Google Drive sync protocol — every user syncs with THEIR OWN Drive; there is
 * no server. All files live in Drive's hidden, app-private "appDataFolder".
 *
 * Remote layout (flat):
 *   mfm-meta.json                       plain: format, KDF salt/iterations, encrypted key check
 *   mfm-chg-<stamp>-<device>.enc        a batch of record changes from one device
 *   mfm-snap-<stamp>-<device>.enc       full state (daily backup + bootstrap/compaction point)
 *   mfm-att-<attachmentId>.enc          one attachment's bytes (immutable)
 * Every .enc file is AES-256-GCM under the sync key, derived from the user's
 * sync password (PBKDF2). Google never sees readable data.
 *
 * Merge rule per record (L = local fingerprint, B = fingerprint at last sync,
 * R = incoming fingerprint, null = deleted):
 *   R == L            → nothing to do
 *   L == B            → only the other device changed it → take theirs
 *   otherwise         → both changed it → CONFLICT: newer updatedAt wins, except
 *                       that an edit always beats a delete (never silently lose
 *                       an edit); the losing version is saved in syncConflicts.
 * Derived figures are never merged — rebuildDerived() recomputes them.
 */

import { db, newId, nowISO, todayISO } from '../db/schema';
import { rebuildDerived } from '../db/rebuild';
import { getDek } from '../db/keyring';
import { getVault } from '../db/security';
import {
  randomBytes, toB64, fromB64, utf8, fromUtf8, encryptBytes, decryptBytes, deriveKeyBytes, importAesKey, KDF_ITERATIONS, type Bytes,
} from '../engine/crypto';
import { SYNC_TABLES, DERIVED, exportRow, fingerprint, baseKey, type SyncTable } from './canonical';
import type { RemoteFile, RemoteStore } from './store';
import type { Attachment, SyncConflict } from '../db/types';

export const META_NAME = 'mfm-meta.json';
const CHG = 'mfm-chg-';
const SNAP = 'mfm-snap-';
const ATT = 'mfm-att-';
export const KEEP_SNAPSHOTS = 7;

type Row = Record<string, unknown> & { id: string; updatedAt?: string };
interface Item {
  t: SyncTable;
  id: string;
  row?: Row; // absent = deleted
}

export interface SyncCtx {
  store: RemoteStore;
  key: CryptoKey;
  deviceId: string;
}

// ——— encryption of remote files ———

async function seal(key: CryptoKey, obj: unknown): Promise<Bytes> {
  const { iv, data } = await encryptBytes(key, utf8(JSON.stringify(obj)));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return out;
}

async function open<T>(key: CryptoKey, bytes: Uint8Array): Promise<T> {
  const b = new Uint8Array(bytes);
  return JSON.parse(fromUtf8(await decryptBytes(key, b.slice(0, 12), b.slice(12)))) as T;
}

const stamp = () => nowISO().replace(/[-:.]/g, '');

// ——— connecting ———

interface Meta {
  format: 'mfm-sync';
  version: 1;
  createdAt: string;
  kdf: { salt: string; iterations: number };
  check: string; // b64 of seal(key, 'mfm-ok')
}

/**
 * First device: creates the remote folder content protected by `password`.
 * Other devices: verify `password` against it (wrong → SYNC_BAD_PASSWORD).
 * Returns the raw key bytes for the caller to store (wrapped) on this device.
 */
export async function connectRemote(store: RemoteStore, password: string, iterations = KDF_ITERATIONS): Promise<{ raw: Bytes; created: boolean }> {
  if (password.length < 8) throw new Error('SYNC_PASSWORD_TOO_SHORT');
  const files = await store.list();
  const metaFile = files.find((f) => f.name === META_NAME);
  if (metaFile) {
    const meta = JSON.parse(fromUtf8(new Uint8Array(await store.read(metaFile.id)))) as Meta;
    if (meta.format !== 'mfm-sync') throw new Error('SYNC_FOREIGN_DATA');
    if (meta.version > 1) throw new Error('SYNC_NEWER_VERSION');
    const raw = await deriveKeyBytes(password, fromB64(meta.kdf.salt), meta.kdf.iterations);
    try {
      if ((await open<string>(await importAesKey(raw), fromB64(meta.check))) !== 'mfm-ok') throw new Error();
    } catch {
      throw new Error('SYNC_BAD_PASSWORD');
    }
    return { raw, created: false };
  }
  const salt = randomBytes(16);
  const raw = await deriveKeyBytes(password, salt, iterations);
  const meta: Meta = {
    format: 'mfm-sync',
    version: 1,
    createdAt: nowISO(),
    kdf: { salt: toB64(salt), iterations },
    check: toB64(await seal(await importAesKey(raw), 'mfm-ok')),
  };
  await store.write(META_NAME, utf8(JSON.stringify(meta)));
  return { raw, created: true };
}

// ——— local state helpers ———

const table = (t: SyncTable) => db.table(t);

async function loadBase(): Promise<Map<string, string>> {
  return new Map((await db.syncBase.toArray()).map((e) => [e.key, e.h]));
}

async function state() {
  const s = await db.syncState.get('sync');
  if (!s) throw new Error('SYNC_NOT_CONNECTED');
  return s;
}

/** Records changed (or deleted) locally since the last sync. */
export async function localChanges(): Promise<Item[]> {
  const base = await loadBase();
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const t of SYNC_TABLES) {
    for (const row of (await table(t).toArray()) as Row[]) {
      const k = baseKey(t, row.id);
      seen.add(k);
      if (base.get(k) !== fingerprint(t, row)) items.push({ t, id: row.id, row: exportRow(t, row) as Row });
    }
  }
  for (const k of base.keys()) {
    if (seen.has(k)) continue;
    const i = k.indexOf(':');
    items.push({ t: k.slice(0, i) as SyncTable, id: k.slice(i + 1) });
  }
  return items;
}

export async function pendingCount(): Promise<number> {
  return (await localChanges()).length;
}

// ——— attachments content ———

async function localAttachmentBytes(a: Attachment): Promise<Bytes> {
  const bytes = new Uint8Array(await a.data.arrayBuffer());
  if (!a.encrypted) return bytes;
  const dek = getDek();
  if (!dek) throw new Error('APP_LOCKED');
  return decryptBytes(dek, fromB64(a.iv!), bytes);
}

async function uploadAttachmentContents(ctx: SyncCtx, items: Item[], remote: RemoteFile[]) {
  const have = new Set(remote.map((f) => f.name));
  for (const it of items) {
    if (it.t !== 'attachments' || !it.row) continue;
    const name = `${ATT}${it.id}.enc`;
    if (have.has(name)) continue; // contents are immutable
    const a = await db.attachments.get(it.id);
    if (!a) continue;
    await ctx.store.write(name, await seal(ctx.key, toB64(await localAttachmentBytes(a))));
  }
}

/** Fetch and re-key incoming attachment bytes BEFORE the merge transaction (network/crypto can't run inside it). */
async function prepareAttachments(ctx: SyncCtx, items: Item[], remote: RemoteFile[]): Promise<Map<string, Pick<Attachment, 'data' | 'iv' | 'encrypted'>>> {
  const out = new Map<string, Pick<Attachment, 'data' | 'iv' | 'encrypted'>>();
  const byName = new Map(remote.map((f) => [f.name, f.id]));
  const vault = await getVault();
  const dek = getDek();
  for (const it of items) {
    if (it.t !== 'attachments' || !it.row) continue;
    if (await db.attachments.get(it.id)) continue; // content never changes; keep ours
    const fileId = byName.get(`${ATT}${it.id}.enc`);
    if (!fileId) continue;
    const plain = fromB64(await open<string>(ctx.key, await ctx.store.read(fileId)));
    if (vault) {
      if (!dek) throw new Error('APP_LOCKED');
      const { iv, data } = await encryptBytes(dek, plain);
      out.set(it.id, { data: new Blob([data]), iv: toB64(iv), encrypted: true });
    } else {
      out.set(it.id, { data: new Blob([plain], { type: String(it.row.mime ?? '') }), iv: null, encrypted: false });
    }
  }
  return out;
}

// ——— merging ———

/** Neutral starting values for derived fields of a record that is new on this device. */
const DERIVED_DEFAULTS: Partial<Record<SyncTable, Record<string, unknown>>> = {
  accounts: { currentBalanceMinor: 0 },
  debts: { remainingMinor: 0, status: 'open' },
  savingsGoals: { savedMinor: 0, status: 'active', autoLastMonth: null },
  investments: { quantityMicro: 0, costBasisMinor: 0, realizedMinor: 0, lastPriceMinor: null, lastPriceDate: null, status: 'active' },
  investmentTxns: { realizedMinor: 0, costRemovedMinor: 0 },
  assets: { valueMinor: 0, valuationDate: '' },
  recurringObligations: { lastProcessed: null },
};

function withLocalDerived(t: SyncTable, incoming: Row, local: Row | undefined, content?: Pick<Attachment, 'data' | 'iv' | 'encrypted'>): Row {
  const derived: Record<string, unknown> = { ...(DERIVED_DEFAULTS[t] ?? {}) };
  if (local) for (const f of DERIVED[t] ?? []) derived[f] = local[f];
  if (t === 'recurringObligations' && !local) {
    // a schedule new to this device: don't replay past occurrences (fixed ids dedupe the rest)
    derived.lastProcessed = todayISO();
  }
  return { ...derived, ...(content ?? {}), ...incoming } as Row;
}

/**
 * Apply incoming records with the three-way rule. `snapshotKeys` (snapshot
 * merges only) lists every record the snapshot contains: synced records absent
 * from it were deleted remotely.
 */
async function merge(items: Item[], attachments: Map<string, Pick<Attachment, 'data' | 'iv' | 'encrypted'>>, snapshotKeys?: Set<string>): Promise<number> {
  const conflicts: SyncConflict[] = [];
  let applied = 0;
  await db.transaction('rw', [...SYNC_TABLES.map(table), db.syncBase, db.syncConflicts], async () => {
    const base = await loadBase();
    const all = [...items];
    if (snapshotKeys) {
      for (const k of base.keys()) {
        if (snapshotKeys.has(k)) continue;
        const i = k.indexOf(':');
        all.push({ t: k.slice(0, i) as SyncTable, id: k.slice(i + 1) });
      }
    }
    for (const it of all) {
      const k = baseKey(it.t, it.id);
      const local = (await table(it.t).get(it.id)) as Row | undefined;
      const L = local ? fingerprint(it.t, local) : null;
      const B = base.get(k) ?? null;
      const R = it.row ? fingerprint(it.t, it.row) : null;
      if (R === L) {
        await setBase(k, R);
        continue;
      }
      if (L === B || (it.t === 'attachments' && it.row && !local)) {
        await put(it, local);
        applied++;
      } else if (R !== B) {
        // both sides changed this record since the last sync
        const remoteWins = !local ? true : !it.row ? false : String(it.row.updatedAt ?? '') > String(local.updatedAt ?? '');
        conflicts.push({
          id: newId(), createdAt: nowISO(), table: it.t, rowId: it.id, kept: remoteWins ? 'remote' : 'local',
          local: local ? JSON.stringify(exportRow(it.t, local)) : null,
          remote: it.row ? JSON.stringify(it.row) : null,
          resolvedAt: null,
        });
        if (remoteWins) {
          await put(it, local);
          applied++;
        }
      }
      // remote unchanged vs base (R === B) but local changed → keep local; it will be pushed
      await setBase(k, R);
    }
    for (const c of conflicts) await db.syncConflicts.add(c);
  });
  return applied;

  async function put(it: Item, local: Row | undefined) {
    if (!it.row) await table(it.t).delete(it.id);
    else await table(it.t).put(withLocalDerived(it.t, it.row, local, attachments.get(it.id)));
  }
  async function setBase(k: string, h: string | null) {
    if (h === null) await db.syncBase.delete(k);
    else await db.syncBase.put({ key: k, h });
  }
}

// ——— the sync cycle ———

interface ChangeFile {
  kind: 'changes';
  deviceId: string;
  createdAt: string;
  items: Item[];
}

interface SnapshotFile {
  kind: 'snapshot';
  deviceId: string;
  createdAt: string;
  covers: string[];
  rows: Partial<Record<SyncTable, Row[]>>;
}

/** Download and merge everything other devices wrote since our last sync. */
export async function pull(ctx: SyncCtx): Promise<{ applied: number; conflicts: number; files: number }> {
  const s = await state();
  const remote = await ctx.store.list();
  const names = new Set(remote.map((f) => f.name));
  // decide on the FULL history first; pruning before this would fake a gap
  const prev = new Set(s.applied);
  let appliedSet = prev;
  const conflictsBefore = await db.syncConflicts.count();
  let applied = 0;
  let files = 0;

  const snaps = remote.filter((f) => f.name.startsWith(SNAP)).sort((a, b) => a.name.localeCompare(b.name));
  const latest = snaps[snaps.length - 1];
  if (latest && !prev.has(latest.name)) {
    const snap = await open<SnapshotFile>(ctx.key, await ctx.store.read(latest.id));
    const fresh = prev.size === 0;
    // a gap: the snapshot contains changes we never applied and can no longer download
    const gap = snap.covers.some((n) => !prev.has(n) && !names.has(n));
    if (fresh || gap) {
      const items: Item[] = [];
      const keys = new Set<string>();
      for (const t of SYNC_TABLES) for (const row of snap.rows[t] ?? []) {
        items.push({ t, id: row.id, row });
        keys.add(baseKey(t, row.id));
      }
      applied += await merge(items, await prepareAttachments(ctx, items, remote), keys);
      // replay every change made after the snapshot (including our own) on top of it
      appliedSet = new Set([...snap.covers, latest.name]);
      files++;
    } else {
      appliedSet = new Set([...prev, latest.name]); // seen; nothing new in it for us
    }
  }
  // forget files that no longer exist remotely (keeps the list bounded)
  appliedSet = new Set([...appliedSet].filter((n) => names.has(n)));

  const pending = remote
    .filter((f) => f.name.startsWith(CHG) && !appliedSet.has(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const f of pending) {
    const cf = await open<ChangeFile>(ctx.key, await ctx.store.read(f.id));
    applied += await merge(cf.items, await prepareAttachments(ctx, cf.items, remote));
    appliedSet.add(f.name);
    files++;
    // persist progress after each file so an interruption never re-applies or skips work
    await db.syncState.update('sync', { applied: [...appliedSet] });
  }
  await db.syncState.update('sync', { applied: [...appliedSet] });
  if (applied > 0) await rebuildDerived();
  return { applied, conflicts: (await db.syncConflicts.count()) - conflictsBefore, files };
}

/** Upload this device's changes since the last sync as one encrypted change file. */
export async function push(ctx: SyncCtx): Promise<number> {
  const s = await state();
  const items = await localChanges();
  if (!items.length) return 0;
  const remote = await ctx.store.list();
  await uploadAttachmentContents(ctx, items, remote);
  const name = `${CHG}${stamp()}-${ctx.deviceId}.enc`;
  const file: ChangeFile = { kind: 'changes', deviceId: ctx.deviceId, createdAt: nowISO(), items };
  await ctx.store.write(name, await seal(ctx.key, file));
  // only after the upload succeeded: these records now count as synced
  await db.transaction('rw', db.syncBase, db.syncState, db.syncQueue, async () => {
    for (const it of items) {
      const k = baseKey(it.t, it.id);
      if (it.row) await db.syncBase.put({ key: k, h: fingerprint(it.t, it.row) });
      else await db.syncBase.delete(k);
    }
    await db.syncState.update('sync', { applied: [...s.applied, name] });
    await db.syncQueue.clear(); // the outbox is fully reflected in Drive
  });
  return items.length;
}

/** Full encrypted state as a daily backup / bootstrap point; prunes old snapshots and covered change files. */
export async function snapshot(ctx: SyncCtx): Promise<string> {
  const s = await state();
  const rows: SnapshotFile['rows'] = {};
  for (const t of SYNC_TABLES) rows[t] = ((await table(t).toArray()) as Row[]).map((r) => exportRow(t, r) as Row);
  const remote = await ctx.store.list();
  await uploadAttachmentContents(ctx, (rows.attachments ?? []).map((r) => ({ t: 'attachments' as const, id: r.id, row: r })), remote);
  const covers = s.applied.filter((n) => n.startsWith(CHG));
  const name = `${SNAP}${stamp()}-${ctx.deviceId}.enc`;
  await ctx.store.write(name, await seal(ctx.key, { kind: 'snapshot', deviceId: ctx.deviceId, createdAt: nowISO(), covers, rows } satisfies SnapshotFile));
  await db.syncState.update('sync', { applied: [...s.applied, name], lastSnapshotAt: nowISO() });
  // retention: keep the newest KEEP_SNAPSHOTS; drop change files the oldest kept snapshot already contains
  const all = [...remote.filter((f) => f.name.startsWith(SNAP)), { id: '', name }].sort((a, b) => a.name.localeCompare(b.name));
  const drop = all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS));
  for (const f of drop) if (f.id) await ctx.store.remove(f.id);
  const oldestKept = all[Math.max(0, all.length - KEEP_SNAPSHOTS)];
  if (oldestKept?.id) {
    const kept = await open<SnapshotFile>(ctx.key, await ctx.store.read(oldestKept.id));
    const covered = new Set(kept.covers);
    for (const f of remote) if (f.name.startsWith(CHG) && covered.has(f.name)) await ctx.store.remove(f.id);
  }
  return name;
}

/** Pull, then push, then (once a day) snapshot. */
export async function syncOnce(ctx: SyncCtx, now = new Date()): Promise<{ pulled: number; pushed: number; conflicts: number; snapshot: string | null }> {
  const p = await pull(ctx);
  const pushed = await push(ctx);
  const s = await state();
  let snap: string | null = null;
  const today = now.toISOString().slice(0, 10);
  if (!s.lastSnapshotAt || s.lastSnapshotAt.slice(0, 10) < today) snap = await snapshot(ctx);
  await db.syncState.update('sync', { lastSyncAt: nowISO(), lastError: null, failures: 0 });
  return { pulled: p.applied, pushed, conflicts: p.conflicts, snapshot: snap };
}

// ——— restore points ———

export interface RestorePoint {
  id: string;
  name: string;
  createdAt: string; // parsed from the name
  deviceId: string;
}

export async function listRestorePoints(store: RemoteStore): Promise<RestorePoint[]> {
  return (await store.list())
    .filter((f) => f.name.startsWith(SNAP))
    .map((f) => {
      const m = /^mfm-snap-(\d{8})T(\d{6})\d*Z-(.+)\.enc$/.exec(f.name);
      const createdAt = m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z` : '';
      return { id: f.id, name: f.name, createdAt, deviceId: m?.[3] ?? '' };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Roll ALL devices back to a restore point: this device's synced data is
 * replaced by the snapshot, then pushed as ordinary edits, so the other devices
 * follow on their next sync. (Use the encrypted backup file to restore just one device offline.)
 */
export async function restorePoint(ctx: SyncCtx, point: RestorePoint): Promise<void> {
  await pull(ctx); // start from the latest shared state so the rollback is computed against it
  const snap = await open<SnapshotFile>(ctx.key, await ctx.store.read(point.id));
  const remote = await ctx.store.list();
  const items: Item[] = [];
  for (const t of SYNC_TABLES) for (const row of snap.rows[t] ?? []) items.push({ t, id: row.id, row });
  const contents = await prepareAttachmentsForRestore(ctx, items, remote);
  await db.transaction('rw', SYNC_TABLES.map(table), async () => {
    for (const t of SYNC_TABLES) {
      const keep = new Map((await table(t).toArray() as Row[]).map((r) => [r.id, r]));
      await table(t).clear();
      for (const row of snap.rows[t] ?? []) await table(t).put(withLocalDerived(t, row, keep.get(row.id), contents.get(row.id)));
    }
  });
  await rebuildDerived();
  await push(ctx); // the differences propagate the rollback
}

async function prepareAttachmentsForRestore(ctx: SyncCtx, items: Item[], remote: RemoteFile[]) {
  const out = new Map<string, Pick<Attachment, 'data' | 'iv' | 'encrypted'>>();
  for (const it of items) {
    if (it.t !== 'attachments') continue;
    const local = await db.attachments.get(it.id);
    if (local) out.set(it.id, { data: local.data, iv: local.iv, encrypted: local.encrypted });
  }
  const missing = items.filter((it) => it.t === 'attachments' && !out.has(it.id));
  for (const [id, v] of await prepareAttachments(ctx, missing, remote)) out.set(id, v);
  return out;
}

// ——— conflicts ———

/**
 * Make the version that lost a conflict the current one. It is stamped as a
 * fresh edit, so the next sync carries it to the other devices.
 */
export async function adoptOtherVersion(conflictId: string): Promise<void> {
  const c = await db.syncConflicts.get(conflictId);
  if (!c || c.resolvedAt) return;
  const t = c.table as SyncTable;
  const other = c.kept === 'local' ? c.remote : c.local;
  await db.transaction('rw', [table(t), db.splits, db.syncConflicts], async () => {
    const local = (await table(t).get(c.rowId)) as Row | undefined;
    if (other === null) {
      await table(t).delete(c.rowId);
      if (t === 'transactions') await db.splits.where('transactionId').equals(c.rowId).delete();
    } else {
      // attachment bytes are not part of a conflict record; only metadata of a file we still hold can return
      if (t === 'attachments' && !local) throw new Error('SYNC_CANNOT_RESTORE');
      await table(t).put(withLocalDerived(t, { ...(JSON.parse(other) as Row), updatedAt: nowISO() }, local));
    }
    await db.syncConflicts.update(c.id, { resolvedAt: nowISO() });
  });
  await rebuildDerived();
}

export async function dismissConflict(conflictId: string): Promise<void> {
  await db.syncConflicts.update(conflictId, { resolvedAt: nowISO() });
}
