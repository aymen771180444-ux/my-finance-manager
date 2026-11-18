/**
 * Encrypted full backup / restore (PRD §24).
 *
 * File format (.mfm, JSON envelope):
 *   { format, version, createdAt, kdf: {name, hash, iterations, salt},
 *     cipher: {name, iv}, sha256, data }
 * `data` is AES-GCM ciphertext of the UTF-8 JSON payload under a key derived
 * from a backup password (PBKDF2-SHA-256). `sha256` is the hash of the
 * plaintext — checked after decryption so corruption is caught even if a
 * future cipher change weakened authentication. The backup password is
 * independent of the device PIN, so a backup restores on any device.
 *
 * Attachments are stored DECRYPTED inside the (encrypted) payload, then
 * re-encrypted with the target device's key on restore.
 */

import { db, nowISO } from './schema';
import { getDek } from './keyring';
import { getVault } from './security';
import {
  deriveKey, encryptBytes, decryptBytes, randomBytes, toB64, fromB64, sha256Hex, utf8, fromUtf8, KDF_ITERATIONS, type Bytes,
} from '../engine/crypto';
import type { Attachment } from './types';

export const BACKUP_FORMAT = 'my-finance-manager-backup';
export const BACKUP_VERSION = 1;

/** Tables carried in a backup. Device-local state (vault, sync outbox) is not. */
export const BACKUP_TABLES = [
  'profiles', 'accounts', 'transactions', 'splits', 'categories', 'tags', 'transactionTags', 'exchangeRates',
  'auditLog', 'trash', 'settings', 'budgets', 'savingsGoals', 'savingsContributions', 'debts', 'debtRepayments',
  'recurringObligations', 'notifications', 'investments', 'investmentTxns', 'assets', 'assetValuations',
] as const;
type TableName = (typeof BACKUP_TABLES)[number];

interface AttachmentRecord extends Omit<Attachment, 'data' | 'encrypted' | 'iv'> {
  dataB64: string;
}

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<TableName, Record<string, unknown>[]>;
  attachments: AttachmentRecord[];
}

interface Envelope {
  format: string;
  version: number;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  sha256: string;
  data: string;
}

const table = (name: string) => db.table(name);

export async function buildPayload(): Promise<BackupPayload> {
  const tables = {} as BackupPayload['tables'];
  const counts: Record<string, number> = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await table(name).toArray();
    counts[name] = tables[name].length;
  }
  const attachments: AttachmentRecord[] = [];
  const dek = getDek();
  for (const a of await db.attachments.toArray()) {
    let bytes = new Uint8Array(await a.data.arrayBuffer());
    if (a.encrypted) {
      if (!dek) throw new Error('APP_LOCKED');
      bytes = await decryptBytes(dek, fromB64(a.iv!), bytes);
    }
    const { data: _data, encrypted: _e, iv: _iv, ...meta } = a;
    attachments.push({ ...meta, dataB64: toB64(bytes) });
  }
  counts.attachments = attachments.length;
  return { format: BACKUP_FORMAT, schemaVersion: db.verno, exportedAt: nowISO(), counts, tables, attachments };
}

export async function encryptPayload(payload: BackupPayload, password: string, iterations = KDF_ITERATIONS): Promise<string> {
  if (password.length < 8) throw new Error('BACKUP_PASSWORD_TOO_SHORT');
  const plain = utf8(JSON.stringify(payload));
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, iterations);
  const { iv, data } = await encryptBytes(key, plain);
  const env: Envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: payload.exportedAt,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    sha256: await sha256Hex(plain),
    data: toB64(data),
  };
  return JSON.stringify(env);
}

