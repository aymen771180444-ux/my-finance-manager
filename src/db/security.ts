import { db, nowISO } from './schema';
import type { Attachment, Vault } from './types';
import {
  deriveKey, generateDek, wrapDek, unwrapDek, keyFromSecretBytes, randomBytes, toB64, fromB64, encryptBytes, decryptBytes,
  KDF_ITERATIONS,
} from '../engine/crypto';
import type { Bytes } from '../engine/crypto';
import { setDek } from './keyring';
import { unwrapSyncKey } from '../sync/keyStore';

const VAULT_ID = 'vault';
const MAX_FREE_ATTEMPTS = 5;
const BIO_INFO = 'my-finance-manager/biometric-kek';

export const getVault = () => db.vault.get(VAULT_ID);

export function validatePin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
export function validateRecovery(pw: string): boolean {
  return pw.trim().length >= 8;
}

/** Wait time after repeated failures: 30s, 60s, 120s … capped at 15 min. */
export function backoffMs(failedAttempts: number): number {
  if (failedAttempts < MAX_FREE_ATTEMPTS) return 0;
  return Math.min(15 * 60_000, 30_000 * 2 ** (failedAttempts - MAX_FREE_ATTEMPTS));
}

/** Enable the app lock: create + wrap the DEK and encrypt existing attachments. */
export async function enableLock(pin: string, recovery: string, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  if (!validatePin(pin)) throw new Error('INVALID_PIN');
  if (!validateRecovery(recovery)) throw new Error('INVALID_RECOVERY');
  if (await getVault()) throw new Error('LOCK_ALREADY_ENABLED');
  const dek = await generateDek();
  const pinSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const ts = nowISO();
  const vault: Vault = {
    id: VAULT_ID,
    createdAt: ts,
    updatedAt: ts,
    iterations,
    pinSalt: toB64(pinSalt),
    pinWrapped: await wrapDek(dek, await deriveKey(pin, pinSalt, iterations)),
    recoverySalt: toB64(recoverySalt),
    recoveryWrapped: await wrapDek(dek, await deriveKey(recovery, recoverySalt, iterations)),
    pinLength: pin.length,
    biometric: null,
    autoLockMinutes: 10,
    failedAttempts: 0,
    lockedUntil: null,
  };
  // encrypt plaintext attachments first; if that fails nothing is half-enabled
  const plain = await db.attachments.filter((a) => !a.encrypted).toArray();
  const encrypted: Attachment[] = [];
  for (const a of plain) {
    const { iv, data } = await encryptBytes(dek, new Uint8Array(await a.data.arrayBuffer()));
    encrypted.push({ ...a, encrypted: true, iv: toB64(iv), data: new Blob([data]), updatedAt: ts });
  }
  await db.transaction('rw', [db.vault, db.attachments], async () => {
    await db.vault.put(vault);
    for (const a of encrypted) await db.attachments.put(a);
  });
  setDek(dek);
  return dek;
}

async function attempt(kind: 'pin' | 'recovery', secret: string): Promise<CryptoKey> {
  const v = await getVault();
  if (!v) throw new Error('LOCK_NOT_ENABLED');
  if (v.lockedUntil && v.lockedUntil > nowISO()) throw new Error(`LOCKED_OUT:${v.lockedUntil}`);
  try {
    const salt = fromB64(kind === 'pin' ? v.pinSalt : v.recoverySalt);
    const dek = await unwrapDek(kind === 'pin' ? v.pinWrapped : v.recoveryWrapped, await deriveKey(secret, salt, v.iterations));
    await db.vault.update(VAULT_ID, { failedAttempts: 0, lockedUntil: null });
    setDek(dek);
    return dek;
  } catch {
    const failed = v.failedAttempts + 1;
    const wait = backoffMs(failed);
    await db.vault.update(VAULT_ID, {
      failedAttempts: failed,
      lockedUntil: wait ? new Date(Date.now() + wait).toISOString() : null,
    });
    throw new Error(wait ? `LOCKED_OUT:${new Date(Date.now() + wait).toISOString()}` : `WRONG_SECRET:${MAX_FREE_ATTEMPTS - failed}`);
  }
}

export const unlockWithPin = (pin: string) => attempt('pin', pin);
export const unlockWithRecovery = (pw: string) => attempt('recovery', pw);

/** Change the PIN (requires the unlocked DEK). */
export async function changePin(dek: CryptoKey, newPin: string): Promise<void> {
  if (!validatePin(newPin)) throw new Error('INVALID_PIN');
  const v = await getVault();
  if (!v) throw new Error('LOCK_NOT_ENABLED');
  const salt = randomBytes(16);
  await db.vault.update(VAULT_ID, {
    pinSalt: toB64(salt),
    pinWrapped: await wrapDek(dek, await deriveKey(newPin, salt, v.iterations)),
    pinLength: newPin.length,
    updatedAt: nowISO(),
  });
}

export async function changeRecovery(dek: CryptoKey, recovery: string): Promise<void> {
  if (!validateRecovery(recovery)) throw new Error('INVALID_RECOVERY');
  const v = await getVault();
  if (!v) throw new Error('LOCK_NOT_ENABLED');
  const salt = randomBytes(16);
  await db.vault.update(VAULT_ID, {
    recoverySalt: toB64(salt),
    recoveryWrapped: await wrapDek(dek, await deriveKey(recovery, salt, v.iterations)),
    updatedAt: nowISO(),
  });
}

/** Turn the lock off: decrypt attachments back to plain storage and remove the vault. */
export async function disableLock(dek: CryptoKey): Promise<void> {
  await unwrapSyncKey(dek); // keep Google Drive sync working without the lock
  const enc = await db.attachments.filter((a) => a.encrypted).toArray();
  const plain: Attachment[] = [];
  for (const a of enc) {
    const bytes = await decryptBytes(dek, fromB64(a.iv!), new Uint8Array(await a.data.arrayBuffer()));
    plain.push({ ...a, encrypted: false, iv: null, data: new Blob([bytes], { type: a.mime }), updatedAt: nowISO() });
  }
  await db.transaction('rw', [db.vault, db.attachments], async () => {
    for (const a of plain) await db.attachments.put(a);
    await db.vault.delete(VAULT_ID);
  });
  setDek(null);
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  await db.vault.update(VAULT_ID, { autoLockMinutes: minutes, updatedAt: nowISO() });
}

// ——— biometric (WebAuthn PRF) ———

/** Store the DEK wrapped under a key derived from the authenticator's PRF output. */
export async function enrollBiometric(dek: CryptoKey, credentialId: string, prfSalt: Bytes, prfOutput: Bytes): Promise<void> {
  const wrapped = await wrapDek(dek, await keyFromSecretBytes(prfOutput, BIO_INFO));
  await db.vault.update(VAULT_ID, { biometric: { credentialId, prfSalt: toB64(prfSalt), wrapped }, updatedAt: nowISO() });
}

export async function unlockWithPrf(prfOutput: Bytes): Promise<CryptoKey> {
  const v = await getVault();
  if (!v?.biometric) throw new Error('BIOMETRIC_NOT_ENROLLED');
  const dek = await unwrapDek(v.biometric.wrapped, await keyFromSecretBytes(prfOutput, BIO_INFO));
  await db.vault.update(VAULT_ID, { failedAttempts: 0, lockedUntil: null });
  setDek(dek);
  return dek;
}

export async function removeBiometric(): Promise<void> {
  await db.vault.update(VAULT_ID, { biometric: null, updatedAt: nowISO() });
}
