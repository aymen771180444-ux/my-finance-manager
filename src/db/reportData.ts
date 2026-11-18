import { db } from './schema';
import type { ReportData } from '../engine/reports';
import type { SplitLine } from '../engine/analytics';
import type { Account } from './types';

/** Accounts owned by or explicitly shared into the profile, each once. */
export async function profileAccounts(profileId: string): Promise<Account[]> {
  const all = await db.accounts.toArray();
  return all.filter((a) => a.profileId === profileId || a.sharedWithProfileIds.includes(profileId));
}

export async function latestRatesMap(): Promise<Map<string, number>> {
  const rows = await db.exchangeRates.toArray();
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.currency, r.rateToBase);
  return m;
}

/**
 * Load everything the analytics/report engines need for a profile and date
 * window (inclusive). Pass from = '' to load the whole history.
 */
export async function loadReportData(
  profileId: string,
  from: string,
  to: string,
  tagId: string | null = null,
): Promise<ReportData> {
  const txns = await db.transactions
    .where('[profileId+date]')
    .between([profileId, from], [profileId, to + '￿'])
    .toArray();
  const splitParents = txns.filter((t) => t.hasSplits).map((t) => t.id);
  const splitsByTxn = new Map<string, SplitLine[]>();
  if (splitParents.length) {
    for (const s of await db.splits.where('transactionId').anyOf(splitParents).toArray()) {
      const arr = splitsByTxn.get(s.transactionId) ?? [];
      arr.push({ categoryId: s.categoryId, amountMinor: s.amountMinor });
      splitsByTxn.set(s.transactionId, arr);
    }
  }
  const cats = new Map((await db.categories.where('profileId').equals(profileId).toArray()).map((c) => [c.id, c]));
  const accounts = await profileAccounts(profileId);
  const debts = await db.debts.where('profileId').equals(profileId).toArray();
  let taggedTxnIds: Set<string> | null = null;
  if (tagId) {
    const links = await db.transactionTags.where('[profileId+tagId]').equals([profileId, tagId]).toArray();
    taggedTxnIds = new Set(links.map((l) => l.transactionId));
  }
  const investments = await db.investments.where('profileId').equals(profileId).toArray();
  const assets = await db.assets.where('profileId').equals(profileId).toArray();
  return { txns, splitsByTxn, cats, accounts, debts, latestRates: await latestRatesMap(), taggedTxnIds, investments, assets };
}
