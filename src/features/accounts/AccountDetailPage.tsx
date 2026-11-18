import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Pencil, Scale, Archive, Trash2, Plus, Share2 } from 'lucide-react';
import { useAccount, useTransactions, useCategoryMap, useAccounts, useProfiles, useActiveProfileId } from '../../hooks/data';
import { Card, Button, Sheet, Field, TextInput, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { TxnListItem, txnKind } from '../transactions/TxnListItem';
import { updateAccount, reconcileAccount, deleteAccount } from '../../db/accounts';
import { toMinor, minorToDecimalString } from '../../engine/money';
import { useTxnSheet } from '../../store/txnSheet';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import { AttachmentList } from '../../components/AttachmentList';

export default function AccountDetailPage() {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const account = useAccount(id ?? null);
  const accounts = useAccounts(true);
  const catMap = useCategoryMap();
  const txns = useTransactions({ accountId: id });
  const { openNew, openEdit } = useTxnSheet();

  const [showEdit, setShowEdit] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [actual, setActual] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const stats = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const tx of txns) {
      const k = txnKind(tx);
      if (tx.accountId === id) {
        if (k === 'income') inflow += tx.amountMinor;
        else if (k === 'expense') outflow += tx.amountMinor;
      }
    }
    return { inflow, outflow };
  }, [txns, id]);

  if (!account) return null;
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 truncate text-xl font-bold">{account.name}</h1>
        <button
          onClick={() => {
            setEditName(account.name);
            setEditNotes(account.notes);
            setShowEdit(true);
          }}
          className="rounded-full p-2 text-ink-dim active:bg-surface-2"
          aria-label={t('common.edit')}
        >
          <Pencil size={18} />
        </button>
      </div>

      <Card className="mb-4 p-4">
        <p className="text-xs text-ink-dim">
          {t(`accounts.types.${account.type}`)} · {account.currency} · {t('accounts.openedAt')}{' '}
          {formatDate(account.openedAt.slice(0, 10), i18n.language, calendar)}
        </p>
        <p className="mt-2 text-3xl font-bold">
          <MoneyText
            minor={account.currentBalanceMinor}
            currency={account.currency}
            kind={account.type === 'credit_card' && account.currentBalanceMinor < 0 ? 'liability' : 'neutral'}
          />
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-income-soft p-2">
            <p className="text-xs text-income">{t('dashboard.income')}</p>
            <MoneyText minor={stats.inflow} currency={account.currency} kind="income" />
          </div>
          <div className="rounded-2xl bg-expense-soft p-2">
            <p className="text-xs text-expense">{t('dashboard.expenses')}</p>
            <MoneyText minor={stats.outflow} currency={account.currency} kind="expense" />
          </div>
        </div>
        {account.notes && <p className="mt-2 text-sm text-ink-dim">{account.notes}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => openNew(account.id)}>
            <span className="inline-flex items-center gap-1"><Plus size={14} /> {t('txn.addTitle')}</span>
          </Button>
          <Button variant="ghost" onClick={() => { setActual(minorToDecimalString(account.currentBalanceMinor, account.currency)); setShowReconcile(true); }}>
            <span className="inline-flex items-center gap-1"><Scale size={14} /> {t('accounts.reconcile')}</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => void updateAccount(account.id, { status: account.status === 'active' ? 'closed' : 'active' })}
          >
            <span className="inline-flex items-center gap-1">
              <Archive size={14} /> {account.status === 'active' ? t('accounts.closeAccount') : t('accounts.reopenAccount')}
            </span>
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <span className="inline-flex items-center gap-1"><Trash2 size={14} /> {t('common.delete')}</span>
          </Button>
        </div>
        {error && <p className="mt-2 rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('attachments.title')}</h2>
        <AttachmentList ownerType="account" ownerId={account.id} />
      </Card>

      <SharingCard accountId={account.id} ownerId={account.profileId} shared={account.sharedWithProfileIds} />

      <h2 className="mb-2 px-1 text-sm font-semibold text-ink-dim">{t('accounts.transactionsTab')}</h2>
      {txns.length === 0 ? (
        <EmptyState text={t('txn.emptyList')} />
      ) : (
        <Card className="px-2">
          {txns.map((txn) => (
            <TxnListItem key={txn.id} txn={txn} categories={catMap} accounts={accounts} onClick={() => openEdit(txn)} />
          ))}
        </Card>
      )}

      <Sheet open={showEdit} onClose={() => setShowEdit(false)} title={t('accounts.editTitle')}>
        <div className="space-y-4">
          <Field label={t('common.name')}>
            <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Field>
          <Field label={t('common.notes')}>
            <TextInput value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </Field>
          <Button
            className="w-full"
            onClick={() => {
              void updateAccount(account.id, { name: editName, notes: editNotes });
              setShowEdit(false);
            }}
            disabled={!editName.trim()}
          >
            {t('common.save')}
          </Button>
        </div>
      </Sheet>

      <Sheet open={showReconcile} onClose={() => setShowReconcile(false)} title={t('accounts.reconcile')}>
        <div className="space-y-4">
          <p className="text-sm text-ink-dim">{t('accounts.reconcileHint')}</p>
          <Field label={t('accounts.actualBalance')}>
            <TextInput inputMode="decimal" dir="ltr" value={actual} onChange={(e) => setActual(e.target.value)} />
          </Field>
          <Button
            className="w-full"
            onClick={() => {
              try {
                void reconcileAccount(account.id, toMinor(actual, account.currency));
                setShowReconcile(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title={t('common.confirmDeleteTitle')}
        body={t('common.confirmDeleteBody')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteAccount(account.id)
            .then(() => navigate('/accounts'))
            .catch((e: unknown) => {
              setError(e instanceof Error && e.message === 'ACCOUNT_HAS_TRANSACTIONS' ? t('accounts.cannotDelete') : String(e));
            });
        }}
      />
    </div>
  );
}

/**
 * Explicit sharing with other profiles (PRD §25 — never automatic). Only the
 * owning profile can change it; other profiles see who shares it.
 */
function SharingCard({ accountId, ownerId, shared }: { accountId: string; ownerId: string; shared: string[] }) {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const activeId = useActiveProfileId();
  const owner = profiles.find((p) => p.id === ownerId);
  if (activeId !== ownerId) {
    return (
      <Card className="mb-4 flex items-center gap-2 p-4 text-sm text-ink-dim">
        <Share2 size={16} /> {t('sharing.sharedBadge', { name: owner?.name ?? '' })}
      </Card>
    );
  }
  const others = profiles.filter((p) => p.id !== ownerId);
  const toggle = (pid: string, on: boolean) =>
    void updateAccount(accountId, { sharedWithProfileIds: on ? [...new Set([...shared, pid])] : shared.filter((x) => x !== pid) });
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Share2 size={16} /> {t('sharing.title')}</h2>
      <p className="mb-2 text-xs text-ink-dim">{t('sharing.hint')}</p>
      {others.length === 0 ? (
        <p className="text-xs text-ink-dim">{t('sharing.none')}</p>
      ) : (
        others.map((p) => (
          <label key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--c-primary)]" checked={shared.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
            <span>{p.icon} {p.name}</span>
          </label>
        ))
      )}
    </Card>
  );
}
