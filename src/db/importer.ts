import { db, todayISO } from './schema';
import { createTransaction, TXN_TABLES } from './transactions';
import { createTag } from './tags';
import type { ImportRow } from '../engine/csvImport';

/**
 * Commit validated import rows through the normal posting engine, atomically:
 * either every row is recorded or none is. Each imported transaction carries an
 * "import-YYYY-MM-DD" tag so the batch can be found (and deleted) together.
 */
export async function commitImport(profileId: string, rows: ImportRow[]): Promise<{ count: number; tagName: string }> {
  const ok = rows.filter((r) => r.status === 'ok');
  const tagName = `import-${todayISO()}`;
  if (!ok.length) return { count: 0, tagName };
  await db.transaction('rw', [...TXN_TABLES, db.tags], async () => {
    const tag = await createTag(profileId, tagName);
    for (const r of ok) {
      await createTransaction({
        profileId,
        type: r.type!,
        amountMinor: r.amountMinor!,
        accountId: r.accountId!,
        toAccountId: r.toAccountId ?? null,
        categoryId: r.categoryId ?? null,
        subcategoryId: r.subcategoryId ?? null,
        date: r.date!,
        notes: r.notes ?? '',
        person: r.person ?? '',
        tagIds: [tag.id],
      });
    }
  });
  return { count: ok.length, tagName };
}
