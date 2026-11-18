import { db, newId, nowISO, todayISO } from './schema';
import type { RecurringObligation, RecurringFrequency } from './types';
import { recordMutation } from './audit';
import { createTransaction } from './transactions';
import { occurrencesBetween, nextDueDate, daysBefore } from '../engine/recurring';
import { notifyOnce } from './notifications';

export interface RecurringInput {
  profileId: string;
  name: string;
  kind: 'expense' | 'income';
  amountMinor: number;
  accountId: string;
  categoryId?: string | null;
  frequency: RecurringFrequency;
  interval?: number;
  startDate: string;
  endDate?: string | null;
  mode: 'auto' | 'remind';
  remindDaysBefore?: number;
}

export async function createRecurring(input: RecurringInput): Promise<RecurringObligation> {
  if (!input.name.trim()) throw new Error('Name is required');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Amount must be positive');
  }
  return db.transaction('rw', [db.recurringObligations, db.accounts, db.auditLog, db.syncQueue], async () => {
    const account = await db.accounts.get(input.accountId);
    if (!account) throw new Error('Account not found');
    const ts = nowISO();
    const row: RecurringObligation = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: input.profileId,
      name: input.name.trim(),
      kind: input.kind,
      amountMinor: input.amountMinor,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      frequency: input.frequency,
      interval: Math.max(1, input.interval ?? 1),
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      mode: input.mode,
      remindDaysBefore: input.remindDaysBefore ?? 3,
      /**
       * Occurrences before creation day are intentionally NOT back-filled;
       * an occurrence due TODAY still fires (afterDate is exclusive).
       */
      lastProcessed: input.startDate <= todayISO() ? daysBefore(todayISO(), 1) : null,
      status: 'active',
    };
    await db.recurringObligations.add(row);
    await recordMutation({ profileId: row.profileId, table: 'recurringObligations', rowId: row.id, action: 'create', before: null, after: row });
    return row;
  });
}

export async function updateRecurring(
  id: string,
  changes: Partial<Pick<RecurringObligation, 'name' | 'amountMinor' | 'mode' | 'remindDaysBefore' | 'endDate' | 'status' | 'categoryId'>>,
): Promise<void> {
  return db.transaction('rw', [db.recurringObligations, db.auditLog, db.syncQueue], async () => {
    const before = await db.recurringObligations.get(id);
    if (!before) throw new Error('Obligation not found');
    const after = { ...before, ...changes, updatedAt: nowISO() };
    await db.recurringObligations.put(after);
    await recordMutation({ profileId: before.profileId, table: 'recurringObligations', rowId: id, action: 'update', before, after });
  });
}

export async function deleteRecurring(id: string): Promise<void> {
  return db.transaction('rw', [db.recurringObligations, db.trash, db.auditLog, db.syncQueue], async () => {
    const row = await db.recurringObligations.get(id);
    if (!row) throw new Error('Obligation not found');
    await db.recurringObligations.delete(id);
    const ts = nowISO();
    await db.trash.add({
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: row.profileId,
      table: 'recurringObligations',
      rowId: id,
      payload: JSON.stringify({ row }),
      label: row.name,
      deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: row.profileId, table: 'recurringObligations', rowId: id, action: 'delete', before: row, after: null });
  });
}

export async function restoreRecurring(trashId: string): Promise<void> {
  return db.transaction('rw', [db.recurringObligations, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'recurringObligations') throw new Error('Trash entry not found');
    const { row } = JSON.parse(entry.payload) as { row: RecurringObligation };
    await db.recurringObligations.add(row);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: row.profileId, table: 'recurringObligations', rowId: row.id, action: 'restore', before: null, after: row });
  });
}

/**
 * Catch-up processing, called on app start and after returning to the app.
 * - auto mode: create the due transactions (idempotent via lastProcessed).
 * - remind mode: create a deduped notification for each due occurrence.
 * - both modes: upcoming-due reminders `remindDaysBefore` ahead.
 * Returns how many transactions were created.
 */
export async function processRecurring(
  profileId: string,
  today = todayISO(),
  opts: { notifyDue?: boolean; notifyCreated?: boolean } = {},
): Promise<number> {
  const { notifyDue = true, notifyCreated = true } = opts;
  const obligations = await db.recurringObligations
    .where('[profileId+status]')
    .equals([profileId, 'active'])
    .toArray();
  let created = 0;
  for (const ob of obligations) {
    const due = occurrencesBetween(ob, ob.lastProcessed, today);
    for (const date of due) {
      if (ob.mode === 'auto') {
        const fixedId = `rec:${ob.id}:${date}`;
        if (await db.transactions.get(fixedId)) continue; // already recorded by another synced device
        try {
          await createTransaction({
            id: fixedId,
            profileId,
            type: ob.kind,
            amountMinor: ob.amountMinor,
            accountId: ob.accountId,
            categoryId: ob.categoryId,
            date,
            notes: ob.name,
          });
          created++;
          if (notifyCreated) await notifyOnce({
            profileId,
            kind: 'recurring',
            titleKey: 'notifications.recurringCreated',
            params: { name: ob.name },
            dedupe: `rec-created:${ob.id}:${date}`,
            refId: ob.id,
          });
        } catch {
          // account missing etc. — fall back to a reminder instead of losing the event
          await notifyOnce({
            profileId,
            kind: 'recurring',
            titleKey: 'notifications.recurringDue',
            params: { name: ob.name },
            dedupe: `rec-due:${ob.id}:${date}`,
            refId: ob.id,
          });
        }
      } else if (notifyDue) {
        await notifyOnce({
          profileId,
          kind: 'recurring',
          titleKey: 'notifications.recurringDue',
          params: { name: ob.name },
          dedupe: `rec-due:${ob.id}:${date}`,
          refId: ob.id,
        });
      }
    }
    if (due.length > 0 || ob.lastProcessed === null) {
      await db.recurringObligations.update(ob.id, { lastProcessed: today, updatedAt: nowISO() });
    }
    // advance reminder for the NEXT occurrence
    const next = nextDueDate(ob, today);
    if (notifyDue && next && daysBefore(next, ob.remindDaysBefore) <= today) {
      await notifyOnce({
        profileId,
        kind: 'recurring',
        titleKey: 'notifications.recurringUpcoming',
        params: { name: ob.name, date: next },
        dedupe: `rec-soon:${ob.id}:${next}`,
        refId: ob.id,
      });
    }
  }
  return created;
}
