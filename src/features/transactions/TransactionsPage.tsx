import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, SlidersHorizontal, ReceiptText } from 'lucide-react';
import { useTransactions, useCategoryMap, useAccounts, type TxnFilter } from '../../hooks/data';
import { TxnListItem } from './TxnListItem';
import { useTxnSheet } from '../../store/txnSheet';
import { Button, Card, Select, TextInput, EmptyState, ConfirmDialog } from '../../components/ui';
import { deleteTransaction } from '../../db/transactions';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import { categoryName } from '../../components/CategoryBadge';
import type { Transaction, TxnType } from '../../db/types';
import { useTags } from '../more/TagsPage';

export default function TransactionsPage() {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const { openNew, openEdit } = useTxnSheet();
  const accounts = useAccounts(true);
  const catMap = useCategoryMap();

  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [fType, setFType] = useState<TxnType | ''>('');
  const [fAccount, setFAccount] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fTag, setFTag] = useState('');
  const [toDelete, setToDelete] = useState<Transaction | null>(null);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const tags = useTags();

  const filter = useMemo<TxnFilter>(
    () => ({
      search: search || undefined,
      type: (fType || undefined) as TxnType | undefined,
      accountId: fAccount || undefined,
      categoryId: fCategory || undefined,
      from: fFrom || undefined,
      to: fTo || undefined,
      tagId: fTag || undefined,
    }),
    [search, fType, fAccount, fCategory, fFrom, fTo, fTag],
  );
  const txns = useTransactions(filter);

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of txns) {
      const g = m.get(t.date) ?? [];
      g.push(t);
      m.set(t.date, g);
    }
    return [...m.entries()];
  }, [txns]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('nav.transactions')}</h1>
        <Button variant="soft" onClick={() => openNew()}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      <div className="mb-3 flex gap-2">
        <TextInput placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`shrink-0 rounded-2xl border border-line px-3 ${showFilters ? 'bg-primary-soft text-primary' : 'text-ink-dim'}`}
          aria-label={t('txn.filters')}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {showFilters && (
        <Card className="mb-3 space-y-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={fType} onChange={(e) => setFType(e.target.value as TxnType | '')}>
              <option value="">{t('txn.filterType')}: {t('common.all')}</option>
              {(['expense', 'income', 'transfer', 'withdrawal', 'deposit', 'cc_purchase', 'cc_payment', 'refund', 'lend', 'borrow', 'debt_repayment'] as const).map((ty) => (
                <option key={ty} value={ty}>{t(`txn.types.${ty}`)}</option>
              ))}
            </Select>
            <Select value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
              <option value="">{t('txn.filterAccount')}: {t('common.all')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <Select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
              <option value="">{t('txn.filterCategory')}: {t('common.all')}</option>
              {[...catMap.values()].filter((c) => !c.parentId).map((c) => (
                <option key={c.id} value={c.id}>{categoryName(c, i18n.language)}</option>
              ))}
            </Select>
            <Select value={fTag} onChange={(e) => setFTag(e.target.value)}>
              <option value="">{t('tags.filter')}: {t('common.all')}</option>
              {tags.map((tg) => <option key={tg.id} value={tg.id}>#{tg.name}</option>)}
            </Select>
            <TextInput type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} aria-label={t('txn.from')} />
            <TextInput type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} aria-label={t('txn.to')} />
          </div>
        </Card>
      )}

      {groups.length === 0 ? (
        <EmptyState icon={<ReceiptText size={40} />} text={t('txn.emptyList')} />
      ) : (
        groups.map(([date, list]) => (
          <div key={date} className="mb-2">
            <p className="px-1 py-1 text-xs font-semibold text-ink-dim">{formatDate(date, i18n.language, calendar)}</p>
            <Card className="px-2">
              {list.map((txn) => (
                <TxnListItem key={txn.id} txn={txn} categories={catMap} accounts={accounts} onClick={() => setDetail(txn)} />
              ))}
            </Card>
          </div>
        ))
      )}

      {/* lightweight detail/actions sheet */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <Card className="relative z-10 w-full max-w-lg rounded-t-3xl p-4 pb-8" onClick={() => {}}>
            <TxnListItem txn={detail} categories={catMap} accounts={accounts} />
            {detail.notes && <p className="mb-2 px-1 text-sm text-ink-dim">{detail.notes}</p>}
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => { openEdit(detail); setDetail(null); }}>
                {t('common.edit')}
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => { setToDelete(detail); setDetail(null); }}>
                {t('common.delete')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={t('common.confirmDeleteBody')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void deleteTransaction(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
