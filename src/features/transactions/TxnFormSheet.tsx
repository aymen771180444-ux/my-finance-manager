import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Lock } from 'lucide-react';
import { Sheet, Field, TextInput, Select, Button } from '../../components/ui';
import { db } from '../../db/schema';
import { createTag, tagIdsForTxn } from '../../db/tags';
import { useTags } from '../more/TagsPage';
import { useLiveQuery } from 'dexie-react-hooks';
import { AttachmentList, FilePickers, prepareFiles } from '../../components/AttachmentList';
import { addAttachment } from '../../db/attachments';
import { useTxnSheet } from '../../store/txnSheet';
import { useAccounts, useCategories, useActiveProfileId } from '../../hooks/data';
import { createTransaction, updateTransaction, type TxnInput } from '../../db/transactions';
import { getRateForDate } from '../../db/rates';
import { toMinor, minorToDecimalString, CURRENCIES } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { categoryName } from '../../components/CategoryBadge';
import { runChecks } from '../../services/scheduler';
import type { TxnType, PaymentMethod } from '../../db/types';

/** Types available in the Stage-1 form (debt & investment types arrive with their modules). */
const FORM_TYPES: TxnType[] = [
  'expense',
  'income',
  'transfer',
  'withdrawal',
  'deposit',
  'cc_purchase',
  'cc_payment',
  'refund',
];

const TWO_ACCOUNT: TxnType[] = ['transfer', 'withdrawal', 'deposit', 'cc_payment'];

interface SplitLine {
  categoryId: string;
  amount: string;
}

