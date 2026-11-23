import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Cloud, CloudOff, RefreshCw, History, GitCompare, LogOut, KeyRound } from 'lucide-react';
import { Card, Button, Field, TextInput, ConfirmDialog } from '../../components/ui';
import { db } from '../../db/schema';
import { googleConfigured, preloadGoogle, currentToken } from '../../sync/googleAuth';
import { pendingCount, adoptOtherVersion, dismissConflict, type RestorePoint } from '../../sync/protocol';
import {
  useSync, signInGoogle, remoteExists, connectDrive, localHasUserData, syncNow, reconnectGoogle, reenterPassword,
  restorePoints, rollBackTo, disconnect, type JoinMode,
} from '../../sync/service';
import type { SyncConflict, SyncState } from '../../db/types';
import { toast } from '../../store/toast';
import { formatMoney, type CurrencyCode } from '../../engine/money';

const ERRORS: Record<string, string> = {
  SYNC_BAD_PASSWORD: 'sync.err.badPassword',
  SYNC_PASSWORD_TOO_SHORT: 'sync.err.short',
  SYNC_FOREIGN_DATA: 'sync.err.foreign',
  SYNC_NEWER_VERSION: 'sync.err.newer',
  SYNC_OFFLINE: 'sync.err.offline',
  SYNC_NETWORK: 'sync.err.network',
  SYNC_DRIVE_FULL: 'sync.err.full',
  SYNC_FORBIDDEN: 'sync.err.forbidden',
  SYNC_AUTH_NEEDED: 'sync.err.auth',
  SYNC_REMOTE_GONE: 'sync.err.remoteGone',
  SYNC_CANNOT_RESTORE: 'sync.err.cannotRestore',
  GOOGLE_POPUP_BLOCKED: 'sync.err.popupBlocked',
  GOOGLE_POPUP_CLOSED: 'sync.err.popupClosed',
  GOOGLE_DENIED: 'sync.err.denied',
  GOOGLE_SCOPE_MISSING: 'sync.err.scope',
  GOOGLE_LOAD_FAILED: 'sync.err.load',
  APP_LOCKED: 'backup.locked',
};

