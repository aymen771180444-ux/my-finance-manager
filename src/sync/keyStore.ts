/**
 * Where this device keeps the sync key after the user typed the sync password.
 *
 * With the app lock on, the key is stored encrypted under the lock's data key
 * (so it is only usable while unlocked). Without the lock it is stored as-is —
 * the same protection level as the rest of the unencrypted local database,
 * which the Security screen already explains.
 */
import { db } from '../db/schema';
import { getDek } from '../db/keyring';
import { encryptBytes, decryptBytes, toB64, fromB64, type Bytes } from '../engine/crypto';

// not imported from security.ts, which imports this file
const getVault = () => db.vault.get('vault');

export async function saveSyncKey(raw: Bytes): Promise<void> {
  const dek = getDek();
  if ((await getVault()) && dek) {
    const { iv, data } = await encryptBytes(dek, raw);
    await db.syncState.update('sync', { key: { wrapped: true, iv: toB64(iv), data: toB64(data) } });
  } else {
    await db.syncState.update('sync', { key: { wrapped: false, iv: null, data: toB64(raw) } });
  }
}

/** The raw key, 'locked' when it needs the app unlocked, or null when this device must re-enter the password. */
export async function loadSyncKey(): Promise<Bytes | 'locked' | null> {
  const s = await db.syncState.get('sync');
  if (!s?.key) return null;
  if (!s.key.wrapped) {
    const raw = fromB64(s.key.data);
    if ((await getVault()) && getDek()) await saveSyncKey(raw); // lock was turned on since: protect it now
    return raw;
  }
  if (!(await getVault())) return null; // lock removed without unwrapping: the key is unrecoverable
  const dek = getDek();
  if (!dek) return 'locked';
  try {
    return await decryptBytes(dek, fromB64(s.key.iv!), fromB64(s.key.data));
  } catch {
    return null;
  }
}

/** Called before the app lock is removed, while its data key is still in memory. */
export async function unwrapSyncKey(dek: CryptoKey): Promise<void> {
  const s = await db.syncState.get('sync');
  if (!s?.key?.wrapped) return;
  const raw = await decryptBytes(dek, fromB64(s.key.iv!), fromB64(s.key.data));
  await db.syncState.update('sync', { key: { wrapped: false, iv: null, data: toB64(raw) } });
}
