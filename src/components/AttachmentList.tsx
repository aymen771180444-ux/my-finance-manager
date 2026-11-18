import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Paperclip, Camera, FileText, Image as ImageIcon, Trash2, X, Lock } from 'lucide-react';
import { db } from '../db/schema';
import { addAttachment, readAttachment, deleteAttachment, MAX_ATTACHMENT_BYTES } from '../db/attachments';
import { compressImage, attachmentName } from '../lib/image';
import { useLock } from '../store/lock';
import { useActiveProfileId } from '../hooks/data';
import type { AttachmentOwner } from '../db/types';

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Prepare picked files (compress images, enforce size). */
export async function prepareFiles(files: FileList | File[]): Promise<{ name: string; blob: Blob }[]> {
  const out: { name: string; blob: Blob }[] = [];
  for (const f of Array.from(files)) {
    const blob = await compressImage(f);
    if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_TOO_LARGE');
    out.push({ name: attachmentName(f.name, blob), blob });
  }
  return out;
}

/** File + camera pickers. The lock grace period stops "leave app → lock" while the picker is open. */
export function FilePickers({ onFiles, disabled }: { onFiles: (files: FileList) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const allowBackground = useLock((s) => s.allowBackground);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const open = (ref: React.RefObject<HTMLInputElement | null>) => {
    allowBackground(5 * 60_000);
    ref.current?.click();
  };
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) onFiles(e.target.files);
    e.target.value = '';
  };
  return (
    <div className="flex gap-2">
      <button type="button" disabled={disabled} onClick={() => open(fileRef)} className="inline-flex items-center gap-1.5 rounded-2xl border border-line px-3 py-2 text-sm text-primary disabled:opacity-40">
        <Paperclip size={15} /> {t('attachments.add')}
      </button>
      <button type="button" disabled={disabled} onClick={() => open(camRef)} className="inline-flex items-center gap-1.5 rounded-2xl border border-line px-3 py-2 text-sm text-primary disabled:opacity-40">
        <Camera size={15} /> {t('attachments.camera')}
      </button>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={handle} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
    </div>
  );
}

/** Saved attachments of one record, with add / view / delete. */
export function AttachmentList({ ownerType, ownerId }: { ownerType: AttachmentOwner; ownerId: string }) {
  const { t } = useTranslation();
  const profileId = useActiveProfileId();
  const lockedApp = useLock((s) => s.vaultEnabled && s.status !== 'open');
  const items = useLiveQuery(
    async () => (await db.attachments.where('[ownerType+ownerId]').equals([ownerType, ownerId]).toArray()).filter((a) => !a.deletedAt),
    [ownerType, ownerId],
  ) ?? [];
  const [viewing, setViewing] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);

  const explain = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    return m === 'ATTACHMENT_TOO_LARGE' ? t('attachments.tooLarge') : m === 'APP_LOCKED' ? t('attachments.locked') : t('common.error');
  };

  async function add(files: FileList) {
    if (!profileId) return;
    setError('');
    try {
      for (const f of await prepareFiles(files)) await addAttachment({ profileId, ownerType, ownerId, name: f.name, blob: f.blob });
    } catch (e) {
      setError(explain(e));
    }
  }

  async function open(id: string, mime: string, name: string) {
    setError('');
    try {
      const blob = await readAttachment(id);
      const url = URL.createObjectURL(blob);
      if (mime.startsWith('image/')) setViewing({ url, mime, name });
      else {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (e) {
      setError(explain(e));
    }
  }

  return (
    <div className="space-y-2">
      {items.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2">
          {a.mime.startsWith('image/') ? <ImageIcon size={16} className="shrink-0 text-primary" /> : <FileText size={16} className="shrink-0 text-primary" />}
          <button type="button" className="min-w-0 flex-1 truncate text-start text-sm" onClick={() => void open(a.id, a.mime, a.name)}>
            {a.name} <span className="text-xs text-ink-dim">· {kb(a.size)}</span>
            {a.encrypted && <Lock size={11} className="ms-1 inline text-income" aria-label="encrypted" />}
          </button>
          <button type="button" className="p-1 text-ink-dim" aria-label={t('common.delete')} onClick={() => void deleteAttachment(a.id)}><Trash2 size={15} /></button>
        </div>
      ))}
      {items.length === 0 && <p className="text-xs text-ink-dim">{t('attachments.empty')}</p>}
      <FilePickers onFiles={(f) => void add(f)} disabled={lockedApp} />
      {error && <p className="text-xs text-expense">{error}</p>}
      {viewing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setViewing(null)} role="dialog" aria-modal aria-label={viewing.name}>
          <button className="absolute end-4 top-4 rounded-full bg-white/15 p-2 text-white" aria-label={t('common.close')}><X size={20} /></button>
          <img src={viewing.url} alt={viewing.name} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
