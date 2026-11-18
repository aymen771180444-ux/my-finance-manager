import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CreditCard, RotateCcw, Banknote } from 'lucide-react';
import type { Transaction, Category, Account } from '../../db/types';
import { MoneyText } from '../../components/MoneyText';
import { categoryName } from '../../components/CategoryBadge';
import { countsAsExpense, countsAsIncome, isInternalTransfer } from '../../engine/posting';

export function txnKind(t: Transaction): 'income' | 'expense' | 'transfer' | 'liability' | 'neutral' {
  if (countsAsIncome(t) || t.type === 'refund') return 'income';
  if (countsAsExpense(t)) return 'expense';
  if (isInternalTransfer(t)) return 'transfer';
  return 'neutral';
}

function TypeIcon({ t }: { t: Transaction }) {
  const cls = {
    income: 'bg-income-soft text-income',
    expense: 'bg-expense-soft text-expense',
    transfer: 'bg-transfer-soft text-transfer',
    liability: 'bg-liability-soft text-liability',
    neutral: 'bg-surface-2 text-ink-dim',
  }[txnKind(t)];
  const Icon =
    t.type === 'refund'
      ? RotateCcw
      : t.type === 'cc_purchase' || t.type === 'cc_payment'
        ? CreditCard
        : countsAsIncome(t)
          ? ArrowDownLeft
          : countsAsExpense(t)
            ? ArrowUpRight
            : isInternalTransfer(t)
              ? ArrowLeftRight
              : Banknote;
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${cls}`}>
      <Icon size={18} />
    </span>
  );
}

export function TxnListItem({
  txn,
  categories,
  accounts,
  onClick,
}: {
  txn: Transaction;
  categories: Map<string, Category>;
  accounts: Account[];
  onClick?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const kind = txnKind(txn);
  const cat = txn.categoryId ? categories.get(txn.categoryId) : null;
  const acc = accounts.find((a) => a.id === txn.accountId);
  const toAcc = txn.toAccountId ? accounts.find((a) => a.id === txn.toAccountId) : null;
  const sign = kind === 'expense' ? -1 : kind === 'income' ? 1 : 0;

  const title = txn.hasSplits
    ? t('txn.split')
    : cat
      ? categoryName(cat, i18n.language)
      : t(`txn.types.${txn.type}`);
  const subtitle = toAcc ? `${acc?.name ?? ''} ← ${toAcc.name}` : (txn.person || txn.notes || acc?.name || '');

  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-2.5 text-start active:bg-surface-2 rounded-2xl px-1">
      <TypeIcon t={txn} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-ink-dim">{subtitle}</span>
      </span>
      <MoneyText
        minor={sign === 0 ? txn.amountMinor : sign * txn.amountMinor}
        currency={txn.currency}
        kind={kind}
        signed={sign !== 0}
        className="text-sm"
      />
    </button>
  );
}