export default function SyncPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  // null = not connected; undefined = loading
  const state = useLiveQuery(async () => (await db.syncState.get('sync')) ?? null, []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => preloadGoogle(), []);

  const explain = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    return t(ERRORS[m] ?? 'sync.err.generic', { code: m });
  };
  async function run(fn: () => Promise<void>, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (okText) {
        setMsg({ ok: true, text: okText });
        toast(okText);
      }
    } catch (e) {
      setMsg({ ok: false, text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="text-xl font-bold">{t('sync.title')}</h1>
      </div>

      {msg && <p className={`mb-3 rounded-2xl px-3 py-2 text-sm ${msg.ok ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`} role="status">{msg.text}</p>}

      {!googleConfigured() ? (
        <Card className="flex items-start gap-3 p-4">
          <CloudOff size={20} className="mt-0.5 shrink-0 text-ink-dim" />
          <div>
            <p className="text-sm font-medium">{t('sync.notConfigured')}</p>
            <p className="mt-1 text-xs text-ink-dim">{t('sync.notConfiguredHint')}</p>
          </div>
        </Card>
      ) : state === undefined ? null : state === null ? (
        <ConnectFlow busy={busy} run={run} />
      ) : (
        <Connected state={state} busy={busy} run={run} />
      )}

      <Card className="mt-3 p-4">
        <p className="text-sm font-medium">{t('sync.howTitle')}</p>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-ink-dim">
          <li>{t('sync.how1')}</li>
          <li>{t('sync.how2')}</li>
          <li>{t('sync.how3')}</li>
          <li>{t('sync.how4')}</li>
        </ul>
      </Card>
    </div>
  );
}

type Run = (fn: () => Promise<void>, okText?: string) => Promise<void>;

function ConnectFlow({ busy, run }: { busy: boolean; run: Run }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [exists, setExists] = useState<boolean | null>(null);
  const [hasData, setHasData] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState<JoinMode | null>(null);

  const signIn = () =>
    run(async () => {
      const e = await signInGoogle();
      setEmail(e);
      setSignedIn(true);
      setExists(await remoteExists());
      setHasData(await localHasUserData());
    });

  const connect = () =>
    run(async () => {
      setDone(await connectDrive(pw, email));
    });

  if (done) return null; // the connected view takes over via live query

  return (
    <>
      <Card className="mb-3 space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Cloud size={16} /> {t('sync.step1')}</h2>
        <p className="text-xs text-ink-dim">{t('sync.step1Hint')}</p>
        {signedIn ? (
          <p className="rounded-2xl bg-income-soft px-3 py-2 text-sm text-income">{t('sync.signedInAs', { email: email ?? t('sync.unknownEmail') })}</p>
        ) : (
          <Button className="w-full" disabled={busy} onClick={() => void signIn()}>{busy ? t('security.working') : t('sync.signIn')}</Button>
        )}
      </Card>

      {signedIn && exists !== null && (
        <Card className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={16} /> {exists ? t('sync.joinTitle') : t('sync.createTitle')}</h2>
          <p className="text-xs text-ink-dim">{exists ? t('sync.joinHint') : t('sync.createHint')}</p>
          {exists && hasData && <p className="rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{t('sync.mergeWarning')}</p>}
          {exists && !hasData && <p className="rounded-2xl bg-primary-soft px-3 py-2 text-xs text-primary">{t('sync.replaceNote')}</p>}
          <Field label={t('sync.password')}>
            <TextInput type="password" autoComplete={exists ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          {!exists && (
            <Field label={t('backup.passwordConfirm')} hint={t('sync.passwordHint')}>
              <TextInput type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
          )}
          {!exists && pw2 && pw !== pw2 && <p className="text-xs text-expense">{t('security.recoveryMismatch')}</p>}
          <Button className="w-full" disabled={busy || pw.length < 8 || (!exists && pw !== pw2)} onClick={() => void connect()}>
            {busy ? t('sync.syncing') : exists ? t('sync.join') : t('sync.create')}
          </Button>
        </Card>
      )}
    </>
  );
}

function Connected({ state, busy, run }: { state: SyncState; busy: boolean; run: Run }) {
  const { t, i18n } = useTranslation();
  const { phase, lastResult, error } = useSync();
  const pending = useLiveQuery(() => pendingCount(), []);
  const conflicts = useLiveQuery(() => db.syncConflicts.orderBy('createdAt').reverse().filter((c) => !c.resolvedAt).toArray(), []) ?? [];
  const [points, setPoints] = useState<RestorePoint[] | null>(null);
  const [rollback, setRollback] = useState<RestorePoint | null>(null);
  const [leave, setLeave] = useState<null | 'keep' | 'erase'>(null);
  const [pw, setPw] = useState('');

  const fmt = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const hasToken = !!currentToken();

  const statusText =
    phase === 'syncing' ? t('sync.status.syncing')
    : phase === 'needsAuth' || !hasToken ? t('sync.status.needsAuth')
    : phase === 'needsPassword' ? t('sync.status.needsPassword')
    : phase === 'error' || state.failures > 0 ? t('sync.status.error', { reason: t(ERRORS[error ?? state.lastError ?? ''] ?? 'sync.err.generic', { code: error ?? state.lastError }) })
    : t('sync.status.ok');
  const statusTone = phase === 'error' || state.failures > 0 ? 'bg-expense-soft text-expense' : phase === 'syncing' || hasToken ? 'bg-income-soft text-income' : 'bg-liability-soft text-liability';

  return (
    <>
      <Card className="mb-3 space-y-2 p-4">
        <div className="flex items-center gap-3">
          <Cloud className="text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" dir="ltr">{state.email ?? t('sync.unknownEmail')}</p>
            <p className="text-xs text-ink-dim">{t('sync.connectedSince', { date: fmt(state.connectedAt ?? state.lastSyncAt ?? new Date().toISOString()) })}</p>
          </div>
        </div>
        <p className={`rounded-2xl px-3 py-2 text-sm ${statusTone}`} role="status">{statusText}</p>
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-ink-dim">{t('sync.lastSync')}</dt>
          <dd>{state.lastSyncAt ? fmt(state.lastSyncAt) : t('sync.never')}</dd>
          <dt className="text-ink-dim">{t('sync.lastSnapshot')}</dt>
          <dd>{state.lastSnapshotAt ? fmt(state.lastSnapshotAt) : t('sync.never')}</dd>
          <dt className="text-ink-dim">{t('sync.pending')}</dt>
          <dd>{pending ?? '…'}</dd>
        </dl>
        {lastResult && phase === 'idle' && <p className="text-xs text-ink-dim">{t('sync.lastResult', lastResult)}</p>}
        {phase === 'needsPassword' ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-dim">{t('sync.reenterHint')}</p>
            <TextInput type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label={t('sync.password')} />
            <Button className="w-full" disabled={busy || pw.length < 8} onClick={() => void run(() => reenterPassword(pw), t('sync.done'))}>{t('sync.join')}</Button>
          </div>
        ) : phase === 'needsAuth' || !hasToken ? (
          <Button className="w-full" disabled={busy} onClick={() => void run(reconnectGoogle, t('sync.done'))}>{t('sync.reconnect')}</Button>
        ) : (
          <Button className="w-full" disabled={busy || phase === 'syncing'} onClick={() => void run(() => syncNow({ interactive: true }), t('sync.done'))}>
            <span className="inline-flex items-center gap-2"><RefreshCw size={16} className={phase === 'syncing' ? 'animate-spin' : ''} /> {t('sync.syncNow')}</span>
          </Button>
        )}
      </Card>

      {conflicts.length > 0 && (
        <Card className="mb-3 space-y-2 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><GitCompare size={16} /> {t('sync.conflicts', { count: conflicts.length })}</h2>
          <p className="text-xs text-ink-dim">{t('sync.conflictsHint')}</p>
          {conflicts.map((c) => (
            <ConflictRow key={c.id} c={c} busy={busy} run={run} />
          ))}
        </Card>
      )}

      <Card className="mb-3 space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><History size={16} /> {t('sync.restorePoints')}</h2>
        <p className="text-xs text-ink-dim">{t('sync.restorePointsHint')}</p>
        {points === null ? (
          <Button variant="soft" className="w-full" disabled={busy || !hasToken} onClick={() => void run(async () => setPoints(await restorePoints()))}>{t('sync.showPoints')}</Button>
        ) : points.length === 0 ? (
          <p className="text-sm text-ink-dim">{t('sync.noPoints')}</p>
        ) : (
          points.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 border-t border-line pt-2">
              <span className="text-sm">{p.createdAt ? fmt(p.createdAt) : p.name}</span>
              <Button variant="ghost" disabled={busy} onClick={() => setRollback(p)}>{t('sync.rollBack')}</Button>
            </div>
          ))
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><LogOut size={16} /> {t('sync.disconnect')}</h2>
        <p className="text-xs text-ink-dim">{t('sync.disconnectHint')}</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setLeave('keep')}>{t('sync.disconnectKeep')}</Button>
          <Button variant="danger" className="flex-1" disabled={busy || !hasToken} onClick={() => setLeave('erase')}>{t('sync.disconnectErase')}</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!rollback}
        title={t('sync.rollBackTitle')}
        body={t('sync.rollBackBody', { date: rollback?.createdAt ? fmt(rollback.createdAt) : '' })}
        confirmLabel={t('sync.rollBack')}
        onCancel={() => setRollback(null)}
        onConfirm={() => {
          const p = rollback!;
          setRollback(null);
          void run(() => rollBackTo(p), t('sync.rolledBack'));
        }}
      />
      <ConfirmDialog
        open={!!leave}
        title={leave === 'erase' ? t('sync.disconnectErase') : t('sync.disconnectKeep')}
        body={leave === 'erase' ? t('sync.eraseBody') : t('sync.keepBody')}
        confirmLabel={t('sync.disconnect')}
        onCancel={() => setLeave(null)}
        onConfirm={() => {
          const erase = leave === 'erase';
          setLeave(null);
          void run(() => disconnect({ eraseDrive: erase }), t('sync.disconnected'));
        }}
      />
    </>
  );
}

