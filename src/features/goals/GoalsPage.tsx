import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Target, Trash2, Pencil } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useGoals, useGoalContributions } from '../../hooks/stage2';
import { useAccounts, useActiveProfileId } from '../../hooks/data';
import { createGoal, updateGoal, deleteGoal, contributeToGoal } from '../../db/goals';
import { setGoalAutoSave } from '../../db/goalAutoSave';
import { runChecks } from '../../services/scheduler';
import { goalProgressPct, estimateCompletionDate } from '../../engine/goals';
import { toMinor, minorToDecimalString, CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { SavingsGoal } from '../../db/types';

export default function GoalsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const goals = useGoals();
  const accounts = useAccounts();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('YER');
  const [targetDate, setTargetDate] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [autoMonthly, setAutoMonthly] = useState('');
  const [autoFrom, setAutoFrom] = useState('');
  const [autoDay, setAutoDay] = useState(1);
  const [error, setError] = useState('');

  const [contrib, setContrib] = useState<SavingsGoal | null>(null);
  const [contribMode, setContribMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [contribAmount, setContribAmount] = useState('');
  const [contribAccount, setContribAccount] = useState('');
  const contributions = useGoalContributions(contrib?.id ?? null);

  const [toDelete, setToDelete] = useState<SavingsGoal | null>(null);

  function openNew() {
    setEditing(null); setName(''); setTarget(''); setCurrency('YER');
    setTargetDate(''); setLinkedAccountId(''); setAutoMonthly(''); setAutoFrom(''); setAutoDay(1); setError('');
    setShowForm(true);
  }
  function openEdit(g: SavingsGoal) {
    setEditing(g); setName(g.name); setTarget(minorToDecimalString(g.targetMinor, g.currency));
    setCurrency(g.currency); setTargetDate(g.targetDate ?? ''); setLinkedAccountId(g.linkedAccountId ?? '');
    setAutoMonthly(g.autoMonthlyMinor ? minorToDecimalString(g.autoMonthlyMinor, g.currency) : '');
    setAutoFrom(g.autoFromAccountId ?? ''); setAutoDay(g.autoDay ?? 1);
    setError(''); setShowForm(true);
  }
  async function save() {
    if (!profileId) return;
    setError('');
    try {
      const targetMinor = toMinor(target, currency);
      const autoMonthlyMinor = autoMonthly ? toMinor(autoMonthly, currency) : 0;
      let goalId: string;
      if (editing) {
        await updateGoal(editing.id, { name, targetMinor, targetDate: targetDate || null, autoMonthlyMinor });
        goalId = editing.id;
      } else {
        goalId = (await createGoal({
          profileId, name, targetMinor, currency,
          targetDate: targetDate || null,
          linkedAccountId: linkedAccountId || null,
          autoMonthlyMinor,
        })).id;
      }
      // automatic saving needs a linked account, a source and an amount; otherwise it is off
      const auto = autoFrom && autoMonthlyMinor > 0 && (editing?.linkedAccountId ?? linkedAccountId)
        ? { amountMinor: autoMonthlyMinor, fromAccountId: autoFrom, day: autoDay } : null;
      // re-schedule only when the source or day changed (an amount change alone keeps the schedule)
      const sourceOrDayChanged =
        (auto?.fromAccountId ?? null) !== (editing?.autoFromAccountId ?? null) || (auto?.day ?? null) !== (editing?.autoDay ?? null);
      if (sourceOrDayChanged) await setGoalAutoSave(goalId, auto, todayISO());
      if (profileId) void runChecks(profileId);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function saveContribution() {
    if (!contrib) return;
    setError('');
    try {
      const sign = contribMode === 'deposit' ? 1 : -1;
      await contributeToGoal({
        goalId: contrib.id,
        amountMinor: sign * toMinor(contribAmount, contrib.currency),
        date: todayISO(),
        fromAccountId: contrib.linkedAccountId ? contribAccount || null : null,
      });
      setContrib(null);
      setContribAmount('');
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
        <h1 className="flex-1 text-xl font-bold">{t('goals.title')}</h1>
        <Button variant="soft" onClick={openNew}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      {goals.length === 0 ? (
        <EmptyState icon={<Target size={40} />} text={t('goals.empty')} />
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const pct = goalProgressPct(g);
            const done = g.status === 'completed';
            return (
              <Card key={g.id} className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{g.name}</span>
                    {g.targetDate && (
                      <span className="block text-xs text-ink-dim">{formatDate(g.targetDate, i18n.language, calendar)}</span>
                    )}
                  </span>
                  <button onClick={() => openEdit(g)} className="p-2 text-ink-dim" aria-label={t('common.edit')}><Pencil size={15} /></button>
                  <button onClick={() => setToDelete(g)} className="p-2 text-ink-dim" aria-label={t('common.delete')}><Trash2 size={15} /></button>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" dir="ltr">
                  <div className={`h-full rounded-full ${done ? 'bg-income' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-baseline justify-between text-xs">
                  <span>
                    {t('goals.saved')}: <MoneyText minor={g.savedMinor} currency={g.currency} kind="income" /> /{' '}
                    <MoneyText minor={g.targetMinor} currency={g.currency} />
                  </span>
                  <span className="font-semibold">{pct}%</span>
                </div>
                {done ? (
                  <p className="mt-1 text-xs text-income">{t('goals.completed')}</p>
                ) : (
                  <GoalEstimate goal={g} />
                )}
                <div className="mt-2 flex gap-2">
                  <Button variant="soft" onClick={() => { setContrib(g); setContribMode('deposit'); setContribAmount(''); setContribAccount(''); setError(''); }}>
                    {t('goals.deposit')}
                  </Button>
                  {g.savedMinor > 0 && (
                    <Button variant="ghost" onClick={() => { setContrib(g); setContribMode('withdraw'); setContribAmount(''); setContribAccount(''); setError(''); }}>
                      {t('goals.withdraw')}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* goal form */}
      <Sheet open={showForm} onClose={() => setShowForm(false)} title={editing ? t('goals.editTitle') : t('goals.addTitle')}>
        <div className="space-y-4">
          <Field label={t('common.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('goals.target')}>
              <TextInput inputMode="decimal" dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t('common.currency')}>
              <Select value={currency} disabled={!!editing} onChange={(e) => { setCurrency(e.target.value as CurrencyCode); setLinkedAccountId(''); }}>
                {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('goals.targetDate')}>
            <TextInput type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          {!editing && (
            <Field label={t('goals.linkedAccount')} hint={t('goals.linkedHint')}>
              <Select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {accounts.filter((a) => a.currency === currency && a.type === 'savings').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('goals.autoMonthly')}>
            <TextInput inputMode="decimal" dir="ltr" value={autoMonthly} onChange={(e) => setAutoMonthly(e.target.value)} placeholder="0" />
          </Field>
          <div className="rounded-2xl border border-line p-3">
            <p className="mb-2 text-sm font-semibold">{t('autoSave.title')}</p>
            {(editing?.linkedAccountId ?? linkedAccountId) ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('autoSave.fromAccount')}>
                    <Select value={autoFrom} onChange={(e) => setAutoFrom(e.target.value)}>
                      <option value="">{t('autoSave.off')}</option>
                      {accounts.filter((a) => a.currency === currency && a.id !== (editing?.linkedAccountId ?? linkedAccountId)).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('autoSave.day')}>
                    <Select value={autoDay} disabled={!autoFrom} onChange={(e) => setAutoDay(Number(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </Select>
                  </Field>
                </div>
                <p className="text-xs text-ink-dim">{t('autoSave.hint')}</p>
              </div>
            ) : (
              <p className="text-xs text-ink-dim">{t('autoSave.needsLinked')}</p>
            )}
          </div>
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void save()} disabled={!name.trim() || !target}>
            {t('common.save')}
          </Button>
        </div>
      </Sheet>

      {/* contribute */}
      <Sheet open={contrib !== null} onClose={() => setContrib(null)} title={contribMode === 'deposit' ? t('goals.deposit') : t('goals.withdraw')}>
        {contrib && (
          <div className="space-y-4">
            <Field label={t('common.amount')}>
              <TextInput inputMode="decimal" dir="ltr" value={contribAmount} onChange={(e) => setContribAmount(e.target.value)} placeholder="0" />
            </Field>
            {contrib.linkedAccountId && (
              <Field label={contribMode === 'deposit' ? t('goals.fromAccount') : t('goals.toAccountW')}>
                <Select value={contribAccount} onChange={(e) => setContribAccount(e.target.value)}>
                  <option value="">—</option>
                  {accounts
                    .filter((a) => a.currency === contrib.currency && a.id !== contrib.linkedAccountId)
                    .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}
            {contributions.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-dim">{t('goals.history')}</p>
                <Card className="max-h-40 overflow-y-auto px-3">
                  {contributions.map((c) => (
                    <div key={c.id} className="flex justify-between py-1.5 text-xs">
                      <span className="text-ink-dim">{formatDate(c.date, i18n.language, calendar)}</span>
                      <MoneyText minor={c.amountMinor} currency={contrib.currency} kind={c.amountMinor > 0 ? 'income' : 'expense'} signed />
                    </div>
                  ))}
                </Card>
              </div>
            )}
            {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
            <Button className="w-full" onClick={() => void saveContribution()} disabled={!contribAmount || (Boolean(contrib.linkedAccountId) && !contribAccount)}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={t('common.confirmDeleteBody')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void deleteGoal(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}

function GoalEstimate({ goal }: { goal: SavingsGoal }) {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const contributions = useGoalContributions(goal.id);
  const est = estimateCompletionDate(goal, contributions.filter((c) => c.amountMinor > 0), todayISO());
  return (
    <p className="mt-1 text-xs text-ink-dim">
      {est ? t('goals.estCompletion', { date: formatDate(est, i18n.language, calendar) }) : t('goals.noEstimate')}
    </p>
  );
}
