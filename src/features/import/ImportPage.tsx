import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, FileUp, CheckCircle2, AlertTriangle, Copy } from 'lucide-react';
import { Card, Button, Field, Select } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useAccounts, useActiveProfileId } from '../../hooks/data';
import { useLock } from '../../store/lock';
import { db } from '../../db/schema';
import { commitImport } from '../../db/importer';
import { quietly } from '../../db/audit';
import { toast } from '../../store/toast';
import { parseCsv, guessColumns, guessDateFormat, buildRows, IMPORT_FIELDS, type ColumnMap, type DateFormat, type ImportField } from '../../engine/csvImport';
import { runChecks } from '../../services/scheduler';

export default function ImportPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const profileId = useActiveProfileId();
  const accounts = useAccounts();
  const allowBackground = useLock((s) => s.allowBackground);
  const categories = useLiveQuery(() => (profileId ? db.categories.where('profileId').equals(profileId).toArray() : []), [profileId]) ?? [];
  const existing = useLiveQuery(() => (profileId ? db.transactions.where('profileId').equals(profileId).toArray() : []), [profileId]) ?? [];

  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy');
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; tagName: string } | null>(null);
  const [error, setError] = useState('');

  function load(file: File) {
    setDone(null);
    setError('');
    setFileName(file.name);
    void file.text().then((text) => {
      const parsed = parseCsv(text);
      if (parsed.length < 1) {
        setError(t('import.empty'));
        return;
      }
      const guessed = guessColumns(parsed[0]);
      const header = Object.keys(guessed).length >= 2;
      setHasHeader(header);
      setMap(header ? guessed : {});
      const dateCol = guessed.date;
      if (dateCol !== undefined) setDateFormat(guessDateFormat(parsed.slice(1, 40).map((r) => r[dateCol] ?? '').filter(Boolean)));
      setTable(parsed);
    });
  }

  const rows = useMemo(() => {
    if (!table) return [];
    const built = buildRows(table, { map, dateFormat, defaultAccountId: defaultAccountId || null, hasHeader }, { accounts, categories, existing });
    return includeDuplicates ? built.map((r) => (r.status === 'duplicate' ? { ...r, status: 'ok' as const } : r)) : built;
  }, [table, map, dateFormat, defaultAccountId, hasHeader, accounts, categories, existing, includeDuplicates]);

  const counts = useMemo(() => ({
    ok: rows.filter((r) => r.status === 'ok').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    error: rows.filter((r) => r.status === 'error').length,
  }), [rows]);

  const columns = table ? (hasHeader ? table[0] : table[0].map((_, i) => `${t('import.column')} ${i + 1}`)) : [];
  const accById = new Map(accounts.map((a) => [a.id, a]));

  async function doImport() {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      // one summary pop-up instead of one per imported row
      const r = await quietly(() => commitImport(profileId, rows));
      toast(t('toast.imported', { count: r.count }));
      setDone(r);
      setTable(null);
      void runChecks(profileId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="text-xl font-bold">{t('import.title')}</h1>
      </div>
      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('import.hint')}</p>

      {accounts.length === 0 && (
        <Card className="mb-3 flex items-center gap-3 p-4">
          <AlertTriangle className="shrink-0 text-liability" />
          <p className="flex-1 text-sm">{t('import.noAccounts')}</p>
          <Button variant="soft" onClick={() => navigate('/accounts')}>{t('import.addAccount')}</Button>
        </Card>
      )}

      {done && (
        <Card className="mb-3 flex items-start gap-3 p-4">
          <CheckCircle2 className="shrink-0 text-income" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{t('import.done', { count: done.count })}</p>
            <p className="mt-1 text-xs text-ink-dim">{t('import.doneTag', { tag: done.tagName })}</p>
            <Button variant="soft" className="mt-2" onClick={() => navigate('/transactions')}>{t('dashboard.viewAll')}</Button>
          </div>
        </Card>
      )}

      <Card className="mb-3 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <FileUp className="shrink-0 text-primary" />
          <span className="flex-1 text-sm font-medium">{fileName || t('import.choose')}</span>
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onClick={() => allowBackground(5 * 60_000)}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
        </label>
      </Card>

      {error && <p className="mb-3 rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense" role="alert">{error}</p>}

      {table && (
        <>
          <Card className="mb-3 space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('import.mapping')}</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> {t('import.hasHeader')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {IMPORT_FIELDS.map((f: ImportField) => (
                <Field key={f} label={t(`import.fields.${f}`)}>
                  <Select value={map[f] ?? ''} onChange={(e) => setMap({ ...map, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                    <option value="">—</option>
                    {columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('import.dateFormat')}>
                <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                  <option value="dmy">DD/MM/YYYY</option>
                  <option value="mdy">MM/DD/YYYY</option>
                  <option value="ymd">YYYY-MM-DD</option>
                </Select>
              </Field>
              <Field label={t('import.defaultAccount')}>
                <Select value={defaultAccountId} onChange={(e) => setDefaultAccountId(e.target.value)}>
                  <option value="">—</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-ink-dim">{t('import.signHint')}</p>
          </Card>

          <Card className="mb-3 p-4">
            <div className="mb-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-2xl bg-income-soft p-2 text-income"><p className="text-lg font-bold">{counts.ok}</p>{t('import.ready')}</div>
              <div className="rounded-2xl bg-surface-2 p-2 text-ink-dim"><p className="text-lg font-bold">{counts.duplicate}</p>{t('import.duplicates')}</div>
              <div className="rounded-2xl bg-expense-soft p-2 text-expense"><p className="text-lg font-bold">{counts.error}</p>{t('import.errors')}</div>
            </div>
            {(counts.duplicate > 0 || includeDuplicates) && (
              <label className="mb-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} /> {t('import.includeDuplicates')}
              </label>
            )}
            <div className="max-h-80 overflow-y-auto">
              {rows.slice(0, 200).map((r) => (
                <div key={r.line} className="flex items-center gap-2 border-b border-line py-1.5 text-xs last:border-0">
                  <span className="w-8 shrink-0 text-ink-dim" dir="ltr">#{r.line}</span>
                  {r.status === 'error' ? (
                    <span className="flex flex-1 items-center gap-1 text-expense"><AlertTriangle size={12} /> {t(`import.reasons.${r.error}`)} <span className="truncate text-ink-dim" dir="auto">— {r.raw.join(' | ')}</span></span>
                  ) : (
                    <>
                      {r.status === 'duplicate' && <Copy size={12} className="shrink-0 text-ink-dim" aria-label={t('import.duplicates')} />}
                      <span className="w-20 shrink-0 text-ink-dim">{r.date}</span>
                      <span className="min-w-0 flex-1 truncate">{t(`txn.types.${r.type}`)}{r.notes ? ` · ${r.notes}` : ''}</span>
                      <MoneyText minor={r.amountMinor!} currency={accById.get(r.accountId!)?.currency ?? 'YER'} kind={r.type === 'income' ? 'income' : r.type === 'expense' ? 'expense' : 'transfer'} className="text-xs" respectHide={false} />
                    </>
                  )}
                </div>
              ))}
              {rows.length > 200 && <p className="pt-2 text-center text-xs text-ink-dim">{t('import.more', { count: rows.length - 200 })}</p>}
            </div>
          </Card>

          <Button className="w-full" disabled={busy || counts.ok === 0} onClick={() => void doImport()}>
            {busy ? t('security.working') : t('import.go', { count: counts.ok })}
          </Button>
        </>
      )}
    </div>
  );
}
