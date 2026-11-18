import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2, CloudOff } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, EmptyState } from '../../components/ui';
import { addRate, correctRate, deleteRate, listRates } from '../../db/rates';
import { todayISO } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { CurrencyCode } from '../../engine/money';
import type { ExchangeRate } from '../../db/types';

export default function RatesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const [currency, setCurrency] = useState<Exclude<CurrencyCode, 'YER'>>('USD');
  const rates = useLiveQuery(() => listRates(currency), [currency]) ?? [];
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExchangeRate | null>(null);
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState('');

  async function save() {
    setError('');
    try {
      const value = Number(rate);
      if (!(value > 0)) throw new Error(t('common.error'));
      if (editing) await correctRate(editing.id, value);
      else await addRate({ currency, rateToBase: value, date });
      setShowForm(false);
      setRate('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('rates.title')}</h1>
        <Button variant="soft" onClick={() => { setEditing(null); setRate(''); setDate(todayISO()); setShowForm(true); }}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('rates.addRate')}</span>
        </Button>
      </div>

      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('rates.hint')}</p>

      <div className="mb-3">
        <Segmented
          options={[
            { value: 'USD' as const, label: 'USD' },
            { value: 'SAR' as const, label: 'SAR' },
          ]}
          value={currency}
          onChange={setCurrency}
        />
      </div>

      {rates.length > 0 && (
        <Card className="mb-3 p-4">
          <p className="text-xs text-ink-dim">{t('rates.current')}</p>
          <p className="mt-1 text-2xl font-bold" dir="ltr">
            1 {currency} = {rates[0].rateToBase} YER
          </p>
          <p className="mt-1 text-xs text-ink-dim">
            {t('rates.effectiveFrom')}: {formatDate(rates[0].date, i18n.language, calendar)}
          </p>
        </Card>
      )}

      {rates.length === 0 ? (
        <EmptyState text={t('rates.noRates', { currency })} />
      ) : (
        <>
          <h2 className="mb-1 px-1 text-xs font-semibold text-ink-dim">{t('rates.history')}</h2>
          <Card className="px-2">
            {rates.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-2.5">
                <span className="flex-1">
                  <span className="block text-sm font-medium" dir="ltr">1 {r.currency} = {r.rateToBase} YER</span>
                  <span className="block text-xs text-ink-dim">
                    {formatDate(r.date, i18n.language, calendar)} · {t(`rates.${r.source}`)}
                  </span>
                </span>
                <button onClick={() => { setEditing(r); setRate(String(r.rateToBase)); setDate(r.date); setShowForm(true); }} className="p-2 text-ink-dim" aria-label={t('common.edit')}>
                  <Pencil size={15} />
                </button>
                <button onClick={() => void deleteRate(r.id)} className="p-2 text-ink-dim" aria-label={t('common.delete')}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </Card>
        </>
      )}

      <p className="mt-3 flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">
        <CloudOff size={14} /> {t('rates.autoUpdatePending')}
      </p>

      <Sheet open={showForm} onClose={() => setShowForm(false)} title={editing ? t('rates.correct') : t('rates.addRate')}>
        <div className="space-y-4">
          {!editing && (
            <Field label={t('common.currency')}>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'SAR')}>
                <option value="USD">USD</option>
                <option value="SAR">SAR</option>
              </Select>
            </Field>
          )}
          <Field label={`1 ${currency} = ? YER`}>
            <TextInput inputMode="decimal" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
          </Field>
          {!editing && (
            <Field label={t('rates.effectiveFrom')}>
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void save()} disabled={!rate}>
            {t('common.save')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
