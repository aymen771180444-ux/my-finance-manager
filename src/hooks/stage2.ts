import { useLiveQuery } from 'dexie-react-hooks';
import { db, todayISO } from '../db/schema';
import { useActiveProfileId } from './data';
import { budgetStatus } from '../db/budgets';
import type { BudgetStatus } from '../engine/budgets';
import type { Budget } from '../db/types';

export function useBudgetsWithStatus(): { budget: Budget; status: BudgetStatus }[] {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      const budgets = await db.budgets.where('profileId').equals(profileId).toArray();
      const today = todayISO();
      const out = [] as { budget: Budget; status: BudgetStatus }[];
      for (const b of budgets.filter((x) => !x.isArchived)) {
        out.push({ budget: b, status: await budgetStatus(b, today) });
      }
      return out.sort((a, b) => a.budget.createdAt.localeCompare(b.budget.createdAt));
    }, [profileId]) ?? []
  );
}

export function useGoals() {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      const rows = await db.savingsGoals.where('profileId').equals(profileId).toArray();
      return rows.filter((g) => g.status !== 'archived').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }, [profileId]) ?? []
  );
}

export function useGoalContributions(goalId: string | null) {
  return (
    useLiveQuery(async () => {
      if (!goalId) return [];
      const rows = await db.savingsContributions.where('goalId').equals(goalId).toArray();
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    }, [goalId]) ?? []
  );
}

export function useDebts() {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      const rows = await db.debts.where('profileId').equals(profileId).toArray();
      return rows.sort((a, b) => (a.status === b.status ? (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') : a.status === 'open' ? -1 : 1));
    }, [profileId]) ?? []
  );
}

export function useDebtRepayments(debtId: string | null) {
  return (
    useLiveQuery(async () => {
      if (!debtId) return [];
      const rows = await db.transactions.where('debtId').equals(debtId).toArray();
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    }, [debtId]) ?? []
  );
}

export function useRecurring() {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      const rows = await db.recurringObligations.where('profileId').equals(profileId).toArray();
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }, [profileId]) ?? []
  );
}

export function useNotifications() {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return [];
      const rows = await db.notifications.where('profileId').equals(profileId).toArray();
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    }, [profileId]) ?? []
  );
}

export function useUnreadCount(): number {
  const profileId = useActiveProfileId();
  return (
    useLiveQuery(async () => {
      if (!profileId) return 0;
      return db.notifications.where('profileId').equals(profileId).filter((n) => !n.read).count();
    }, [profileId]) ?? 0
  );
}