/** Full encrypted backup as file text; records the backup date. */
export async function createBackup(password: string, iterations = KDF_ITERATIONS): Promise<{ text: string; counts: Record<string, number> }> {
  const payload = await buildPayload();
  const text = await encryptPayload(payload, password, iterations);
  const s = await db.settings.get('settings');
  if (s) await db.settings.update('settings', { lastBackupAt: payload.exportedAt });
  return { text, counts: payload.counts };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Decrypt and fully validate a backup WITHOUT touching current data.
 * Errors: BACKUP_NOT_A_BACKUP, BACKUP_NEWER_VERSION, BACKUP_BAD_PASSWORD, BACKUP_CORRUPT.
 */
export async function openBackup(text: string, password: string): Promise<BackupPayload> {
  let env: Envelope;
  try {
    env = JSON.parse(text);
  } catch {
    throw new Error('BACKUP_NOT_A_BACKUP');
  }
  if (!isObj(env) || env.format !== BACKUP_FORMAT || !env.kdf?.salt || !env.cipher?.iv || typeof env.data !== 'string') {
    throw new Error('BACKUP_NOT_A_BACKUP');
  }
  if (env.version > BACKUP_VERSION) throw new Error('BACKUP_NEWER_VERSION');
  let plain: Bytes;
  try {
    const key = await deriveKey(password, fromB64(env.kdf.salt), env.kdf.iterations);
    plain = await decryptBytes(key, fromB64(env.cipher.iv), fromB64(env.data));
  } catch {
    // AES-GCM cannot tell a wrong password from tampering; both fail here
    throw new Error('BACKUP_BAD_PASSWORD');
  }
  if ((await sha256Hex(plain)) !== env.sha256) throw new Error('BACKUP_CORRUPT');
  let payload: BackupPayload;
  try {
    payload = JSON.parse(fromUtf8(plain));
  } catch {
    throw new Error('BACKUP_CORRUPT');
  }
  validatePayload(payload);
  return payload;
}

export function validatePayload(p: BackupPayload): void {
  if (!isObj(p) || p.format !== BACKUP_FORMAT || !isObj(p.tables) || !Array.isArray(p.attachments)) throw new Error('BACKUP_CORRUPT');
  if (p.schemaVersion > db.verno) throw new Error('BACKUP_NEWER_VERSION');
  for (const name of BACKUP_TABLES) {
    const rows = p.tables[name] ?? [];
    if (!Array.isArray(rows) || rows.some((r) => !isObj(r) || typeof r.id !== 'string')) throw new Error('BACKUP_CORRUPT');
    if (p.counts?.[name] !== undefined && p.counts[name] !== rows.length) throw new Error('BACKUP_CORRUPT');
  }
  if ((p.tables.profiles ?? []).length === 0) throw new Error('BACKUP_CORRUPT');
  for (const a of p.attachments) if (typeof a.id !== 'string' || typeof a.dataB64 !== 'string') throw new Error('BACKUP_CORRUPT');
}

/**
 * Replace ALL data with the backup, atomically. The device's own security
 * (vault) is kept; attachments are re-encrypted under it when a lock is set.
 */
export async function restorePayload(p: BackupPayload): Promise<void> {
  validatePayload(p);
  const vault = await getVault();
  const dek = getDek();
  if (vault && !dek) throw new Error('APP_LOCKED');
  // prepare attachments outside the DB transaction (crypto is async/non-IDB)
  const attachments: Attachment[] = [];
  for (const a of p.attachments) {
    const { dataB64, ...meta } = a;
    const bytes = fromB64(dataB64);
    if (vault && dek) {
      const { iv, data } = await encryptBytes(dek, bytes);
      attachments.push({ ...meta, encrypted: true, iv: toB64(iv), data: new Blob([data]) } as Attachment);
    } else {
      attachments.push({ ...meta, encrypted: false, iv: null, data: new Blob([bytes], { type: meta.mime }) } as Attachment);
    }
  }
  const tables = [...BACKUP_TABLES.map(table), db.attachments, db.syncQueue];
  await db.transaction('rw', tables, async () => {
    for (const name of BACKUP_TABLES) {
      await table(name).clear();
      const rows = p.tables[name] ?? [];
      if (rows.length) await table(name).bulkAdd(rows);
    }
    await db.attachments.clear();
    if (attachments.length) await db.attachments.bulkAdd(attachments);
    await db.syncQueue.clear(); // outbox belonged to the replaced data
    // backups made before repayment history existed (schema < 4): rebuild it
    if (p.schemaVersion < 4 && !(p.tables.debtRepayments ?? []).length) {
      const repayments = ((p.tables.transactions ?? []) as { id: string; type: string; profileId: string; debtId: string | null; amountMinor: number; date: string; createdAt: string }[])
        .filter((t) => t.type === 'debt_repayment' && t.debtId);
      for (const t of repayments) {
        await db.debtRepayments.add({
          id: crypto.randomUUID(), createdAt: t.createdAt, updatedAt: t.createdAt, profileId: t.profileId,
          debtId: t.debtId!, amountMinor: t.amountMinor, date: t.date, txnId: t.id, notes: '',
        });
      }
    }
  });
}
