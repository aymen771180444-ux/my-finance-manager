/**
 * What gets synced, and how a record is fingerprinted for change detection.
 *
 * Fingerprints ignore `updatedAt` and every DERIVED field (balances, saved
 * amounts, investment caches, device-local processing markers): those are
 * recomputed on each device by rebuildDerived(), never copied, so they can
 * neither cause false "edits" nor drift between devices.
 */

export const SYNC_TABLES = [
  'profiles', 'accounts', 'transactions', 'splits', 'categories', 'tags', 'transactionTags', 'exchangeRates',
  'budgets', 'savingsGoals', 'savingsContributions', 'debts', 'debtRepayments', 'recurringObligations',
  'investments', 'investmentTxns', 'assets', 'assetValuations', 'trash', 'attachments',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Not synced: device-local by nature (lock vault, UI settings, notifications, outbox, audit log of this device). */
export const DERIVED: Partial<Record<SyncTable, string[]>> = {
  accounts: ['currentBalanceMinor'],
  debts: ['remainingMinor', 'status'],
  savingsGoals: ['savedMinor', 'status', 'autoLastMonth'],
  investments: ['quantityMicro', 'costBasisMinor', 'realizedMinor', 'lastPriceMinor', 'lastPriceDate', 'status'],
  investmentTxns: ['realizedMinor', 'costRemovedMinor'],
  assets: ['valueMinor', 'valuationDate'],
  recurringObligations: ['lastProcessed'],
  // attachment bytes travel as separate content files; local storage form differs per device
  attachments: ['data', 'iv', 'encrypted'],
};

type Row = Record<string, unknown>;

/** Stable JSON: keys sorted, so equal content always yields equal text. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Row;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** The record as it travels between devices: derived fields stripped (each device recomputes them). */
export function exportRow(table: SyncTable, row: Row): Row {
  const out: Row = {};
  const drop = new Set(DERIVED[table] ?? []);
  for (const [k, v] of Object.entries(row)) if (!drop.has(k)) out[k] = v;
  return out;
}

/** cyrb53 — fast, well-distributed 53-bit string hash (synchronous: safe inside IndexedDB transactions). */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Content fingerprint used to detect edits since the last sync. */
export function fingerprint(table: SyncTable, row: Row): string {
  // timestamps are metadata, not content: two devices creating the same fixed-id entry must match
  const { updatedAt: _u, createdAt: _c, ...rest } = exportRow(table, row);
  return cyrb53(stable(rest)) + cyrb53(stable(rest), 7);
}

export const baseKey = (table: string, id: string) => `${table}:${id}`;