export default function TxnFormSheet() {
  const { t, i18n } = useTranslation();
  const { open, editing, presetAccountId, close } = useTxnSheet();
  const profileId = useActiveProfileId();
  const accounts = useAccounts();
  const expenseCats = useCategories('expense');
  const incomeCats = useCategories('income');

  const [type, setType] = useState<TxnType>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [person, setPerson] = useState('');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [useSplits, setUseSplits] = useState(false);
  const [splits, setSplits] = useState<SplitLine[]>([]);
  const [rateInfo, setRateInfo] = useState<number | null | 'base'>('base');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [linkedTxnId, setLinkedTxnId] = useState('');
  /** Files picked for a NEW transaction; stored once it is saved and has an id. */
  const [pendingFiles, setPendingFiles] = useState<{ name: string; blob: Blob }[]>([]);
  const allTags = useTags();
  /** Recent expenses a refund can be linked to (PRD §8 rule 6). */
  const refundCandidates =
    useLiveQuery(async () => {
      if (!profileId || type !== 'refund') return [];
      const rows = await db.transactions.where('profileId').equals(profileId).toArray();
      return rows
        .filter((x) => x.type === 'expense' || x.type === 'cc_purchase')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 60);
    }, [profileId, type]) ?? [];

  /** Debt/goal transactions are managed from their own screens to keep those records consistent. */
  const locked = Boolean(editing && (editing.debtId || editing.goalId || !FORM_TYPES.includes(editing.type)));

  // reset when the sheet opens
  useEffect(() => {
    if (!open) return;
    setError('');
    setBusy(false);
    setNewTag('');
    setTagIds([]);
    setPendingFiles([]);
    setLinkedTxnId(editing?.linkedTxnId ?? '');
    if (editing) {
      void tagIdsForTxn(editing.id).then(setTagIds);
      if (editing.hasSplits) {
        void db.splits.where('transactionId').equals(editing.id).toArray().then((rows) => {
          setUseSplits(true);
          setSplits(rows.map((r) => ({ categoryId: r.categoryId, amount: minorToDecimalString(r.amountMinor, editing.currency) })));
        });
      }
      setType(editing.type);
      setAmount(minorToDecimalString(editing.amountMinor, editing.currency));
      setAccountId(editing.accountId);
      setToAccountId(editing.toAccountId ?? '');
      setCategoryId(editing.categoryId ?? '');
      setSubcategoryId(editing.subcategoryId ?? '');
      setDate(editing.date);
      setPaymentMethod(editing.paymentMethod ?? '');
      setPerson(editing.person);
      setNotes(editing.notes);
      setLocation(editing.location);
      if (!editing.hasSplits) {
        setUseSplits(false);
        setSplits([]);
      }
      setShowAdvanced(true);
    } else {
      setType('expense');
      setAmount('');
      setAccountId(presetAccountId ?? '');
      setToAccountId('');
      setCategoryId('');
      setSubcategoryId('');
      setDate(todayISO());
      setPaymentMethod('');
      setPerson('');
      setNotes('');
      setLocation('');
      setUseSplits(false);
      setSplits([]);
      setShowAdvanced(false);
    }
  }, [open, editing, presetAccountId]);

  const account = accounts.find((a) => a.id === accountId);
  const isTwoAccount = TWO_ACCOUNT.includes(type);
  const isExpenseKind = type === 'expense' || type === 'cc_purchase';
  // refunds carry the original expense category so they net against it
  const cats = isExpenseKind || type === 'refund' ? expenseCats : type === 'income' ? incomeCats : [];
  const topCats = cats.filter((c) => c.parentId === null);
  const subCats = cats.filter((c) => c.parentId === categoryId);

  // account pickers filtered per type
  const fromChoices = useMemo(() => {
    if (type === 'cc_purchase') return accounts.filter((a) => a.type === 'credit_card');
    if (type === 'withdrawal') return accounts.filter((a) => a.type === 'bank' || a.type === 'ewallet' || a.type === 'savings');
    if (type === 'deposit') return accounts.filter((a) => a.type === 'cash');
    if (type === 'cc_payment') return accounts.filter((a) => a.type !== 'credit_card');
    return accounts;
  }, [accounts, type]);

  const toChoices = useMemo(() => {
    if (!isTwoAccount) return [];
    let list = accounts.filter((a) => a.id !== accountId);
    if (account) list = list.filter((a) => a.currency === account.currency);
    if (type === 'cc_payment') list = list.filter((a) => a.type === 'credit_card');
    if (type === 'withdrawal') list = list.filter((a) => a.type === 'cash');
    if (type === 'deposit') list = list.filter((a) => a.type === 'bank' || a.type === 'ewallet' || a.type === 'savings');
    return list;
  }, [accounts, accountId, account, type, isTwoAccount]);

  // live exchange-rate lookup for non-base accounts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account || account.currency === 'YER') {
        setRateInfo('base');
        return;
      }
      const r = await getRateForDate(account.currency, date);
      if (!cancelled) setRateInfo(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [account, date]);

  const splitSumOk = useMemo(() => {
    if (!useSplits || !account) return true;
    try {
      const total = toMinor(amount || '0', account.currency);
      const sum = splits.reduce((s, l) => s + toMinor(l.amount || '0', account.currency), 0);
      return total === sum && splits.every((l) => l.categoryId);
    } catch {
      return false;
    }
  }, [useSplits, splits, amount, account]);

  async function save() {
    if (!profileId || !account || busy || locked) return;
    setError('');
    setBusy(true);
    try {
      const amountMinor = toMinor(amount, account.currency);
      const input: TxnInput = {
        profileId,
        type,
        amountMinor,
        accountId,
        toAccountId: isTwoAccount ? toAccountId : null,
        categoryId: useSplits ? null : categoryId || null,
        subcategoryId: useSplits ? null : subcategoryId || null,
        date,
        paymentMethod: paymentMethod || null,
        person,
        notes,
        location,
        linkedTxnId: type === 'refund' ? linkedTxnId || null : null,
        tagIds,
        splits: useSplits
          ? splits.map((l) => ({
              categoryId: l.categoryId,
              subcategoryId: null,
              amountMinor: toMinor(l.amount, account.currency),
              notes: '',
            }))
          : [],
      };
      if (editing) await updateTransaction(editing.id, input);
      else {
        const created = await createTransaction(input);
        for (const f of pendingFiles) {
          await addAttachment({ profileId, ownerType: 'transaction', ownerId: created.id, name: f.name, blob: f.blob });
        }
      }
      close();
      void runChecks(profileId); // budget alerts react to the new spending
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    !locked &&
    Boolean(accountId) &&
    Boolean(amount) &&
    (!isTwoAccount || Boolean(toAccountId)) &&
    (!useSplits || splitSumOk);

  async function addTag() {
    if (!profileId || !newTag.trim()) return;
    const tag = await createTag(profileId, newTag);
    setTagIds((ids) => (ids.includes(tag.id) ? ids : [...ids, tag.id]));
    setNewTag('');
  }

  if (locked && editing) {
    return (
      <Sheet open={open} onClose={close} title={t('txn.editTitle')}>
        <div className="space-y-3">
          <p className="flex gap-2 rounded-2xl bg-surface-2 px-3 py-3 text-sm text-ink-dim">
            <Lock size={16} className="mt-0.5 shrink-0" />
            {t(editing.goalId ? 'txn.lockedGoal' : 'txn.lockedDebt')}
          </p>
          <p className="text-sm">
            {t(`txn.types.${editing.type}`)} · {minorToDecimalString(editing.amountMinor, editing.currency)} {editing.currency} · {editing.date}
          </p>
          {editing.person && <p className="text-sm text-ink-dim">{editing.person}</p>}
          <Field label={t('attachments.title')}>
            <AttachmentList ownerType="transaction" ownerId={editing.id} />
          </Field>
          <Button variant="ghost" className="w-full" onClick={close}>{t('common.close')}</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close} title={editing ? t('txn.editTitle') : t('txn.addTitle')}>
      <div className="space-y-4">
        <Field label={t('txn.type')}>
          <Select value={type} onChange={(e) => { setType(e.target.value as TxnType); setCategoryId(''); setSubcategoryId(''); setToAccountId(''); setLinkedTxnId(''); setAccountId(presetAccountId ?? ''); }}>
            {FORM_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`txn.types.${ty}`)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.amount')}>
            <TextInput
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label={t('common.date')}>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <Field label={isTwoAccount ? t('txn.fromAccount') : t('common.account')}>
          <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setToAccountId(''); }}>
            <option value="">—</option>
            {fromChoices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({CURRENCIES[a.currency].code})
              </option>
            ))}
          </Select>
        </Field>

        {isTwoAccount && (
          <Field label={t('txn.toAccount')} hint={t('txn.sameCurrencyRule')}>
            <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">—</option>
              {toChoices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({CURRENCIES[a.currency].code})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {cats.length > 0 && !useSplits && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.category')}>
              <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}>
                <option value="">—</option>
                {topCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryName(c, i18n.language)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.subcategory')}>
              <Select value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={subCats.length === 0}>
                <option value="">—</option>
                {subCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryName(c, i18n.language)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {account && account.currency !== 'YER' && (
          <p className={`rounded-2xl px-3 py-2 text-xs ${rateInfo === null ? 'bg-liability-soft text-liability' : 'bg-surface-2 text-ink-dim'}`}>
            {rateInfo === null
              ? t('txn.noRateWarning', { currency: account.currency })
              : rateInfo !== 'base' && t('txn.rateUsed', { currency: account.currency, rate: rateInfo })}
          </p>
        )}

        {type === 'refund' && (
          <Field label={t('txn.linkedExpense')}>
            <Select
              value={linkedTxnId}
              onChange={(e) => {
                setLinkedTxnId(e.target.value);
                const orig = refundCandidates.find((x) => x.id === e.target.value);
                if (orig) {
                  setCategoryId(orig.categoryId ?? '');
                  setSubcategoryId(orig.subcategoryId ?? '');
                  if (!accountId) setAccountId(orig.accountId);
                }
              }}
            >
              <option value="">—</option>
              {refundCandidates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.date} · {minorToDecimalString(x.amountMinor, x.currency)} {x.currency}
                  {x.categoryId ? ` · ${categoryName(expenseCats.find((c) => c.id === x.categoryId), i18n.language)}` : ''}
                  {x.notes ? ` · ${x.notes}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {isExpenseKind && (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={useSplits} onChange={(e) => { setUseSplits(e.target.checked); if (e.target.checked && splits.length === 0) setSplits([{ categoryId: '', amount: '' }]); }} />
              {t('txn.split')}
            </label>
            {useSplits && (
              <div className="mt-2 space-y-2">
                {splits.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select className="flex-1" value={line.categoryId} onChange={(e) => setSplits(splits.map((l, j) => (j === i ? { ...l, categoryId: e.target.value } : l)))}>
                      <option value="">—</option>
                      {topCats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryName(c, i18n.language)}
                        </option>
                      ))}
                    </Select>
                    <TextInput className="w-28" inputMode="decimal" dir="ltr" value={line.amount} placeholder="0" onChange={(e) => setSplits(splits.map((l, j) => (j === i ? { ...l, amount: e.target.value } : l)))} />
                    <button type="button" className="p-2 text-ink-dim" onClick={() => setSplits(splits.filter((_, j) => j !== i))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" onClick={() => setSplits([...splits, { categoryId: '', amount: '' }])}>
                  <span className="inline-flex items-center gap-1"><Plus size={14} /> {t('txn.addSplit')}</span>
                </Button>
                {!splitSumOk && <p className="text-xs text-expense">{t('txn.splitMismatch')}</p>}
              </div>
            )}
          </div>
        )}

        <button type="button" className="text-sm font-medium text-primary" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? t('common.showLess') : t('txn.advanced')}
        </button>

        {showAdvanced && (
          <div className="space-y-3">
            <Field label={t('txn.paymentMethod')}>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                <option value="">—</option>
                {(['cash', 'bank_card', 'bank_transfer', 'ewallet', 'online'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`txn.methods.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('txn.person')}>
              <TextInput value={person} onChange={(e) => setPerson(e.target.value)} />
            </Field>
            <Field label={t('common.notes')}>
              <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field label={t('txn.location')}>
              <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label={t('attachments.title')}>
              {editing ? (
                <AttachmentList ownerType="transaction" ownerId={editing.id} />
              ) : (
                <div className="space-y-2">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm">
                      <span className="flex-1 truncate">{f.name}</span>
                      <button type="button" className="p-1 text-ink-dim" aria-label={t('common.delete')} onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== i))}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <FilePickers
                    onFiles={(files) => {
                      void prepareFiles(files)
                        .then((prepared) => setPendingFiles((p) => [...p, ...prepared]))
                        .catch(() => setError(t('attachments.tooLarge')));
                    }}
                  />
                </div>
              )}
            </Field>
            <Field label={t('txn.tags')}>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tg) => {
                  const on = tagIds.includes(tg.id);
                  return (
                    <button
                      key={tg.id}
                      type="button"
                      onClick={() => setTagIds(on ? tagIds.filter((x) => x !== tg.id) : [...tagIds, tg.id])}
                      className="rounded-full border px-2.5 py-1 text-xs font-medium"
                      style={on ? { backgroundColor: tg.color, borderColor: tg.color, color: '#fff' } : { borderColor: `${tg.color}66`, color: tg.color }}
                    >
                      #{tg.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <TextInput
                  value={newTag}
                  placeholder={t('tags.placeholder')}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addTag();
                    }
                  }}
                />
                <Button variant="ghost" onClick={() => void addTag()} disabled={!newTag.trim()}>
                  <Plus size={16} />
                </Button>
              </div>
            </Field>
          </div>
        )}

        {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}

        <Button className="w-full" onClick={() => void save()} disabled={!canSave || busy}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}
