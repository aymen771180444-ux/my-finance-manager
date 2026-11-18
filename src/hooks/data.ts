import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { useApp } from '../store/app';
import type { Account, Category, Transaction } from '../db/types';

export function useActiveProfileId(): string | null {
  return useApp((s) => s.settings?.activeProfileId ?? null);
}

export function useProfiles() {
  return useLiveQuery(() => db.profiles.toArray(), []) ?? [];
}

/** Accounts owned by OR shared into the active profile. */
export function useAccounts(includeClosed = false): Account[] {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      const all = await db.accounts.toArray();
      return all
        .filter((a) => a.profileId === profileId || a.sharedWithProfileIds.includes(profileId))
        .filter((a) => includeClosed || a.status === 'active')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }, [profileId, includeClosed]) ?? []
  );
}

export function useAccount(id: string | null) {
  return useLiveQuery(() => (id ? db.accounts.get(id) : undefined), [id]);
}

export function useCategories(kind?: 'expense' | 'income'): Category[] {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      let rows = await db.categories.where('profileId').equals(profileId).toArray();
      rows = rows.filter((c) => !c.isArchived);
      if (kind) rows = rows.filter((c) => c.kind === kind);
      return rows;
    }, [profileId, kind]) ?? []
  );
}

export function useCategoryMap(): Map<string, Category> {
  const cats = useCategories();
  return new Map(cats.map((c) => [c.id, c]));
}

export interface TxnFilter {
  accountId?: string;
  categoryId?: string;
  type?: Transaction['type'];
  from?: string;
  to?: string;
  search?: string;
  tagId?: string;
  limit?: number;
}

export function useTransactions(filter: TxnFilter = {}): Transaction[] {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      let rows = await db.transactions.where('profileId').equals(profileId).toArray();
      if (filter.accountId) {
        rows = rows.filter((t) => t.accountId === filter.accountId || t.toAccountId === filter.accountId);
      }
      if (filter.categoryId) rows = rows.filter((t) => t.categoryId === filter.categoryId);
      if (filter.type) rows = rows.filter((t) => t.type === filter.type);
      if (filter.tagId) {
        const ids = new Set(
          (await db.transactionTags.where('[profileId+tagId]').equals([profileId, filter.tagId]).toArray()).map((l) => l.transactionId),
        );
        rows = rows.filter((t) => ids.has(t.id));
      }
      if (filter.from) rows = rows.filter((t) => t.date >= filter.from!);
      if (filter.to) rows = rows.filter((t) => t.date <= filter.to!);
      if (filter.search) {
        const q = filter.search.toLowerCase();
        rows = rows.filter(
          (t) =>
            t.notes.toLowerCase().includes(q) ||
            t.person.toLowerCase().includes(q) ||
            t.location.toLowerCase().includes(q),
        );
      }
      rows.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
      return filter.limit ? rows.slice(0, filter.limit) : rows;
    }, [profileId, filter.accountId, filter.categoryId, filter.type, filter.from, filter.to, filter.search, filter.tagId, filter.limit]) ?? []
  );
}

export function useLatestRates() {
  return useLiveQuery(async () => {
    const rows = await db.exchangeRates.toArray();
    const latest = new Map<string, number>();
    rows.sort((a, b) => a.date.localeCompare(b.date));
    for (const r of rows) latest.set(r.currency, r.rateToBase);
    return latest;
  }, []);
}
