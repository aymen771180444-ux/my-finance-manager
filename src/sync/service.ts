/**
 * Runs Google Drive sync in the app: connecting, background triggers, retry
 * with backoff, failure notifications, and the live status the UI shows.
 */
import Dexie from 'dexie';
import { db, newId, nowISO, todayISO } from '../db/schema';
import { rebuildDerived } from '../db/rebuild';
import { notifyOnce } from '../db/notifications';
import { importAesKey } from '../engine/crypto';
import { useApp } from '../store/app';
import { useLock } from '../store/lock';
import { SYNC_TABLES } from './canonical';
import { connectRemote, syncOnce, pendingCount, listRestorePoints, restorePoint, META_NAME, type RestorePoint, type SyncCtx } from './protocol';
import { DriveStore } from './googleDriveStore';
import { currentToken, requestToken, fetchEmail, revokeToken, clearToken } from './googleAuth';
import { saveSyncKey, loadSyncKey } from './keyStore';
import { useSync } from './status';

export { useSync };


const NOTIFY_AFTER_FAILURES = 3;

const tokenOrThrow = () => {
  const t = currentToken();
  if (!t) throw new Error('SYNC_AUTH_NEEDED');
  return t;
};
const driveStore = () => new DriveStore(tokenOrThrow);

async function context(): Promise<SyncCtx> {
  const s = await db.syncState.get('sync');
  if (!s) throw new Error('SYNC_NOT_CONNECTED');
  const raw = await loadSyncKey();
  if (raw === 'locked') throw new Error('APP_LOCKED');
  if (!raw) throw new Error('SYNC_NEEDS_PASSWORD');
  return { store: driveStore(), key: await importAesKey(raw), deviceId: s.deviceId };
}

/** Step 1 of connecting: Google account + Drive permission (from a tap). */
export async function signInGoogle(): Promise<string | null> {
  const t = await requestToken({ selectAccount: true });
  return fetchEmail(t);
}

export type JoinMode = 'new' | 'replace' | 'merge';

/** Does this device hold data the user entered (not just the starter profile/categories)? */
export async function localHasUserData(): Promise<boolean> {
  return (await db.accounts.count()) + (await db.transactions.count()) > 0;
}

/**
 * Step 2: create the encrypted sync space (first device) or join it with the
 * sync password (other devices). A device with no data of its own takes the
 * Drive copy as-is ('replace'); a device with data merges both ('merge').
 */
export async function connectDrive(password: string, email: string | null): Promise<JoinMode> {
  const store = driveStore();
  const { raw, created } = await connectRemote(store, password);
  const mode: JoinMode = created ? 'new' : (await localHasUserData()) ? 'merge' : 'replace';

  // replace: drop the starter profile/categories so they don't duplicate the synced ones — restored on failure
  const kept: Partial<Record<string, unknown[]>> = {};
  if (mode === 'replace') {
    for (const t of SYNC_TABLES) kept[t] = await db.table(t).toArray();
    await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.syncBase], async () => {
      for (const t of SYNC_TABLES) await db.table(t).clear();
      await db.syncBase.clear();
    });
  }
  await db.syncState.put({
    id: 'sync', deviceId: newId(), email, connectedAt: nowISO(), key: null, applied: [],
    lastSyncAt: null, lastSnapshotAt: null, lastError: null, failures: 0,
  });
  await saveSyncKey(raw);
  try {
    const result = await syncOnce(await context());
    useSync.setState({ phase: 'idle', lastResult: result, error: null });
    await fixActiveProfile();
  } catch (e) {
    if (mode === 'replace') {
      await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.syncBase, db.syncState], async () => {
        for (const t of SYNC_TABLES) {
          await db.table(t).clear();
          if (kept[t]?.length) await db.table(t).bulkAdd(kept[t]!);
        }
        await db.syncBase.clear();
        await db.syncState.delete('sync');
      });
      await rebuildDerived();
    } else {
      await db.syncState.delete('sync');
      await db.syncBase.clear();
    }
    throw e;
  }
  return mode;
}

/** Re-enter the sync password on this device (key lost, e.g. app lock removed while locked). */
export async function reenterPassword(password: string): Promise<void> {
  const { raw, created } = await connectRemote(driveStore(), password);
  if (created) throw new Error('SYNC_REMOTE_GONE');
  await saveSyncKey(raw);
  await syncNow({ interactive: true });
}

