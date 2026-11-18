import { db, newId, nowISO } from './schema';
import type { AuditAction } from './types';

/**
 * Write an audit-log row and mirror the mutation into the sync outbox.
 * MUST be called inside the same Dexie transaction as the mutation itself.
 */
export async function recordMutation(opts: {
  profileId: string;
  table: string;
  rowId: string;
  action: AuditAction;
  before: unknown | null;
  after: unknown | null;
}): Promise<void> {
  const ts = nowISO();
  await db.auditLog.add({
    id: newId(),
    createdAt: ts,
    updatedAt: ts,
    profileId: opts.profileId,
    table: opts.table,
    rowId: opts.rowId,
    action: opts.action,
    before: opts.before === null ? null : JSON.stringify(opts.before),
    after: opts.after === null ? null : JSON.stringify(opts.after),
  });
  const op = opts.action === 'create' ? 'create' : opts.action === 'delete' ? 'delete' : 'update';
  await db.syncQueue.add({
    id: newId(),
    createdAt: ts,
    updatedAt: ts,
    profileId: opts.profileId,
    op,
    table: opts.table,
    rowId: opts.rowId,
    payload: opts.after === null ? 'null' : JSON.stringify(opts.after),
    status: 'pending',
    attempts: 0,
    lastError: null,
  });
}
