import { db, newId, nowISO } from './schema';
import type { Asset, AssetKind, AssetValuation } from './types';
import type { CurrencyCode } from '../engine/money';
import { recordMutation } from './audit';

const SCOPE = () => [db.assets, db.assetValuations, db.trash, db.auditLog, db.syncQueue];

export interface AssetInput {
  profileId: string;
  name: string;
  kind: AssetKind;
  currency: CurrencyCode;
  valueMinor: number;
  valuationDate: string;
  quantityNote?: string;
  notes?: string;
}

function addValuation(asset: Pick<Asset, 'id' | 'profileId'>, valueMinor: number, date: string) {
  const ts = nowISO();
  return db.assetValuations.add({ id: newId(), createdAt: ts, updatedAt: ts, profileId: asset.profileId, assetId: asset.id, valueMinor, date });
}

/** Latest valuation by date (ties: most recently recorded). */
async function syncLatest(assetId: string): Promise<void> {
  const vals = await db.assetValuations.where('assetId').equals(assetId).toArray();
  if (!vals.length) return;
  vals.sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  const last = vals[vals.length - 1];
  await db.assets.update(assetId, { valueMinor: last.valueMinor, valuationDate: last.date, updatedAt: nowISO() });
}

export async function createAsset(input: AssetInput): Promise<Asset> {
  if (!input.name.trim()) throw new Error('Name is required');
  if (!Number.isSafeInteger(input.valueMinor) || input.valueMinor < 0) throw new Error('Value must be zero or positive');
  return db.transaction('rw', SCOPE(), async () => {
    const ts = nowISO();
    const asset: Asset = {
      id: newId(), createdAt: ts, updatedAt: ts, profileId: input.profileId, name: input.name.trim(), kind: input.kind,
      currency: input.currency, valueMinor: input.valueMinor, valuationDate: input.valuationDate,
      quantityNote: input.quantityNote ?? '', notes: input.notes ?? '', status: 'active',
    };
    await db.assets.add(asset);
    await addValuation(asset, input.valueMinor, input.valuationDate);
    await recordMutation({ profileId: asset.profileId, table: 'assets', rowId: asset.id, action: 'create', before: null, after: asset });
    return asset;
  });
}

/** Record a new value on a date; history is kept for net-worth trends. */
export async function revalueAsset(id: string, valueMinor: number, date: string): Promise<void> {
  if (!Number.isSafeInteger(valueMinor) || valueMinor < 0) throw new Error('Value must be zero or positive');
  return db.transaction('rw', SCOPE(), async () => {
    const before = await db.assets.get(id);
    if (!before) throw new Error('Asset not found');
    await addValuation(before, valueMinor, date);
    await syncLatest(id);
    const after = (await db.assets.get(id))!;
    await recordMutation({ profileId: before.profileId, table: 'assets', rowId: id, action: 'update', before, after });
  });
}

export async function updateAsset(id: string, changes: Partial<Pick<Asset, 'name' | 'kind' | 'quantityNote' | 'notes' | 'status'>>): Promise<void> {
  return db.transaction('rw', SCOPE(), async () => {
    const before = await db.assets.get(id);
    if (!before) throw new Error('Asset not found');
    const after = { ...before, ...changes, updatedAt: nowISO() };
    await db.assets.put(after);
    await recordMutation({ profileId: before.profileId, table: 'assets', rowId: id, action: 'update', before, after });
  });
}

export async function deleteAsset(id: string): Promise<void> {
  return db.transaction('rw', SCOPE(), async () => {
    const asset = await db.assets.get(id);
    if (!asset) throw new Error('Asset not found');
    const valuations = await db.assetValuations.where('assetId').equals(id).toArray();
    await db.assetValuations.where('assetId').equals(id).delete();
    await db.assets.delete(id);
    const ts = nowISO();
    await db.trash.add({
      id: newId(), createdAt: ts, updatedAt: ts, profileId: asset.profileId, table: 'assets', rowId: id,
      payload: JSON.stringify({ asset, valuations }), label: asset.name, deletedAt: ts,
      purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    await recordMutation({ profileId: asset.profileId, table: 'assets', rowId: id, action: 'delete', before: asset, after: null });
  });
}

export async function restoreAsset(trashId: string): Promise<void> {
  return db.transaction('rw', SCOPE(), async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'assets') throw new Error('Trash entry not found');
    const { asset, valuations } = JSON.parse(entry.payload) as { asset: Asset; valuations: AssetValuation[] };
    await db.assets.add(asset);
    for (const v of valuations) await db.assetValuations.add(v);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: asset.profileId, table: 'assets', rowId: asset.id, action: 'restore', before: null, after: asset });
  });
}
