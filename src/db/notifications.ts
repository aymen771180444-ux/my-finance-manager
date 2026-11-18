import { db, newId, nowISO } from './schema';
import type { AppNotification, NotificationKind } from './types';

/**
 * Optional sink for device (system) notifications. The UI layer registers one
 * that translates and shows the notification when the user enabled it.
 */
type Sink = (n: AppNotification) => void;
let sink: Sink | null = null;
export const setNotificationSink = (fn: Sink | null) => {
  sink = fn;
};

/** Insert a notification unless one with the same dedupe key already exists. */
export async function notifyOnce(opts: {
  profileId: string;
  kind: NotificationKind;
  titleKey: string;
  params: Record<string, string | number>;
  dedupe: string;
  refId?: string | null;
}): Promise<boolean> {
  return db.transaction('rw', [db.notifications], async () => {
    const existing = await db.notifications.where('dedupe').equals(opts.dedupe).count();
    if (existing > 0) return false;
    const ts = nowISO();
    const row: AppNotification = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId: opts.profileId,
      kind: opts.kind,
      titleKey: opts.titleKey,
      params: JSON.stringify(opts.params),
      dedupe: opts.dedupe,
      refId: opts.refId ?? null,
      read: false,
    };
    await db.notifications.add(row);
    return row;
  }).then((row) => {
    if (row === false) return false;
    try {
      sink?.(row);
    } catch {
      /* a failing device notification must never break the app */
    }
    return true;
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  await db.notifications.update(id, { read: true, updatedAt: nowISO() });
}

export async function markAllRead(profileId: string): Promise<void> {
  const unread = await db.notifications.where('profileId').equals(profileId).filter((n) => !n.read).toArray();
  for (const n of unread) await db.notifications.update(n.id, { read: true, updatedAt: nowISO() });
}
