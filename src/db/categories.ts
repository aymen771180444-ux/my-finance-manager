import { db, newId, nowISO } from './schema';
import type { Category, CategoryKind, CategoryGroup } from './types';
import { recordMutation } from './audit';

export interface CategoryInput {
  profileId: string;
  parentId?: string | null;
  kind: CategoryKind;
  group: CategoryGroup;
  nameAr: string;
  nameEn: string;
  color: string;
  icon: string;
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const ts = nowISO();
  const cat: Category = {
    id: newId(),
    createdAt: ts,
    updatedAt: ts,
    profileId: input.profileId,
    parentId: input.parentId ?? null,
    kind: input.kind,
    group: input.group,
    nameKey: null,
    nameAr: input.nameAr.trim(),
    nameEn: input.nameEn.trim(),
    color: input.color,
    icon: input.icon,
    isArchived: false,
  };
  if (!cat.nameAr && !cat.nameEn) throw new Error('Category name is required');
  return db.transaction('rw', [db.categories, db.auditLog, db.syncQueue], async () => {
    await db.categories.add(cat);
    await recordMutation({ profileId: cat.profileId, table: 'categories', rowId: cat.id, action: 'create', before: null, after: cat });
    return cat;
  });
}

export async function updateCategory(
  id: string,
  changes: Partial<Pick<Category, 'nameAr' | 'nameEn' | 'color' | 'icon' | 'group'>>,
): Promise<void> {
  return db.transaction('rw', [db.categories, db.auditLog, db.syncQueue], async () => {
    const before = await db.categories.get(id);
    if (!before) throw new Error('Category not found');
    const after = { ...before, ...changes, nameKey: null, updatedAt: nowISO() };
    await db.categories.put(after);
    await recordMutation({ profileId: before.profileId, table: 'categories', rowId: id, action: 'update', before, after });
  });
}

/**
 * Delete a category. If it (or a subcategory) is referenced by transactions or
 * splits, it is ARCHIVED instead so history keeps its labels. Returns what happened.
 */
export async function deleteCategory(id: string): Promise<'deleted' | 'archived'> {
  return db.transaction(
    'rw',
    [db.categories, db.transactions, db.splits, db.trash, db.auditLog, db.syncQueue],
    async () => {
      const cat = await db.categories.get(id);
      if (!cat) throw new Error('Category not found');
      const children = await db.categories.where('[profileId+parentId]').equals([cat.profileId, id]).toArray();
      const ids = [id, ...children.map((c) => c.id)];
      let inUse = false;
      for (const cid of ids) {
        const used =
          (await db.transactions.where('[profileId+categoryId]').equals([cat.profileId, cid]).count()) > 0 ||
          (await db.splits.where('[profileId+categoryId]').equals([cat.profileId, cid]).count()) > 0;
        const usedAsSub = (await db.transactions.toCollection().filter((t) => t.subcategoryId === cid).count()) > 0;
        if (used || usedAsSub) {
          inUse = true;
          break;
        }
      }
      const ts = nowISO();
      if (inUse) {
        for (const cid of ids) {
          await db.categories.update(cid, { isArchived: true, updatedAt: ts });
        }
        await recordMutation({ profileId: cat.profileId, table: 'categories', rowId: id, action: 'update', before: cat, after: { ...cat, isArchived: true } });
        return 'archived';
      }
      for (const cid of ids) await db.categories.delete(cid);
      await db.trash.add({
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId: cat.profileId,
        table: 'categories',
        rowId: id,
        payload: JSON.stringify({ cat, children }),
        label: cat.nameEn || cat.nameAr,
        deletedAt: ts,
        purgeAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      });
      await recordMutation({ profileId: cat.profileId, table: 'categories', rowId: id, action: 'delete', before: cat, after: null });
      return 'deleted';
    },
  );
}

export async function restoreCategory(trashId: string): Promise<void> {
  return db.transaction('rw', [db.categories, db.trash, db.auditLog, db.syncQueue], async () => {
    const entry = await db.trash.get(trashId);
    if (!entry || entry.table !== 'categories') throw new Error('Trash entry not found');
    const { cat, children } = JSON.parse(entry.payload) as { cat: Category; children: Category[] };
    await db.categories.add(cat);
    for (const c of children) await db.categories.add(c);
    await db.trash.delete(trashId);
    await recordMutation({ profileId: cat.profileId, table: 'categories', rowId: cat.id, action: 'restore', before: null, after: cat });
  });
}
