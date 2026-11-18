import { useTranslation } from 'react-i18next';
import { formatMoney, type CurrencyCode } from '../engine/money';
import { useApp } from '../store/app';

/**
 * The ONLY component that renders money. Honors the hide-balances setting and
 * colors by semantic kind (income green / expense red / transfer blue / liability amber).
 */
export function MoneyText({
  minor,
  currency,
  kind = 'neutral',
  signed = false,
  className = '',
  respectHide = true,
}: {
  minor: number;
  currency: CurrencyCode;
  kind?: 'income' | 'expense' | 'transfer' | 'liability' | 'neutral';
  signed?: boolean;
  className?: string;
  respectHide?: boolean;
}) {
  const { i18n } = useTranslation();
  const hide = useApp((s) => s.settings?.hideBalances ?? false);
  const color = {
    income: 'text-income',
    expense: 'text-expense',
    transfer: 'text-transfer',
    liability: 'text-liability',
    neutral: '',
  }[kind];
  if (hide && respectHide) {
    return <span className={`font-semibold tabular-nums ${color} ${className}`}>•••••</span>;
  }
  const text = formatMoney(minor, currency, i18n.language, {
    signDisplay: signed ? 'always' : 'auto',
  });
  return (
    <span dir="ltr" className={`font-semibold tabular-nums ${color} ${className}`}>
      {text}
    </span>
  );
}
