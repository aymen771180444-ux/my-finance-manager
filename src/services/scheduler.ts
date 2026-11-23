/**
 * Rule checks that generate in-app notifications. Called on app start, when
 * the app regains focus, and after transaction mutations. Everything is
 * deduped, so running it often is safe and cheap.
 *
 * PWA limitation (documented in Settings → Notifications): a web app cannot
 * wake itself up on a schedule without a push server, so summaries and
 * reminders are produced the next time the app is opened (catch-up).
 */

import { db, todayISO } from '../db/schema';
import { budgetStatus } from '../db/budgets';
import { processRecurring } from '../db/recurring';
import { processGoalAutoSave } from '../db/goalAutoSave';
import { notifyOnce } from '../db/notifications';
import { quietly } from '../db/audit';
import { daysBefore } from '../engine/recurring';
import { periodRange, previousPeriodRange } from '../engine/budgets';
import { summarize } from '../engine/analytics';
import { installmentDates } from '../engine/calendar';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '../db/types';

async function prefs(): Promise<NotificationPrefs> {
  const s = await db.settings.get('settings');
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(s?.notificationPrefs ?? {}) };
}

/** Budget threshold alerts (50/75/90/100) — one notification per budget+period+threshold. */
export async function checkBudgets(profileId: string, today = todayISO()): Promise<void> {
  const budgets = await db.budgets.where('profileId').equals(profileId).toArray();
  for (const b of budgets) {
    if (b.isArchived || !b.alertsEnabled) continue;
    if (b.endDate && today > b.endDate) continue;
    const status = await budgetStatus(b, today);
    if (status.crossed === null) continue;
    await notifyOnce({
      profileId,
      kind: 'budget',
      titleKey: status.crossed >= 100 ? 'notifications.budgetExceeded' : 'notifications.budgetThreshold',
      params: { name: b.name, pct: status.crossed },
      dedupe: `budget:${b.id}:${status.range.from}:${status.crossed}`,
      refId: b.id,
    });
  }
}

/** Debt due dates and installments: 3 days ahead, and when overdue. */
export async function checkDebts(profileId: string, today = todayISO()): Promise<void> {
  const debts = await db.debts.where('[profileId+status]').equals([profileId, 'open']).toArray();
  for (const d of debts) {
    if (d.dueDate && today > d.dueDate) {
      await notifyOnce({ profileId, kind: 'debt', titleKey: 'notifications.debtOverdue', params: { person: d.person }, dedupe: `debt-overdue:${d.id}:${d.dueDate}`, refId: d.id });
    } else if (d.dueDate && daysBefore(d.dueDate, 3) <= today) {
      await notifyOnce({ profileId, kind: 'debt', titleKey: 'notifications.debtDueSoon', params: { person: d.person, date: d.dueDate }, dedupe: `debt-soon:${d.id}:${d.dueDate}`, refId: d.id });
    }
    for (const date of installmentDates(d)) {
      if (date >= today && daysBefore(date, 3) <= today) {
        await notifyOnce({ profileId, kind: 'debt', titleKey: 'notifications.installmentSoon', params: { person: d.person, date }, dedupe: `inst:${d.id}:${date}`, refId: d.id });
      }
    }
  }
}

async function summaryParams(profileId: string, from: string, to: string) {
  const txns = await db.transactions.where('[profileId+date]').between([profileId, from], [profileId, to + '￿']).toArray();
  const s = summarize(txns, new Map(), new Map());
  return { incomeMinor: s.incomeMinor, expenseMinor: s.expenseMinor, count: txns.length };
}

/** Daily / weekly / monthly summaries of the last COMPLETED period, once each. */
export async function checkSummaries(profileId: string, p: NotificationPrefs, today = todayISO()): Promise<void> {
  const first = await db.transactions.where('[profileId+date]').between([profileId, ''], [profileId, '￿']).first();
  if (!first) return; // nothing recorded yet — nothing to summarize
  const runs: [boolean, 'daily' | 'weekly' | 'monthly', string][] = [
    [p.dailySummary, 'daily', 'notifications.dailySummary'],
    [p.weeklySummary, 'weekly', 'notifications.weeklySummary'],
    [p.monthlySummary, 'monthly', 'notifications.monthlySummary'],
  ];
  for (const [on, period, key] of runs) {
    if (!on) continue;
    const r = previousPeriodRange(period, today);
    if (r.to < first.date) continue; // period before any data
    await notifyOnce({ profileId, kind: 'summary', titleKey: key, params: { ...(await summaryParams(profileId, r.from, r.to)), from: r.from, to: r.to }, dedupe: `${period}:${r.from}` });
  }
}

/** "Did you record today's expenses?" after the chosen hour, if nothing was entered today. */
export async function checkDailyReminder(profileId: string, p: NotificationPrefs, now = new Date()): Promise<void> {
  if (!p.dailyReminder || now.getHours() < p.dailyReminderHour) return;
  const today = todayISO();
  const created = await db.transactions.where('profileId').equals(profileId).filter((t) => t.createdAt.slice(0, 10) === today || t.date === today).count();
  if (created > 0) return;
  await notifyOnce({ profileId, kind: 'reminder', titleKey: 'notifications.dailyReminder', params: {}, dedupe: `reminder:${today}` });
}

/** Weekly nudge when no backup was made in the last 7 days. */
export async function checkBackupReminder(profileId: string, p: NotificationPrefs, today = todayISO()): Promise<void> {
  if (!p.backupReminder) return;
  if ((await db.transactions.where('profileId').equals(profileId).count()) === 0) return;
  const s = await db.settings.get('settings');
  const last = s?.lastBackupAt?.slice(0, 10) ?? null;
  if (last && daysBefore(today, 7) < last) return;
  await notifyOnce({ profileId, kind: 'backup', titleKey: last ? 'notifications.backupStale' : 'notifications.backupNever', params: last ? { date: last } : {}, dedupe: `backup:${periodRange('weekly', today).from}` });
}

/** Full pass. Financial work (recurring auto-creation) always runs; alerts follow preferences. */
export async function runChecks(profileId: string): Promise<void> {
  // automatic work: no "saved" pop-ups (it reports through notifications instead)
  return quietly(() => runChecksNow(profileId));
}

async function runChecksNow(profileId: string): Promise<void> {
  try {
    const p = await prefs();
    await processRecurring(profileId, todayISO(), { notifyDue: p.bills, notifyCreated: p.recurring });
    await processGoalAutoSave(profileId, todayISO());
    if (p.budget) await checkBudgets(profileId);
    if (p.installments) await checkDebts(profileId);
    await checkSummaries(profileId, p);
    await checkDailyReminder(profileId, p);
    await checkBackupReminder(profileId, p);
  } catch (e) {
    // checks must never break the app; failures surface in the console only
    console.error('scheduler.runChecks failed', e);
  }
}
