import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, RefreshCw, Trash2, Pencil, Pause, Play } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useRecurring } from '../../hooks/stage2';
import { useAccounts, useCategories, useActiveProfileId } from '../../hooks/data';
import { createRecurring, updateRecurring, deleteRecurring } from '../../db/recurring';
import { nextDueDate } from '../../engine/recurring';
import { toMinor, minorToDecimalString } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import { categoryName } from '../../components/CategoryBadge';
import { runChecks } from '../../services/scheduler';
import type { RecurringObligation, RecurringFrequency } from '../../db/types';

export default function RecurringPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const rows = useRecurring();
  const accounts = useAccounts();
  const expenseCats = useCategories('expense').filter((c) => !c.parentId);
  const incomeCats = useCategories('income').filter((c) => !c.parentId);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const today = todayISO();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringObligation | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [mode, setMode] = useState<'auto' | 'remind'>('remind');
  const [remindDays, setRemindDays] = useState('3');
  const [toDelete, setToDelete] = useState<RecurringObligation | null>(null);
  const [error, setError] = useState('');

  const cats = kind === 'expense' ? expenseCats : incomeCats;

  function openNew() {
    setEditing(null); setName(''); setKind('expense'); setAmount(''); setAccountId('');
    setCategoryId(''); setFrequency('monthly'); setStartDate(today); setEndDate('');
    setMode('remind'); setRemindDays('3'); setError(''); setShowForm(true);
  }
  function openEdit(r: RecurringObligation) {
    setEditing(r); setName(r.name); setKind(r.kind);
    setAmount(minorToDecimalString(r.amountMinor, 'YER')); setAccountId(r.accountId);
    setCategoryId(r.categoryId ?? ''); setFrequency(r.frequency); setStartDate(r.startDate);
    setEndDate(r.endDate ?? ''); setMode(r.mode); setRemindDays(String(r.remindDaysBefore));
    setError(''); setShowForm(true);
  }
  async function save() {
    if (!profileId) return;
    setError('');
    try {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new Error(t('common.error'));
      const amountMinor = toMinor(amount, account.currency);
      if (editing) {
        await updateRecurring(editing.id, {
          name, amountMinor, mode,
          remindDaysBefore: Number(remindDays) || 3,
          endDate: endDate || null,
          categoryId: categoryId || null,
        });
      } else {
        await createRecurring({
          profileId, name, kind, amountMinor, accountId,
          categoryId: categoryId || null, frequency, startDate,
          endDate: endDate || null, mode, remindDaysBefore: Number(remindDays) || 3,
        });
      }
      setShowForm(false);
      void runChecks(profileId);
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
        <h1 className="flex-1 text-xl font-bold">{t('recurring.title')}</h1>
        <Button variant="soft" onClick={openNew}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<RefreshCw size={40} />} text={t('recurring.empty')} />
      ) : (
        <Card className="px-2">
          {rows.map((r) => {
            const account = accounts.find((a) => a.id === r.accountId);
            const next = r.status === 'active' ? nextDueDate(r, today) : null;
            const cat = r.categoryId ? cats.find((c) => c.id === r.categoryId) : null;
            return (
              <div key={r.id} className="flex items-center gap-3 px-2 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {r.name}
                    {r.status === 'paused' && <span className="ms-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-dim">{t('recurring.paused')}</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-dim">
                    {t(`recurring.freq.${r.frequency}`)} · {t(r.mode === 'auto' ? 'recurring.autoMode' : 'recurring.remindMode')}
                    {cat ? ` · ${categoryName(cat, i18n.language)}` : ''}
                  </span>
                  <span className="block text-xs text-ink-dim">
                    {next ? t('recurring.nextDue', { date: formatDate(next, i18n.language, calendar) }) : r.status === 'active' ? t('recurring.ended') : ''}
                  </span>
                </span>
                {account && (
                  <MoneyText minor={r.amountMinor} currency={account.currency} kind={r.kind === 'income' ? 'income' : 'expense'} className="text-sm" />
                )}
                <button
                  onClick={() => void updateRecurring(r.id, { status: r.status === 'active' ? 'paused' : 'active' })}
                  className="p-2 text-ink-dim"
                  aria-label={r.status === 'active' ? t('recurring.pause') : t('recurring.resume')}
                >
                  {r.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button onClick={() => openEdit(r)} className="p-2 text-ink-dim" aria-label={t('common.edit')}><Pencil size={15} /></button>
                <button onClick={() => setToDelete(r)} className="p-2 text-ink-dim" aria-label={t('common.delete')}><Trash2 size={15} /></button>
              </div>
            );
          })}
        </Card>
      )}

      <Sheet open={showForm} onClose={() => setShowForm(false)} title={editing ? t('recurring.editTitle') : t('recurring.addTitle')}>
        <div className="space-y-4">
          <Field label={t('common.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!editing && (
            <Segmented
              options={[
                { value: 'expense' as const, label: t('recurring.expense') },
                { value: 'income' as const, label: t('recurring.income') },
              ]}
              value={kind}
              onChange={(v) => { setKind(v); setCategoryId(''); }}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.amount')}>
              <TextInput inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t('common.account')}>
              <Select value={accountId} disabled={!!editing} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('common.category')}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{categoryName(c, i18n.language)}</option>)}
            </Select>
          </Field>
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('recurring.frequency')}>
                <Select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                  {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((f) => (
                    <option key={f} value={f}>{t(`recurring.freq.${f}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('budgets.startDate')}>
                <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label={t('budgets.endDate')}>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label={t('recurring.mode')}>
            <Segmented
              options={[
                { value: 'remind' as const, label: t('recurring.remindMode') },
                { value: 'auto' as const, label: t('recurring.autoMode') },
              ]}
              value={mode}
              onChange={setMode}
            />
          </Field>
          <Field label={t('recurring.remindDays')}>
            <TextInput inputMode="numeric" dir="ltr" value={remindDays} onChange={(e) => setRemindDays(e.target.value)} />
          </Field>
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void save()} disabled={!name.trim() || !amount || !accountId}>
            {t('common.save')}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={t('common.confirmDeleteBody')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void deleteRecurring(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
