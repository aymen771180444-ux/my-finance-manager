import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { db, todayISO } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { createTransaction } from './transactions';
import { addAttachment } from './attachments';
import { buildExportZip, toCsv, EXPORT_SETS } from './dataExport';
import { setDek } from './keyring';

beforeEach(async () => {
  await db.delete();
  await db.open();
  setDek(null);
});

describe('CSV', () => {
  it('escapes quotes, commas and newlines and starts with a BOM', () => {
    const s = toCsv(['a', 'b'], [['x,y', 'say "hi"\nok']]);
    expect(s.startsWith('﻿')).toBe(true);
    expect(s).toContain('"x,y","say ""hi""\nok"');
  });
});

describe('data export ZIP', () => {
  it('contains every selected set with exact decimal amounts and Arabic text', async () => {
    const p = await createProfile('شخصي');
    const usd = await createAccount({ profileId: p.id, name: 'حساب الدولار', type: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedAt: todayISO() });
    const t = await createTransaction({ profileId: p.id, type: 'expense', amountMinor: 1_999, accountId: usd.id, date: todayISO(), notes: 'غداء, عمل' });
    await addAttachment({ profileId: p.id, ownerType: 'transaction', ownerId: t.id, name: 'فاتورة.jpg', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) });
    const zip = await JSZip.loadAsync(await buildExportZip(p.id, EXPORT_SETS));
    const names = Object.keys(zip.files);
    for (const f of ['transactions.csv', 'accounts.csv', 'budgets.csv', 'debts.csv', 'savings_goals.csv', 'investments.csv', 'assets.csv']) {
      expect(names).toContain(f);
    }
    expect(names.some((n) => n.startsWith('attachments/') && n.endsWith('فاتورة.jpg'))).toBe(true);
    const tx = await zip.file('transactions.csv')!.async('string');
    expect(tx).toContain('19.99,USD');
    expect(tx).toContain('"غداء, عمل"');
    expect(await zip.file('accounts.csv')!.async('string')).toContain('حساب الدولار,bank,USD,1000.00,980.01');
  });
});
