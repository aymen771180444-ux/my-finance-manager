import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Wallet, Landmark, Smartphone, PiggyBank, CreditCard } from 'lucide-react';
import { useAccounts, useActiveProfileId, useLatestRates } from '../../hooks/data';
import { Card, Button, Sheet, Field, TextInput, Select, EmptyState } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { createAccount } from '../../db/accounts';
import { toMinor, convertToBase, CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { todayISO } from '../../db/schema';
import type { Account, AccountType } from '../../db/types';

export const ACCOUNT_ICONS: Record<AccountType, typeof Wallet> = {
  cash: Wallet,
  bank: Landmark,
  ewallet: Smartphone,
  savings: PiggyBank,
  credit_card: CreditCard,
};

export function AccountRow({ account, onClick }: { account: Account; onClick?: () => void }) {
  const { t } = useTranslation();
  const Icon = ACCOUNT_ICONS[account.type];
  const isLiability = account.type === 'credit_card' && account.currentBalanceMinor < 0;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-start active:bg-surface-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{account.name}</span>
        <span className="block text-xs text-ink-dim">
          {t(`accounts.types.${account.type}`)}
          {account.status === 'closed' && ` · ${t('accounts.closed')}`}
          {isLiability && ` · ${t('accounts.liabilityNote')}`}
        </span>
      </span>
      <MoneyText
        minor={account.currentBalanceMinor}
        currency={account.currency}
        kind={isLiability ? 'liability' : 'neutral'}
        className="text-sm"
      />
    </button>
  );
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const accounts = useAccounts(true);
  const rates = useLatestRates();
  const [showAdd, setShowAdd] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('cash');
  const [currency, setCurrency] = useState<CurrencyCode>('YER');
  const [opening, setOpening] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const totalBase = useMemo(() => {
    let sum = 0;
    let missing = false;
    for (const a of accounts.filter((x) => x.status === 'active')) {
      if (a.currency === 'YER') sum += a.currentBalanceMinor;
      else {
        const r = rates?.get(a.currency);
        if (r === undefined) missing = true;
        else sum += convertToBase(a.currentBalanceMinor, a.currency, r);
      }
    }
    return { sum, missing };
  }, [accounts, rates]);

  async function add() {
    setError('');
    try {
      if (!profileId) return;
      let openingMinor = toMinor(opening || '0', currency);
      if (type === 'credit_card' && openingMinor > 0) openingMinor = -openingMinor; // owed amount entered as positive
      await createAccount({ profileId, name, type, currency, openingBalanceMinor: openingMinor, openedAt: todayISO(), notes });
      setShowAdd(false);
      setName(''); setOpening(''); setNotes(''); setType('cash'); setCurrency('YER');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('accounts.title')}</h1>
        <Button variant="soft" onClick={() => setShowAdd(true)}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      <Card className="mb-4 p-4">
        <p className="text-xs text-ink-dim">{t('dashboard.totalBalance')} — {t('dashboard.inBase')}</p>
        <p className="mt-1 text-2xl font-bold">
          <MoneyText minor={totalBase.sum} currency="YER" />
        </p>
        {totalBase.missing && <p className="mt-1 text-xs text-liability">{t('common.cannotConvert')}</p>}
      </Card>

      {accounts.length === 0 ? (
        <EmptyState icon={<Wallet size={40} />} text={t('accounts.empty')} />
      ) : (
        <Card className="px-2">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} onClick={() => navigate(`/accounts/${a.id}`)} />
          ))}
        </Card>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title={t('accounts.addTitle')}>
        <div className="space-y-4">
          <Field label={t('common.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.status')}>
              <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {(Object.keys(ACCOUNT_ICONS) as AccountType[]).map((ty) => (
                  <option key={ty} value={ty}>{t(`accounts.types.${ty}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.currency')}>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('accounts.openingBalance')} hint={t('accounts.openingHint')}>
            <TextInput inputMode="decimal" dir="ltr" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          </Field>
          <Field label={t('common.notes')}>
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
          <Button className="w-full" onClick={() => void add()} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
