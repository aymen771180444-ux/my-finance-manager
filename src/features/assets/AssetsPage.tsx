import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Plus, Gem } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useAssets, useAssetValuations } from '../../hooks/stage4';
import { useActiveProfileId } from '../../hooks/data';
import { createAsset, revalueAsset, updateAsset, deleteAsset } from '../../db/assets';
import { latestRatesMap } from '../../db/reportData';
import { toMinor, convertToBase, CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { Asset, AssetKind } from '../../db/types';
import { AttachmentList } from '../../components/AttachmentList';

const KINDS: AssetKind[] = ['cash_savings', 'gold', 'financial', 'other'];

export default function AssetsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const assets = useAssets();
  const rates = useLiveQuery(() => latestRatesMap(), []);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AssetKind>('gold');
  const [currency, setCurrency] = useState<CurrencyCode>('YER');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(todayISO());
  const [qtyNote, setQtyNote] = useState('');
  const [selected, setSelected] = useState<Asset | null>(null);
  const [newValue, setNewValue] = useState('');
  const [newDate, setNewDate] = useState(todayISO());
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  const [error, setError] = useState('');
  const current = selected ? assets.find((a) => a.id === selected.id) ?? null : null;
  const history = useAssetValuations(current?.id ?? null);

  const total = useMemo(() => {
    let sum = 0;
    let missing = false;
    for (const a of assets) {
      if (a.status !== 'active') continue;
      const r = a.currency === 'YER' ? 1 : rates?.get(a.currency);
      if (r === undefined) missing = true;
      else sum += convertToBase(a.valueMinor, a.currency, r);
    }
    return { sum, missing };
  }, [assets, rates]);

  async function add() {
    if (!profileId) return;
    setError('');
    try {
      await createAsset({ profileId, name, kind, currency, valueMinor: toMinor(value, currency), valuationDate: date, quantityNote: qtyNote });
      setShowAdd(false);
      setName(''); setValue(''); setQtyNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="flex-1 text-xl font-bold">{t('assets.title')}</h1>
        <Button variant="soft" onClick={() => { setError(''); setDate(todayISO()); setShowAdd(true); }}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>
      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('assets.hint')}</p>

      {assets.length > 0 && (
        <Card className="mb-3 p-4">
          <p className="text-xs text-ink-dim">{t('assets.total')}</p>
          <p className="text-2xl font-bold"><MoneyText minor={total.sum} currency="YER" /></p>
          {total.missing && <p className="mt-1 text-xs text-liability">{t('common.cannotConvert')}</p>}
        </Card>
      )}

      {assets.length === 0 ? (
        <EmptyState icon={<Gem size={40} />} text={t('assets.empty')} />
      ) : (
        <Card className="px-2">
          {assets.map((a) => (
            <button key={a.id} onClick={() => { setError(''); setNewValue(''); setNewDate(todayISO()); setSelected(a); }} className={`flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-start active:bg-surface-2 ${a.status !== 'active' ? 'opacity-50' : ''}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Gem size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.name}{a.status !== 'active' && ` · ${t('assets.disposed')}`}</span>
                <span className="block truncate text-xs text-ink-dim">
                  {t(`assets.kinds.${a.kind}`)}{a.quantityNote && ` · ${a.quantityNote}`} · {t('assets.asOf', { date: formatDate(a.valuationDate, lang, calendar) })}
                </span>
              </span>
              <MoneyText minor={a.valueMinor} currency={a.currency} className="text-sm" />
            </button>
          ))}
        </Card>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title={t('assets.addTitle')}>
        <div className="space-y-3">
          <Field label={t('common.name')}><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('txn.type')}><Select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>{KINDS.map((k) => <option key={k} value={k}>{t(`assets.kinds.${k}`)}</option>)}</Select></Field>
            <Field label={t('common.currency')}><Select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('assets.value')}><TextInput dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" /></Field>
            <Field label={t('assets.valuationDate')}><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label={t('assets.quantityNote')}><TextInput value={qtyNote} onChange={(e) => setQtyNote(e.target.value)} /></Field>
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void add()} disabled={!name.trim() || !value}>{t('common.save')}</Button>
        </div>
      </Sheet>

      <Sheet open={current !== null} onClose={() => setSelected(null)} title={current?.name ?? ''}>
        {current && (
          <div className="space-y-3">
            <p className="text-2xl font-bold"><MoneyText minor={current.valueMinor} currency={current.currency} /></p>
            <p className="text-xs text-ink-dim">{t('assets.asOf', { date: formatDate(current.valuationDate, lang, calendar) })}</p>
            {current.status === 'active' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('assets.value')}><TextInput dir="ltr" inputMode="decimal" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="0" /></Field>
                  <Field label={t('assets.valuationDate')}><TextInput type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></Field>
                </div>
                <Button
                  className="w-full"
                  disabled={!newValue}
                  onClick={() => {
                    setError('');
                    try {
                      void revalueAsset(current.id, toMinor(newValue, current.currency), newDate).then(() => setNewValue('')).catch((e) => setError(String(e)));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  {t('assets.revalue')}
                </Button>
              </>
            )}
            <AttachmentList ownerType="asset" ownerId={current.id} />
            {history.length > 0 && (
              <Card className="max-h-48 overflow-y-auto px-3">
                {history.map((v) => (
                  <div key={v.id} className="flex justify-between py-1.5 text-xs">
                    <span className="text-ink-dim">{formatDate(v.date, lang, calendar)}</span>
                    <MoneyText minor={v.valueMinor} currency={current.currency} respectHide={false} />
                  </div>
                ))}
              </Card>
            )}
            {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
            <div className="flex gap-2">
              {current.status === 'active' && (
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    // disposal records a zero value on today's date so historical net worth stays correct
                    void revalueAsset(current.id, 0, todayISO()).then(() => updateAsset(current.id, { status: 'disposed' }));
                  }}
                >
                  {t('assets.dispose')}
                </Button>
              )}
              <Button variant="danger" className="flex-1" onClick={() => setToDelete(current)}>{t('common.delete')}</Button>
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={t('common.confirmDeleteBody')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void deleteAsset(toDelete.id).then(() => setSelected(null));
          setToDelete(null);
        }}
      />
    </div>
  );
}
