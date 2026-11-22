import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, Upload, Cloud, FileArchive, ShieldCheck } from 'lucide-react';
import { Card, Button, Field, TextInput, ConfirmDialog } from '../../components/ui';
import { useApp } from '../../store/app';
import { useLock } from '../../store/lock';
import { useActiveProfileId } from '../../hooks/data';
import { createBackup, openBackup, restorePayload, type BackupPayload } from '../../db/backup';
import { buildExportZip, EXPORT_SETS, type ExportSet } from '../../db/dataExport';
import { downloadFile } from '../../lib/download';
import { todayISO } from '../../db/schema';
import { getSettings } from '../../db/profiles';

export default function BackupPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const settings = useApp((s) => s.settings);
  const profileId = useActiveProfileId();
  const allowBackground = useLock((s) => s.allowBackground);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [rpw, setRpw] = useState('');
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [verified, setVerified] = useState<BackupPayload | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sets, setSets] = useState<ExportSet[]>([...EXPORT_SETS]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null | undefined>(settings?.lastBackupAt);

  const fmtDate = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const explain = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const map: Record<string, string> = {
      BACKUP_BAD_PASSWORD: 'backup.badPassword', BACKUP_CORRUPT: 'backup.corrupt', BACKUP_NOT_A_BACKUP: 'backup.notBackup',
      BACKUP_NEWER_VERSION: 'backup.newer', APP_LOCKED: 'backup.locked',
    };
    return t(map[m] ?? 'common.error');
  };

  async function doBackup() {
    setBusy(true);
    setMsg(null);
    try {
      const { text, counts } = await createBackup(pw);
      downloadFile(text, `my-finance-backup-${todayISO()}.mfm`, 'application/octet-stream');
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      setMsg({ ok: true, text: t('backup.created', { count: total }) });
      setLastBackup((await getSettings())?.lastBackupAt);
      setPw('');
      setPw2('');
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!fileText) return;
    setBusy(true);
    setMsg(null);
    setVerified(null);
    try {
      setVerified(await openBackup(fileText, rpw));
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    if (!verified) return;
    setBusy(true);
    try {
      await restorePayload(verified);
      setMsg({ ok: true, text: t('backup.restored') });
      // reload so every screen and store re-reads the restored data
      setTimeout(() => window.location.assign(import.meta.env.BASE_URL), 600);
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
      setBusy(false);
    }
  }

  async function doExport() {
    if (!profileId) return;
    setBusy(true);
    setMsg(null);
    try {
      const zip = await buildExportZip(profileId, sets);
      downloadFile(zip, `my-finance-export-${todayISO()}.zip`, 'application/zip');
      setMsg({ ok: true, text: t('backup.exported') });
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const total = verified ? Object.entries(verified.counts).filter(([k]) => k !== 'attachments').reduce((s, [, n]) => s + n, 0) : 0;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="text-xl font-bold">{t('backup.title')}</h1>
      </div>

      <Card className="mb-3 flex items-center gap-3 p-4">
        <ShieldCheck className={lastBackup ? 'text-income' : 'text-liability'} />
        <p className="text-sm">{lastBackup ? t('backup.lastBackup', { date: fmtDate(lastBackup) }) : t('backup.never')}</p>
      </Card>

      {msg && <p className={`mb-3 rounded-2xl px-3 py-2 text-sm ${msg.ok ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`} role="status">{msg.text}</p>}

      <Card className="mb-3 space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Download size={16} /> {t('backup.create')}</h2>
        <Field label={t('backup.password')}><TextInput type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label={t('backup.passwordConfirm')} hint={t('backup.passwordHint')}><TextInput type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {pw2 && pw !== pw2 && <p className="text-xs text-expense">{t('security.recoveryMismatch')}</p>}
        <Button className="w-full" disabled={busy || pw.length < 8 || pw !== pw2} onClick={() => void doBackup()}>{busy ? t('security.working') : t('backup.create')}</Button>
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Upload size={16} /> {t('backup.restore')}</h2>
        <p className="rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{t('backup.restoreWarning')}</p>
        <label className="block">
          <span className="sr-only">{t('backup.chooseFile')}</span>
          <input
            type="file"
            accept=".mfm,application/octet-stream,application/json"
            onClick={() => allowBackground(5 * 60_000)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setVerified(null);
              setMsg(null);
              if (!f) return;
              setFileName(f.name);
              void f.text().then(setFileText);
            }}
            className="block w-full text-sm file:me-3 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:font-semibold file:text-primary"
          />
        </label>
        {fileText && (
          <>
            <p className="truncate text-xs text-ink-dim" dir="ltr">{fileName}</p>
            <Field label={t('backup.password')}><TextInput type="password" value={rpw} onChange={(e) => setRpw(e.target.value)} /></Field>
            <Button variant="soft" className="w-full" disabled={busy || !rpw} onClick={() => void verify()}>{t('lock.unlock')}</Button>
          </>
        )}
        {verified && (
          <>
            <p className="rounded-2xl bg-income-soft px-3 py-2 text-xs text-income">
              {t('backup.verified', { date: fmtDate(verified.exportedAt), count: total, files: verified.counts.attachments ?? 0 })}
            </p>
            <Button variant="danger" className="w-full" disabled={busy} onClick={() => setConfirm(true)}>{t('backup.confirmRestore')}</Button>
          </>
        )}
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><FileArchive size={16} /> {t('backup.export')}</h2>
        <p className="text-xs text-ink-dim">{t('backup.exportHint')}</p>
        <div className="grid grid-cols-2 gap-2">
          {EXPORT_SETS.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sets.includes(s)} onChange={(e) => setSets(e.target.checked ? [...sets, s] : sets.filter((x) => x !== s))} />
              {t(`backup.sets.${s}`)}
            </label>
          ))}
        </div>
        <Button variant="soft" className="w-full" disabled={busy || sets.length === 0} onClick={() => void doExport()}>{t('backup.exportBtn')}</Button>
      </Card>

      <Card className="flex items-start gap-3 p-4" onClick={() => navigate('/more/sync')}>
        <Cloud size={20} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">{t('backup.cloud')}</p>
          <p className="mt-1 text-xs text-ink-dim">{t('backup.cloudLink')}</p>
        </div>
      </Card>

      <ConfirmDialog
        open={confirm}
        title={t('backup.confirmRestore')}
        body={t('backup.restoreWarning')}
        confirmLabel={t('backup.confirmRestore')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void doRestore();
        }}
      />
    </div>
  );
}
