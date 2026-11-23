import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, FileSpreadsheet, Printer } from 'lucide-react';
import { Card, Button, Field, Select, TextInput } from '../../components/ui';
import { useAccounts, useCategories, useActiveProfileId } from '../../hooks/data';
import { db } from '../../db/schema';
import { loadReportData } from '../../db/reportData';
import { buildReport, type ReportType, type ReportDoc } from '../../engine/reports';
import { CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { categoryName } from '../../components/CategoryBadge';
import { monthRange, formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import { ReportView } from './ReportView';
import { exportReportXlsx } from '../../lib/exportXlsx';
import { isNativeApp } from '../../lib/platform';

const TYPES: ReportType[] = ['comprehensive', 'expense', 'income', 'debt', 'account', 'networth', 'custom'];

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const accounts = useAccounts(true);
  const categories = useCategories().filter((c) => !c.parentId);
  const tags = useLiveQuery(() => (profileId ? db.tags.where('profileId').equals(profileId).toArray() : []), [profileId]) ?? [];
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [type, setType] = useState<ReportType>('comprehensive');
  const initial = monthRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [accountId, setAccountId] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [tagId, setTagId] = useState('');
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (!profileId || from > to) return;
    setError('');
    setBusy(true);
    try {
      const data = await loadReportData(profileId, from, to, tagId || null);
      setDoc(
        buildReport(type, data, { from, to, accountId: accountId || null, currency: currency || null, categoryId: categoryId || null, tagId: tagId || null }, (k, p) => String(t(k, p as never)), i18n.language),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    if (!doc) return;
    setBusy(true);
    setError('');
    try {
      await exportReportXlsx(doc, {
        rtl: i18n.dir() === 'rtl',
        periodLabel: `${t('reports.period')}: ${formatDate(doc.from, i18n.language, calendar)} – ${formatDate(doc.to, i18n.language, calendar)}`,
        generatedLabel: `${t('reports.generatedOn')}: ${new Date().toLocaleString(i18n.language)}`,
        filename: `report-${doc.type}-${doc.from}-${doc.to}.xlsx`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="no-print mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('reports.title')}</h1>
      </div>

      <Card className="no-print mb-3 space-y-3 p-4">
        <Field label={t('reports.type')}>
          <Select value={type} onChange={(e) => { setType(e.target.value as ReportType); setDoc(null); }}>
            {TYPES.map((ty) => <option key={ty} value={ty}>{t(`reports.types.${ty}`)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('txn.from')}><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('txn.to')}><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t('common.account')}>
            <option value="">{t('reports.allAccounts')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode | '')} aria-label={t('common.currency')}>
            <option value="">{t('reports.allCurrencies')}</option>
            {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={t('common.category')}>
            <option value="">{t('reports.allCategories')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{categoryName(c, i18n.language)}</option>)}
          </Select>
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label={t('tags.filter')}>
            <option value="">{t('reports.allTags')}</option>
            {tags.map((tg) => <option key={tg.id} value={tg.id}>#{tg.name}</option>)}
          </Select>
        </div>
        <Button className="w-full" onClick={() => void generate()} disabled={busy || from > to}>
          {busy ? t('reports.exporting') : t('reports.generate')}
        </Button>
      </Card>

      {error && <p className="no-print mb-3 rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}

      {doc && (
        <>
          <div className="no-print mb-3 flex gap-2">
            <Button variant="soft" className="flex-1" onClick={() => void exportExcel()} disabled={busy}>
              <span className="inline-flex items-center gap-1"><FileSpreadsheet size={16} /> {t('reports.exportExcel')}</span>
            </Button>
            {!isNativeApp() && (
              <Button variant="soft" className="flex-1" onClick={() => window.print()}>
                <span className="inline-flex items-center gap-1"><Printer size={16} /> {t('reports.exportPdf')}</span>
              </Button>
            )}
          </div>
          <p className="no-print mb-2 px-1 text-[11px] text-ink-dim">{t(isNativeApp() ? 'reports.pdfNative' : 'reports.pdfHint')}</p>
          <ReportView doc={doc} />
        </>
      )}
    </div>
  );
}
