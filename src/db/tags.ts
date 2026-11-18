import { db, newId, nowISO } from './schema';
import type { Tag } from './types';
import { recordMutation } from './audit';

export const TAG_COLORS = ['#1d4ed8', '#2563eb', '#9333ea', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#64748b'];

export async function createTag(profileId: string, name: string, color?: string): Promise<Tag> {
  const clean = name.trim().replace(/^#/, '');
  if (!clean) throw new Error('Tag name is required');
  return db.transaction('rw', [db.tags, db.auditLog, db.syncQueue], async () => {
    const existing = (await db.tags.where('profileId').equals(profileId).toArray()).find(
      (t) => t.name.toLowerCase() === clean.toLowerCase(),
    );
    if (existing) return existing;
    const count = await db.tags.where('profileId').equals(profileId).count();
    const ts = nowISO();
    const tag: Tag = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId,
      name: clean,
      color: color ?? TAG_COLORS[count % TAG_COLORS.length],
    };
    await db.tags.add(tag);
    await recordMutation({ profileId, table: 'tags', rowId: tag.id, action: 'create', before: null, after: tag });
    return tag;
  });
}

/** Delete a tag and its links (transactions themselves are untouched). */
export async function deleteTag(id: string): Promise<void> {
  return db.transaction('rw', [db.tags, db.transactionTags, db.auditLog, db.syncQueue], async () => {
    const tag = await db.tags.get(id);
    if (!tag) return;
    await db.transactionTags.where('tagId').equals(id).delete();
    await db.tags.delete(id);
    await recordMutation({ profileId: tag.profileId, table: 'tags', rowId: id, action: 'delete', before: tag, after: null });
  });
}

export async function tagIdsForTxn(txnId: string): Promise<string[]> {
  return (await db.transactionTags.where('transactionId').equals(txnId).toArray()).map((l) => l.tagId);
}
