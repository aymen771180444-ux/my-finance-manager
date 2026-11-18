import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, HandCoins, Trash2 } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useDebts, useDebtRepayments } from '../../hooks/stage2';
import { useAccounts, useActiveProfileId } from '../../hooks/data';
import { createDebt, repayDebt, deleteDebt } from '../../db/debts';
import { toMinor, CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import { runChecks } from '../../services/scheduler';
import type { Debt, DebtDirection } from '../../db/types';
import { AttachmentList } from '../../components/AttachmentList';

export default function DebtsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const debts = useDebts();
  const accounts = useAccounts();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const today = todayISO();

  const [showForm, setShowForm] = useState(false);
  const [person, setPerson] = useState('');
  const [direction, setDirection] = useState<DebtDirection>('owed_to_me');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('YER');
  const [dueDate, setDueDate] = useState('');
  const [moveMoney, setMoveMoney] = useState(false);
  const [moveAccountId, setMoveAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const [repaying, setRepaying] = useState<Debt | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayAccountId, setRepayAccountId] = useState('');
  const repayments = useDebtRepayments(repaying?.id ?? null);
  const [toDelete, setToDelete] = useState<Debt | null>(null);

  const totals = useMemo(() => {
    const sums = { owed_to_me: new Map<string, number>(), i_owe: new Map<string, number>() };
    for (const d of debts) {
      if (d.status !== 'open') continue;
      const m = sums[d.direction];
      m.set(d.currency, (m.get(d.currency) ?? 0) + d.remainingMinor);
    }
    return sums;
  }, [debts]);

  function friendlyError(msg: string): string {
    if (msg.includes('REPAYMENT_EXCEEDS_REMAINING')) return t('debts.exceedsRemaining');
    if (msg.includes('CURRENCY_MISMATCH')) return t('debts.currencyMismatch');
    return msg;
  }

  async function save() {
    if (!profileId) return;
    setError('');
    try {
      await createDebt({
        profileId, person, direction,
        principalMinor: toMinor(amount, currency),
        currency, startDate: today,
        dueDate: dueDate || null,
        notes,
        moveAccountId: moveMoney ? moveAccountId || null : null,
      });
      setShowForm(false);
      void runChecks(profileId);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  }

  async function saveRepayment() {
    if (!repaying) return;
    setError('');
    try {
      await repayDebt({
        debtId: repaying.id,
        amountMinor: toMinor(repayAmount, repaying.currency),
        date: today,
        accountId: repayAccountId || null,
      });
      setRepaying(null);
      setRepayAmount('');
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('debts.title')}</h1>
        <Button variant="soft" onClick={() => { setPerson(''); setAmount(''); setDueDate(''); setMoveMoney(false); setMoveAccountId(''); setNotes(''); setError(''); setShowForm(true); }}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Card className="p-3">
          <p className="text-xs text-ink-dim">{t('debts.totalOwedToMe')}</p>
          {totals.owed_to_me.size === 0 ? (
            <p className="text-sm font-semibold">—</p>
          ) : (
            [...totals.owed_to_me.entries()].map(([cur, v]) => (
              <p key={cur}><MoneyText minor={v} currency={cur as CurrencyCode} kind="income" className="text-sm" /></p>
            ))
          )}
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-dim">{t('debts.totalIOwe')}</p>
          {totals.i_owe.size === 0 ? (
            <p className="text-sm font-semibold">—</p>
          ) : (
            [...totals.i_owe.entries()].map(([cur, v]) => (
              <p key={cur}><MoneyText minor={v} currency={cur as CurrencyCode} kind="liability" className="text-sm" /></p>
            ))
          )}
        </Card>
      </div>

      {debts.length === 0 ? (
        <EmptyState icon={<HandCoins size={40} />} text={t('debts.empty')} />
      ) : (
        <div className="space-y-3">
          {debts.map((d) => {
            const overdue = d.status === 'open' && d.dueDate !== null && d.dueDate < today;
            const pct = d.principalMinor > 0 ? Math.round(((d.principalMinor - d.remainingMinor) / d.principalMinor) * 100) : 0;
            return (
              <Card key={d.id} className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{d.person}</span>
                    <span className="block text-xs text-ink-dim">
                      {t(d.direction === 'owed_to_me' ? 'debts.owedToMe' : 'debts.iOwe')}
                      {d.dueDate && ` · ${formatDate(d.dueDate, i18n.language, calendar)}`}
                    </span>
                  </span>
                  {overdue && <span className="rounded-full bg-expense-soft px-2 py-0.5 text-[11px] font-semibold text-expense">{t('debts.overdue')}</span>}
                  {d.status === 'settled' && <span className="rounded-full bg-income-soft px-2 py-0.5 text-[11px] font-semibold text-income">{t('debts.settled')}</span>}
                  <button onClick={() => setToDelete(d)} className="p-2 text-ink-dim" aria-label={t('common.delete')}><Trash2 size={15} /></button>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" dir="ltr">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-baseline justify-between text-xs">
                  <span>
                    {t('debts.remaining')}:{' '}
                    <MoneyText minor={d.remainingMinor} currency={d.currency} kind={d.direction === 'owed_to_me' ? 'income' : 'liability'} />
                    <span className="text-ink-dim"> / <MoneyText minor={d.principalMinor} currency={d.currency} respectHide={false} /></span>
                  </span>
                  {d.status === 'open' && (
                    <Button variant="soft" onClick={() => { setRepaying(d); setRepayAmount(''); setRepayAccountId(''); setError(''); }}>
                      {t('debts.repay')}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* new debt */}
      <Sheet open={showForm} onClose={() => setShowForm(false)} title={t('debts.addTitle')}>
        <div className="space-y-4">
          <Segmented
            options={[
              { value: 'owed_to_me' as const, label: t('debts.owedToMe') },
              { value: 'i_owe' as const, label: t('debts.iOwe') },
            ]}
            value={direction}
            onChange={setDirection}
          />
          <Field label={t('debts.person')}>
            <TextInput value={person} onChange={(e) => setPerson(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('debts.principal')}>
              <TextInput inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t('common.currency')}>
              <Select value={currency} onChange={(e) => { setCurrency(e.target.value as CurrencyCode); setMoveAccountId(''); }}>
                {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('debts.dueDate')}>
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={moveMoney} onChange={(e) => setMoveMoney(e.target.checked)} /> {t('debts.moveMoney')}
          </label>
          {moveMoney && (
            <Field label={t('common.account')} hint={t('debts.moveMoneyHint')}>
              <Select value={moveAccountId} onChange={(e) => setMoveAccountId(e.target.value)}>
                <option value="">—</option>
                {accounts.filter((a) => a.currency === currency).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('common.notes')}>
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void save()} disabled={!person.trim() || !amount || (moveMoney && !moveAccountId)}>
            {t('common.save')}
          </Button>
        </div>
      </Sheet>

      {/* repayment */}
      <Sheet open={repaying !== null} onClose={() => setRepaying(null)} title={t('debts.repay')}>
        {repaying && (
          <div className="space-y-4">
            <p className="text-sm text-ink-dim">
              {repaying.person} — {t('debts.remaining')}: <MoneyText minor={repaying.remainingMinor} currency={repaying.currency} respectHide={false} />
            </p>
            <Field label={t('common.amount')}>
              <TextInput inputMode="decimal" dir="ltr" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t('debts.repayAccount')} hint={t('debts.repayNoAccount')}>
              <Select value={repayAccountId} onChange={(e) => setRepayAccountId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {accounts.filter((a) => a.currency === repaying.currency).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-dim">{t('attachments.title')}</p>
              <AttachmentList ownerType="debt" ownerId={repaying.id} />
            </div>
            {repayments.filter((r) => r.type === 'debt_repayment').length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-dim">{t('debts.repaymentHistory')}</p>
                <Card className="max-h-40 overflow-y-auto px-3">
                  {repayments.filter((r) => r.type === 'debt_repayment').map((r) => (
                    <div key={r.id} className="flex justify-between py-1.5 text-xs">
                      <span className="text-ink-dim">{formatDate(r.date, i18n.language, calendar)}</span>
                      <MoneyText minor={r.amountMinor} currency={repaying.currency} respectHide={false} />
                    </div>
                  ))}
                </Card>
              </div>
            )}
            {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
            <Button className="w-full" onClick={() => void saveRepayment()} disabled={!repayAmount}>
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
          if (toDelete) void deleteDebt(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
