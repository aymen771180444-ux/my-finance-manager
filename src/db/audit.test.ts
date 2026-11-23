import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from './schema';
import { createProfile } from './profiles';
import { createAccount } from './accounts';
import { createTransaction, deleteTransaction } from './transactions';
import { setMutationSink, quietly, type MutationEvent } from './audit';

let events: MutationEvent[];
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  await db.delete();
  await db.open();
  events = [];
  setMutationSink((e) => events.push(e));
});
afterEach(() => setMutationSink(null));

describe('"done" pop-up events', () => {
  it('fire once per saved action, after it is committed', async () => {
    const p = await createProfile('Me');
    const acc = await createAccount({ profileId: p.id, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 1000, openedAt: '2026-01-01' });
    events = [];
    const tx = await createTransaction({ profileId: p.id, type: 'expense', amountMinor: 100, accountId: acc.id, date: '2026-11-01' });
    await settle();
    expect(events).toEqual([{ table: 'transactions', action: 'create' }]);
    events = [];
    await deleteTransaction(tx.id);
    await settle();
    expect(events).toEqual([{ table: 'transactions', action: 'delete' }]);
  });

  it('stay silent for background work', async () => {
    const p = await createProfile('Me');
    const acc = await createAccount({ profileId: p.id, name: 'Cash', type: 'cash', currency: 'YER', openingBalanceMinor: 1000, openedAt: '2026-01-01' });
    events = [];
    await quietly(() => createTransaction({ profileId: p.id, type: 'expense', amountMinor: 100, accountId: acc.id, date: '2026-11-01' }));
    await settle();
    expect(events).toEqual([]);
  });

  it('never report a save that failed', async () => {
    const p = await createProfile('Me');
    events = [];
    await expect(createTransaction({ profileId: p.id, type: 'expense', amountMinor: 100, accountId: 'missing', date: '2026-11-01' })).rejects.toThrow();
    await settle();
    expect(events).toEqual([]);
  });
});