function ConflictRow({ c, busy, run }: { c: SyncConflict; busy: boolean; run: Run }) {
  const { t, i18n } = useTranslation();
  const kept = c.kept === 'local' ? c.local : c.remote;
  const other = c.kept === 'local' ? c.remote : c.local;
  const describe = (json: string | null) => {
    if (json === null) return t('sync.deleted');
    const r = JSON.parse(json) as Record<string, unknown>;
    const label = r.notes || r.name || r.title || c.rowId.slice(0, 8);
    const amount = typeof r.amountMinor === 'number' && typeof r.currency === 'string' ? ` · ${formatMoney(r.amountMinor, r.currency as CurrencyCode, i18n.language)}` : '';
    return `${String(label)}${amount}`;
  };
  return (
    <div className="space-y-1 border-t border-line pt-2 text-sm">
      <p className="text-xs text-ink-dim">{t(`sync.tables.${c.table}`, { defaultValue: c.table })}</p>
      <p><span className="text-ink-dim">{t('sync.kept')}: </span>{describe(kept)}</p>
      <p><span className="text-ink-dim">{t('sync.other')}: </span>{describe(other)}</p>
      <div className="flex gap-2">
        <Button variant="soft" className="flex-1" disabled={busy} onClick={() => void run(() => adoptOtherVersion(c.id), t('sync.switched'))}>{t('sync.useOther')}</Button>
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => void run(() => dismissConflict(c.id))}>{t('sync.keepThis')}</Button>
      </div>
    </div>
  );
}