/** The active profile may have been replaced or deleted by sync. */
async function fixActiveProfile() {
  const app = useApp.getState();
  const active = app.settings?.activeProfileId;
  if (active && (await db.profiles.get(active))) return;
  const first = await db.profiles.orderBy('name').first();
  if (first) await app.setActiveProfile(first.id);
}

// ——— running a sync ———

let running: Promise<void> | null = null;
let retryAt = 0;

/**
 * Sync now. Background calls (`interactive: false`) never open Google popups
 * and respect the retry backoff; a tap may ask Google for a fresh token.
 */
export function syncNow(opts: { interactive?: boolean } = {}): Promise<void> {
  running ??= run(opts).finally(() => {
    running = null;
  });
  return running;
}

async function run({ interactive = false }: { interactive?: boolean }): Promise<void> {
  const s = await db.syncState.get('sync');
  if (!s) return;
  if (useLock.getState().status !== 'open') return;
  if (!interactive && Date.now() < retryAt) return;
  if (!currentToken()) {
    if (!interactive) {
      useSync.setState({ phase: 'needsAuth' });
      return;
    }
    await requestToken({ hint: s.email });
  }
  useSync.setState({ phase: 'syncing', error: null });
  try {
    const result = await syncOnce(await context());
    retryAt = 0;
    useSync.setState({ phase: 'idle', lastResult: result, error: null });
    await fixActiveProfile();
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    if (code === 'SYNC_AUTH_NEEDED') {
      clearToken();
      useSync.setState({ phase: 'needsAuth', error: null });
      return;
    }
    if (code === 'SYNC_NEEDS_PASSWORD') {
      useSync.setState({ phase: 'needsPassword', error: null });
      return;
    }
    if (code === 'APP_LOCKED') {
      useSync.setState({ phase: 'idle' });
      return;
    }
    const failures = (s.failures ?? 0) + 1;
    await db.syncState.update('sync', { lastError: code, failures });
    retryAt = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** (failures - 1));
    useSync.setState({ phase: 'error', error: code });
    const profileId = useApp.getState().settings?.activeProfileId;
    if (failures >= NOTIFY_AFTER_FAILURES && profileId) {
      await notifyOnce({ profileId, kind: 'sync', titleKey: 'notifications.syncFailed', params: {}, dedupe: `sync-fail:${todayISO()}` });
    }
    if (interactive) throw e;
  }
}

// ——— background triggers ———

let started = false;

/** Sync on start, on return to the app, when back online, every 5 minutes, and shortly after local edits. */
export function startSyncLoop(): void {
  if (started) return;
  started = true;
  const kick = () => void syncNow().catch(() => undefined);
  kick();
  window.addEventListener('focus', kick);
  window.addEventListener('online', () => {
    retryAt = 0;
    kick();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
  setInterval(kick, 5 * 60_000);
  useLock.subscribe((st, prev) => {
    if (st.status === 'open' && prev.status !== 'open') kick();
  });
  let debounce: ReturnType<typeof setTimeout> | undefined;
  Dexie.on('storagemutated', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (running) return; // our own writes during a sync
      void (async () => {
        if ((await db.syncState.get('sync')) && (await pendingCount()) > 0) kick();
      })();
    }, 15_000);
  });
}

// ——— restore points, disconnect ———

export async function restorePoints(): Promise<RestorePoint[]> {
  tokenOrThrow();
  return listRestorePoints(driveStore());
}

export async function rollBackTo(point: RestorePoint): Promise<void> {
  await restorePoint(await context(), point);
  await fixActiveProfile();
}

/** Stop syncing this device. Local data stays; Drive data stays unless `eraseDrive`. */
export async function disconnect(opts: { eraseDrive: boolean }): Promise<void> {
  if (opts.eraseDrive) {
    const store = driveStore();
    for (const f of await store.list()) await store.remove(f.id);
  }
  await db.transaction('rw', [db.syncState, db.syncBase, db.syncConflicts], async () => {
    await db.syncState.delete('sync');
    await db.syncBase.clear();
    await db.syncConflicts.clear();
  });
  await revokeToken();
  useSync.setState({ phase: 'idle', lastResult: null, error: null });
}

/** Get a token from a tap (used by the Reconnect button). */
export async function reconnectGoogle(): Promise<void> {
  const s = await db.syncState.get('sync');
  await requestToken({ hint: s?.email });
  await syncNow({ interactive: true });
}

/** After sign-in: does this Google account already hold synced data (join) or not (create)? */
export async function remoteExists(): Promise<boolean> {
  return (await driveStore().list()).some((f) => f.name === META_NAME);
}
