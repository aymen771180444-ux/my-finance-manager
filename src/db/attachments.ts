import { db, newId, nowISO } from './schema';
import type { Attachment, AttachmentOwner } from './types';
import { getDek } from './keyring';
import { getVault } from './security';
import { encryptBytes, decryptBytes, toB64, fromB64 } from '../engine/crypto';
import { recordMutation } from './audit';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Store a file. When the app lock is enabled the bytes are encrypted with the
 * vault data key; adding while locked is refused (the key is not in memory).
 */
export async function addAttachment(opts: {
  profileId: string;
  ownerType: AttachmentOwner;
  ownerId: string;
  name: string;
  blob: Blob;
}): Promise<Attachment> {
  if (opts.blob.size > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_TOO_LARGE');
  const vault = await getVault();
  const ts = nowISO();
  const mime = opts.blob.type || 'application/octet-stream';
  let row: Attachment = {
    id: newId(), createdAt: ts, updatedAt: ts, profileId: opts.profileId, ownerType: opts.ownerType, ownerId: opts.ownerId,
    name: opts.name, mime, size: opts.blob.size, encrypted: false, iv: null, data: opts.blob, deletedAt: null,
  };
  if (vault) {
    const dek = getDek();
    if (!dek) throw new Error('APP_LOCKED');
    const { iv, data } = await encryptBytes(dek, new Uint8Array(await opts.blob.arrayBuffer()));
    row = { ...row, encrypted: true, iv: toB64(iv), data: new Blob([data]) };
  }
  await db.transaction('rw', [db.attachments, db.auditLog, db.syncQueue], async () => {
    await db.attachments.add(row);
    await recordMutation({
      profileId: row.profileId, table: 'attachments', rowId: row.id, action: 'create', before: null,
      after: { id: row.id, name: row.name, mime: row.mime, size: row.size, ownerType: row.ownerType, ownerId: row.ownerId },
    });
  });
  return row;
}

/** Plaintext contents (decrypting when needed). */
export async function readAttachment(id: string): Promise<Blob> {
  const a = await db.attachments.get(id);
  if (!a) throw new Error('Attachment not found');
  if (!a.encrypted) return a.data;
  const dek = getDek();
  if (!dek) throw new Error('APP_LOCKED');
  const bytes = await decryptBytes(dek, fromB64(a.iv!), new Uint8Array(await a.data.arrayBuffer()));
  return new Blob([bytes], { type: a.mime });
}

export async function listAttachments(ownerType: AttachmentOwner, ownerId: string): Promise<Attachment[]> {
  const rows = await db.attachments.where('[ownerType+ownerId]').equals([ownerType, ownerId]).toArray();
  return rows.filter((a) => !a.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Soft delete into Trash (restorable for 90 days). */
export async function deleteAttachment(id: string): Promise<void> {
  return db.transaction('rw', [db.attachments, db.trash, db.auditLog, db.syncQueue], async () => {
    const a = await db.attachments.get(id);
    if (!a || a.deletedAt) return;
    const ts = nowISO();
    await db.attachments.update(id, { deletedAt: ts, updatedAt: ts });
    await db.trash.add({
      id: newId(), createdAt: ts, updatedAt: ts, profileId: a.profileId, table: 'attachments', rowId: id,
      payload: JSON.stringify({ id }), label: a.name, deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: a.profileId, table: 'attachments', rowId: id, action: 'delete', before: { name: a.name }, after: null });
  });
}

export async function restoreAttachment(trashId: string): Promise<void> {
  return db.transaction('rw', [db.attachments, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'attachments') throw new Error('Trash entry not found');
    const a = await db.attachments.get(entry.rowId);
    if (!a) throw new Error('Attachment not found');
    await db.attachments.update(a.id, { deletedAt: null, updatedAt: nowISO() });
    await db.trash.delete(trashId);
    await recordMutation({ profileId: a.profileId, table: 'attachments', rowId: a.id, action: 'restore', before: null, after: { name: a.name } });
  });
}

/**
 * Hard-delete attachments that are gone for good: soft-deleted ones whose
 * Trash entry expired, and ones whose owner no longer exists anywhere
 * (neither live nor restorable from Trash).
 */
export async function purgeAttachments(): Promise<number> {
  const all = await db.attachments.toArray();
  if (!all.length) return 0;
  const trash = await db.trash.toArray();
  const inTrash = new Set(trash.map((e) => e.rowId));
  const alive = new Set<string>();
  for (const t of [db.transactions, db.accounts, db.debts, db.investments, db.assets] as const) {
    for (const k of await (t as typeof db.transactions).toCollection().primaryKeys()) alive.add(k as string);
  }
  let n = 0;
  for (const a of all) {
    const expired = a.deletedAt && !inTrash.has(a.id);
    const orphan = !alive.has(a.ownerId) && !inTrash.has(a.ownerId);
    if (expired || orphan) {
      await db.attachments.delete(a.id);
      n++;
    }
  }
  return n;
}
