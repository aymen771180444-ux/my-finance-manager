import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Hash, Plus, Trash2 } from 'lucide-react';
import { Card, Button, TextInput, EmptyState, ConfirmDialog } from '../../components/ui';
import { db } from '../../db/schema';
import { useActiveProfileId } from '../../hooks/data';
import { createTag, deleteTag } from '../../db/tags';
import type { Tag } from '../../db/types';

export function useTags(): Tag[] {
  const profileId = useActiveProfileId();
  return useLiveQuery(async () => (profileId ? (await db.tags.where('profileId').equals(profileId).toArray()).sort((a, b) => a.name.localeCompare(b.name)) : []), [profileId]) ?? [];
}

export default function TagsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const tags = useTags();
  const counts = useLiveQuery(async () => {
    if (!profileId) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const l of await db.transactionTags.where('profileId').equals(profileId).toArray()) m.set(l.tagId, (m.get(l.tagId) ?? 0) + 1);
    return m;
  }, [profileId]);
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<Tag | null>(null);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('tags.title')}</h1>
      </div>
      <div className="mb-3 flex gap-2">
        <TextInput placeholder={t('tags.placeholder')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="soft" disabled={!name.trim()} onClick={() => { if (profileId) void createTag(profileId, name).then(() => setName('')); }}>
          <Plus size={16} />
        </Button>
      </div>
      {tags.length === 0 ? (
        <EmptyState icon={<Hash size={40} />} text={t('tags.empty')} />
      ) : (
        <Card className="px-2">
          {tags.map((tg) => (
            <div key={tg.id} className="flex items-center gap-3 px-2 py-2.5">
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: `${tg.color}22`, color: tg.color }}>#{tg.name}</span>
              <span className="flex-1 text-xs text-ink-dim">{counts?.get(tg.id) ?? 0}</span>
              <button onClick={() => setToDelete(tg)} className="p-2 text-ink-dim" aria-label={t('common.delete')}><Trash2 size={15} /></button>
            </div>
          ))}
        </Card>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={`#${toDelete?.name ?? ''}`}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void deleteTag(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
