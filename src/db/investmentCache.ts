import { db, nowISO } from './schema';
import { replay } from '../engine/investments';

/**
 * Recompute an investment's cached holding from its full history and store the
 * per-sell realized figures. Throws INSUFFICIENT_QUANTITY when the history is
 * impossible (e.g. removing a buy that a later sell depends on); callers run
 * inside a Dexie transaction, so the throw rolls everything back.
 */
export async function recomputeInvestment(investmentId: string, opts: { touch?: boolean } = {}): Promise<void> {
  const { touch = true } = opts;
  const inv = await db.investments.get(investmentId);
  if (!inv) return;
  const txns = await db.investmentTxns.where('investmentId').equals(investmentId).toArray();
  const h = replay(txns);
  for (const t of txns) {
    const s = h.sells.get(t.id);
    if (s && (s.realizedMinor !== t.realizedMinor || s.costRemovedMinor !== t.costRemovedMinor)) {
      await db.investmentTxns.update(t.id, { realizedMinor: s.realizedMinor, costRemovedMinor: s.costRemovedMinor });
    }
  }
  const next = {
    quantityMicro: h.quantityMicro,
    costBasisMinor: h.costBasisMinor,
    realizedMinor: h.realizedMinor,
    lastPriceMinor: h.lastPriceMinor,
    lastPriceDate: h.lastPriceDate,
    status: (h.quantityMicro === 0 && txns.some((t) => t.kind === 'sell') ? 'closed' : 'active') as 'closed' | 'active',
  };
  const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => inv[k] === next[k]);
  if (same) return;
  // rebuilds (touch: false) must not look like user edits to sync's last-writer-wins
  await db.investments.update(investmentId, touch ? { ...next, updatedAt: nowISO() } : next);
}
