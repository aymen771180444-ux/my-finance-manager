import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2, PiggyBank } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useBudgetsWithStatus } from '../../hooks/stage2';
import { useCategories, useActiveProfileId } from '../../hooks/data';
import { createBudget, updateBudget, deleteBudget } from '../../db/budgets';
import { toMinor, minorToDecimalString, formatMoney } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { categoryName } from '../../components/CategoryBadge';
import { runChecks } from '../../services/scheduler';
import type { Budget, BudgetPeriod } from '../../db/types';

export default function BudgetsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const rows = useBudgetsWithStatus();
  const expenseCats = useCategories('expense').filter((c) => !c.parentId);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'overall' | 'category'>('overall');
  const [categoryId, setCategoryId] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [amount, setAmount] = useState('');
  const [rollover, setRollover] = useState(true);
  const [alerts, setAlerts] = useState(true);
  const [toDelete, setToDelete] = useState<Budget | null>(null);
  const [error, setError] = useState('');

  function openNew() {
    setEditing(null); setName(''); setScope('overall'); setCategoryId('');
    setPeriod('monthly'); setAmount(''); setRollover(true); setAlerts(true);
    setError(''); setShowForm(true);
  }
  function openEdit(b: Budget) {
    setEditing(b); setName(b.name);
    setScope(b.categoryId ? 'category' : 'overall'); setCategoryId(b.categoryId ?? '');
    setPeriod(b.period); setAmount(minorToDecimalString(b.amountMinor, 'YER'));
    setRollover(b.rolloverEnabled); setAlerts(b.alertsEnabled);
    setError(''); setShowForm(true);
  }
  async function save() {
    if (!profileId) return;
    setError('');
    try {
      const amountMinor = toMinor(amount, 'YER');
      if (editing) {
        await updateBudget(editing.id, { name, amountMinor, rolloverEnabled: rollover, alertsEnabled: alerts });
      } else {
        await createBudget({
          profileId, name, categoryId: scope === 'category' ? categoryId : null,
          period, amountMinor, startDate: todayISO().slice(0, 8) + '01',
          rolloverEnabled: rollover, alertsEnabled: alerts,
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
        <h1 className="flex-1 text-xl font-bold">{t('budgets.title')}</h1>
        <Button variant="soft" onClick={openNew}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<PiggyBank size={40} />} text={t('budgets.empty')} />
      ) : (
        <div className="space-y-3">
          {rows.map(({ budget, status }) => {
            const over = status.remainingMinor < 0;
            const pctClamped = Math.min(100, status.pct);
            const barColor = over ? 'bg-expense' : status.pct >= 90 ? 'bg-liability' : 'bg-primary';
            const cat = budget.categoryId ? expenseCats.find((c) => c.id === budget.categoryId) : null;
            return (
              <Card key={budget.id} className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{budget.name}</span>
                    <span className="block text-xs text-ink-dim">
                      {t(`budgets.periods.${budget.period}`)}
                      {cat ? ` · ${categoryName(cat, i18n.language)}` : ` · ${t('budgets.overall')}`}
                    </span>
                  </span>
                  <button onClick={() => openEdit(budget)} className="p-2 text-ink-dim" aria-label={t('common.edit')}><Pencil size={15} /></button>
                  <button onClick={() => setToDelete(budget)} className="p-2 text-ink-dim" aria-label={t('common.delete')}><Trash2 size={15} /></button>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" dir="ltr">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pctClamped}%` }} />
                </div>
                <div className="mt-2 flex items-baseline justify-between text-xs">
                  <span>
                    {t('budgets.spent')}: <MoneyText minor={status.spentMinor} currency="YER" kind={over ? 'expense' : 'neutral'} />{' '}
                    <span className="text-ink-dim">{t('budgets.ofBudget', { amount: formatMoney(status.effectiveLimitMinor, 'YER', i18n.language) })}</span>
                  </span>
                  <span className={over ? 'font-semibold text-expense' : 'text-ink-dim'}>
                    {over ? t('budgets.overBudget') : `${t('budgets.remaining')}: ${formatMoney(status.remainingMinor, 'YER', i18n.language)}`}
                  </span>
                </div>
                {status.rolloverMinor > 0 && (
                  <p className="mt-1 text-xs text-income">{t('budgets.rolloverNote', { amount: formatMoney(status.rolloverMinor, 'YER', i18n.language) })}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={showForm} onClose={() => setShowForm(false)} title={editing ? t('budgets.editTitle') : t('budgets.addTitle')}>
        <div className="space-y-4">
          <Field label={t('common.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!editing && (
            <>
              <Segmented
                options={[
                  { value: 'overall' as const, label: t('budgets.overall') },
                  { value: 'category' as const, label: t('budgets.forCategory') },
                ]}
                value={scope}
                onChange={setScope}
              />
              {scope === 'category' && (
                <Field label={t('common.category')}>
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">—</option>
                    {expenseCats.map((c) => (
                      <option key={c.id} value={c.id}>{categoryName(c, i18n.language)}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t('budgets.period')}>
                <Select value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}>
                  {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((p) => (
                    <option key={p} value={p}>{t(`budgets.periods.${p}`)}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label={t('budgets.amount')}>
            <TextInput inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} /> {t('budgets.rollover')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} /> {t('budgets.alerts')}
          </label>
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void save()} disabled={!name.trim() || !amount || (scope === 'category' && !categoryId)}>
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
          if (toDelete) void deleteBudget(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
