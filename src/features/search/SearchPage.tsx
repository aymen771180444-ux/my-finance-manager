import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, SlidersHorizontal, Search as SearchIcon, User, Wallet, Tags, HandCoins, Target, Hash, Paperclip } from 'lucide-react';
import { Card, TextInput, Select, EmptyState } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { db } from '../../db/schema';
import { useActiveProfileId, useAccounts, useCategoryMap } from '../../hooks/data';
import { TxnListItem } from '../transactions/TxnListItem';
import { useTxnSheet } from '../../store/txnSheet';
import { categoryName } from '../../components/CategoryBadge';
import { minorToDecimalString, toMinor } from '../../engine/money';
import { profileAccounts } from '../../db/reportData';

function norm(s: string): string {
  // case-insensitive, ignores Arabic diacritics and alef/ya/ta-marbuta variants
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export default function SearchPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const accountsList = useAccounts(true);
  const catMap = useCategoryMap();
  const { openEdit } = useTxnSheet();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [person, setPerson] = useState('');

  const data = useLiveQuery(async () => {
    if (!profileId) return null;
    const [txns, debts, goals, tags, links, accounts, files] = await Promise.all([
      db.transactions.where('profileId').equals(profileId).toArray(),
      db.debts.where('profileId').equals(profileId).toArray(),
      db.savingsGoals.where('profileId').equals(profileId).toArray(),
      db.tags.where('profileId').equals(profileId).toArray(),
      db.transactionTags.where('profileId').equals(profileId).toArray(),
      profileAccounts(profileId),
      db.attachments.where('profileId').equals(profileId).filter((a) => !a.deletedAt).toArray(),
    ]);
    const tagsByTxn = new Map<string, string[]>();
    const tagName = new Map(tags.map((tg) => [tg.id, tg.name]));
    for (const l of links) {
      const arr = tagsByTxn.get(l.transactionId) ?? [];
      arr.push(tagName.get(l.tagId) ?? '');
      tagsByTxn.set(l.transactionId, arr);
    }
    return { txns, debts, goals, tags, tagsByTxn, accounts, files };
  }, [profileId]);

  const filtersActive = Boolean(minAmt || maxAmt || from || to || categoryId || accountId || person);
  const query = norm(q.trim());
  const active = query.length >= 2 || filtersActive;

  const results = useMemo(() => {
    if (!data || !active) return null;
    const accName = new Map(data.accounts.map((a) => [a.id, a.name]));
    const hit = (...fields: (string | undefined | null)[]) => !query || fields.some((f) => f && norm(f).includes(query));
    const catText = (id: string | null) => {
      if (!id) return '';
      const c = catMap.get(id);
      return c ? `${c.nameAr} ${c.nameEn}` : '';
    };
    const amountOk = (minor: number, cur: Parameters<typeof toMinor>[1]) => {
      try {
        if (minAmt && minor < toMinor(minAmt, cur)) return false;
        if (maxAmt && minor > toMinor(maxAmt, cur)) return false;
      } catch {
        return false;
      }
      return true;
    };
    const txns = data.txns
      .filter((tx) => {
        if (from && tx.date < from) return false;
        if (to && tx.date > to) return false;
        if (accountId && tx.accountId !== accountId && tx.toAccountId !== accountId) return false;
        if (categoryId && tx.categoryId !== categoryId && catMap.get(tx.categoryId ?? '')?.parentId !== categoryId) return false;
        if (person && norm(tx.person) !== norm(person)) return false;
        if (!amountOk(tx.amountMinor, tx.currency)) return false;
        return hit(
          tx.notes, tx.person, tx.location,
          catText(tx.categoryId), catText(tx.subcategoryId),
          accName.get(tx.accountId), tx.toAccountId ? accName.get(tx.toAccountId) : '',
          minorToDecimalString(tx.amountMinor, tx.currency),
          (data.tagsByTxn.get(tx.id) ?? []).join(' '),
          t(`txn.types.${tx.type}`),
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 100);
    if (filtersActive && !query) return { txns, accounts: [], categories: [], people: [], debts: [], goals: [], tags: [], files: [] };
    const people = new Map<string, number>();
    for (const tx of data.txns) if (tx.person) people.set(tx.person, (people.get(tx.person) ?? 0) + 1);
    for (const d of data.debts) people.set(d.person, (people.get(d.person) ?? 0) + 1);
    return {
      txns,
      accounts: data.accounts.filter((a) => hit(a.name, a.notes, t(`accounts.types.${a.type}`))),
      categories: [...catMap.values()].filter((c) => hit(c.nameAr, c.nameEn)),
      people: [...people.entries()].filter(([p]) => hit(p)).slice(0, 20),
      debts: data.debts.filter((d) => hit(d.person, d.notes)),
      goals: data.goals.filter((g) => hit(g.name, g.notes)),
      tags: data.tags.filter((tg) => hit(tg.name)),
      files: data.files.filter((a) => hit(a.name)),
    };
  }, [data, active, query, minAmt, maxAmt, from, to, categoryId, accountId, person, catMap, filtersActive, t]);

  const total = results ? Object.values(results).reduce((s, arr) => s + arr.length, 0) : 0;
  const Section = ({ title, children, count }: { title: string; children: React.ReactNode; count: number }) =>
    count === 0 ? null : (
      <div className="mb-3">
        <p className="mb-1 px-1 text-xs font-semibold text-ink-dim">{title} ({count})</p>
        <Card className="px-2">{children}</Card>
      </div>
    );
  const Row = ({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) => (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-1 py-2.5 text-start active:bg-surface-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{label}</span>{sub && <span className="block truncate text-xs text-ink-dim">{sub}</span>}</span>
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <TextInput autoFocus placeholder={t('search.placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`shrink-0 rounded-2xl border border-line px-3 ${showFilters || filtersActive ? 'bg-primary-soft text-primary' : 'text-ink-dim'}`}
          aria-label={t('txn.filters')}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {showFilters && (
        <Card className="mb-3 grid grid-cols-2 gap-2 p-3">
          <TextInput inputMode="decimal" dir="ltr" placeholder={t('search.minAmount')} value={minAmt} onChange={(e) => setMinAmt(e.target.value)} />
          <TextInput inputMode="decimal" dir="ltr" placeholder={t('search.maxAmount')} value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} />
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('txn.from')} />
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('txn.to')} />
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('reports.allCategories')}</option>
            {[...catMap.values()].filter((c) => !c.parentId).map((c) => <option key={c.id} value={c.id}>{categoryName(c, i18n.language)}</option>)}
          </Select>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t('reports.allAccounts')}</option>
            {accountsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <TextInput className="col-span-2" placeholder={t('search.person')} value={person} onChange={(e) => setPerson(e.target.value)} />
        </Card>
      )}

      {!results ? (
        <EmptyState icon={<SearchIcon size={40} />} text={t('search.hint')} />
      ) : total === 0 ? (
        <EmptyState icon={<SearchIcon size={40} />} text={t('search.noResults')} />
      ) : (
        <>
          <Section title={t('search.sections.transactions')} count={results.txns.length}>
            {results.txns.map((tx) => <TxnListItem key={tx.id} txn={tx} categories={catMap} accounts={accountsList} onClick={() => openEdit(tx)} />)}
          </Section>
          <Section title={t('search.sections.people')} count={results.people.length}>
            {results.people.map(([p, n]) => <Row key={p} icon={<User size={16} />} label={p} sub={`${n}`} onClick={() => { setPerson(p); setQ(''); setShowFilters(true); }} />)}
          </Section>
          <Section title={t('search.sections.accounts')} count={results.accounts.length}>
            {results.accounts.map((a) => (
              <Row key={a.id} icon={<Wallet size={16} />} label={a.name} sub={t(`accounts.types.${a.type}`)} onClick={() => navigate(`/accounts/${a.id}`)} />
            ))}
          </Section>
          <Section title={t('search.sections.categories')} count={results.categories.length}>
            {results.categories.map((c) => <Row key={c.id} icon={<Tags size={16} />} label={categoryName(c, i18n.language)} onClick={() => { setCategoryId(c.parentId ?? c.id); setQ(''); setShowFilters(true); }} />)}
          </Section>
          <Section title={t('search.sections.debts')} count={results.debts.length}>
            {results.debts.map((d) => (
              <button key={d.id} onClick={() => navigate('/more/debts')} className="flex w-full items-center gap-3 rounded-2xl px-1 py-2.5 text-start active:bg-surface-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary"><HandCoins size={16} /></span>
                <span className="flex-1 text-sm font-medium">{d.person}</span>
                <MoneyText minor={d.remainingMinor} currency={d.currency} kind={d.direction === 'owed_to_me' ? 'income' : 'liability'} className="text-sm" />
              </button>
            ))}
          </Section>
          <Section title={t('search.sections.goals')} count={results.goals.length}>
            {results.goals.map((g) => <Row key={g.id} icon={<Target size={16} />} label={g.name} onClick={() => navigate('/more/goals')} />)}
          </Section>
          <Section title={t('attachments.title')} count={results.files.length}>
            {results.files.map((a) => (
              <Row key={a.id} icon={<Paperclip size={16} />} label={a.name} sub={t(`audit.tableNames.${a.ownerType === 'transaction' ? 'transactions' : a.ownerType + 's'}`)}
                onClick={() => {
                  if (a.ownerType === 'transaction') {
                    const tx = data?.txns.find((x) => x.id === a.ownerId);
                    if (tx) openEdit(tx);
                  } else if (a.ownerType === 'account') navigate(`/accounts/${a.ownerId}`);
                  else navigate(`/more/${a.ownerType === 'debt' ? 'debts' : a.ownerType + 's'}`);
                }} />
            ))}
          </Section>
          <Section title={t('search.sections.tags')} count={results.tags.length}>
            {results.tags.map((tg) => <Row key={tg.id} icon={<Hash size={16} />} label={tg.name} onClick={() => { setQ(tg.name); }} />)}
          </Section>
        </>
      )}
    </div>
  );
}
