import { describe, it, expect, beforeEach } from 'vitest';
import { db, todayISO } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { commitImport } from './importer';
import { buildRows, parseCsv, guessColumns } from '../engine/csvImport';

let profileId: string;
let cash: string;

beforeEach(async () => {
  await db.delete();
  await db.open();
  profileId = (await createProfile('T')).id;
  cash = (await createAccount({ profileId, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 100_000, openedAt: '2025-01-01' })).id;
});

async function rowsFrom(csv: string) {
  const table = parseCsv(csv);
  return buildRows(table, { map: guessColumns(table[0]), dateFormat: 'dmy', defaultAccountId: cash, hasHeader: true }, {
    accounts: await db.accounts.toArray(),
    categories: await db.categories.toArray(),
    existing: await db.transactions.toArray(),
  });
}

describe('commitImport', () => {
  it('records valid rows through the posting engine, tagged as one batch', async () => {
    const rows = await rowsFrom('التاريخ,المبلغ,البيان,التصنيف\n01/10/2026,-5000,غداء,الطعام\n02/10/2026,250000,راتب,الراتب\n03/10/2026,abc,خطأ,\n');
    const { count, tagName } = await commitImport(profileId, rows);
    expect(count).toBe(2); // the invalid row is skipped, not guessed
    expect((await db.accounts.get(cash))!.currentBalanceMinor).toBe(100_000 - 5000 + 250_000);
    const tag = (await db.tags.toArray()).find((t) => t.name === tagName)!;
    expect(tagName).toBe(`import-${todayISO()}`);
    expect(await db.transactionTags.where('tagId').equals(tag.id).count()).toBe(2);
    const food = (await db.transactions.toArray()).find((t) => t.notes === 'غداء')!;
    expect((await db.categories.get(food.categoryId!))!.nameKey).toBe('food');
  });

  it('re-importing the same file finds everything as duplicates', async () => {
    const csv = 'date,amount,notes\n01/10/2026,-5000,lunch\n';
    await commitImport(profileId, await rowsFrom(csv));
    const again = await rowsFrom(csv);
    expect(again[0].status).toBe('duplicate');
    expect((await commitImport(profileId, again)).count).toBe(0);
  });

  it('is atomic: a failure leaves nothing behind', async () => {
    const rows = await rowsFrom('date,amount,notes\n01/10/2026,-5000,a\n02/10/2026,-6000,b\n');
    rows[1].accountId = 'missing-account'; // simulate a row that fails at commit time
    await expect(commitImport(profileId, rows)).rejects.toThrow();
    expect(await db.transactions.count()).toBe(0);
    expect((await db.accounts.get(cash))!.currentBalanceMinor).toBe(100_000);
  });
});
