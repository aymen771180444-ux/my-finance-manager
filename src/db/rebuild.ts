import { db } from './schema';
import { compilePostings } from '../engine/posting';
import { recomputeInvestment } from './investmentCache';

/**
 * Recompute every cached (derived) figure from its source records:
 *   account balance   = opening balance + all postings
 *   debt remaining    = principal − recorded repayments
 *   goal saved        = sum of contributions
 *   investment caches = replay of buy/sell/valuation history
 *   asset value       = latest valuation by date
 * Used after merging records from another device (sync never copies derived
 * figures, it recomputes them) and as a repair tool. Never touches updatedAt.
 */
export async function rebuildDerived(): Promise<{ changed: number }> {
  let changed = 0;
  await db.transaction(
    'rw',
    [db.accounts, db.transactions, db.debts, db.debtRepayments, db.savingsGoals, db.savingsContributions, db.investments, db.investmentTxns, db.assets, db.assetValuations],
    async () => {
      const debts = await db.debts.toArray();
      const dir = new Map(debts.map((d) => [d.id, d.direction]));

      // accounts
      const balances = new Map<string, number>();
      for (const a of await db.accounts.toArray()) balances.set(a.id, a.openingBalanceMinor);
      for (const t of await db.transactions.toArray()) {
        const debtDirection = t.type === 'debt_repayment' ? dir.get(t.debtId ?? '') ?? null : null;
        if (t.type === 'debt_repayment' && !debtDirection) continue; // orphaned repayment: no balance effect
        for (const p of compilePostings({ ...t, debtDirection })) {
          if (balances.has(p.accountId)) balances.set(p.accountId, balances.get(p.accountId)! + p.deltaMinor);
        }
      }
      for (const a of await db.accounts.toArray()) {
        const b = balances.get(a.id)!;
        if (b !== a.currentBalanceMinor) {
          await db.accounts.update(a.id, { currentBalanceMinor: b });
          changed++;
        }
      }

      // debts
      const repaid = new Map<string, number>();
      for (const r of await db.debtRepayments.toArray()) repaid.set(r.debtId, (repaid.get(r.debtId) ?? 0) + r.amountMinor);
      for (const d of debts) {
        const remaining = Math.max(0, d.principalMinor - (repaid.get(d.id) ?? 0));
        const status = remaining === 0 ? 'settled' : 'open';
        if (remaining !== d.remainingMinor || status !== d.status) {
          await db.debts.update(d.id, { remainingMinor: remaining, status });
          changed++;
        }
      }

      // savings goals
      const saved = new Map<string, number>();
      for (const c of await db.savingsContributions.toArray()) saved.set(c.goalId, (saved.get(c.goalId) ?? 0) + c.amountMinor);
      for (const g of await db.savingsGoals.toArray()) {
        const s = saved.get(g.id) ?? 0;
        const status = g.status === 'archived' ? 'archived' : s >= g.targetMinor ? 'completed' : 'active';
        if (s !== g.savedMinor || status !== g.status) {
          await db.savingsGoals.update(g.id, { savedMinor: s, status });
          changed++;
        }
      }

      // investments (an impossible merged history keeps its last good cache)
      for (const inv of await db.investments.toArray()) {
        try {
          await recomputeInvestment(inv.id, { touch: false });
        } catch {
          /* INSUFFICIENT_QUANTITY after a conflicting merge — surfaced by the sync conflict list */
        }
      }

      // assets
      const latest = new Map<string, { valueMinor: number; date: string; createdAt: string }>();
      for (const v of await db.assetValuations.toArray()) {
        const cur = latest.get(v.assetId);
        if (!cur || v.date > cur.date || (v.date === cur.date && v.createdAt > cur.createdAt)) latest.set(v.assetId, v);
      }
      for (const a of await db.assets.toArray()) {
        const l = latest.get(a.id);
        if (l && (l.valueMinor !== a.valueMinor || l.date !== a.valuationDate)) {
          await db.assets.update(a.id, { valueMinor: l.valueMinor, valuationDate: l.date });
          changed++;
        }
      }
    },
  );
  return { changed };
}
