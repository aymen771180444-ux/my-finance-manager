import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export function Card({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`glass rounded-3xl ${onClick ? 'cursor-pointer transition active:scale-[0.985] active:opacity-90' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'soft';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: 'bg-primary text-on-primary font-semibold glow active:opacity-90',
    soft: 'bg-primary-soft text-primary font-semibold active:opacity-80',
    ghost: 'bg-surface text-ink border border-[var(--c-glass-edge)] active:bg-surface-2',
    danger: 'bg-expense-soft text-expense font-semibold active:opacity-80',
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-dim">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-2xl border border-[var(--c-glass-edge)] bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-dim/70 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-2xl border border-[var(--c-glass-edge)] bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-2xl px-2 py-1.5 text-sm font-medium transition ${
            value === o.value ? 'bg-primary text-on-primary glow' : 'text-ink-dim'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom-sheet style modal, mobile friendly. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={title}>
      <div className="glass-overlay fade-in absolute inset-0 bg-[#0b1324]/40" onClick={onClose} />
      <div className="sheet-up relative z-10 max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] border-t border-[var(--c-glass-edge)] bg-bg p-4 pb-8 shadow-2xl sm:rounded-[2rem]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label={t('common.close')} className="rounded-full p-2 text-ink-dim active:bg-surface-2">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger = true,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" role="alertdialog" aria-modal>
      <div className="glass-overlay fade-in absolute inset-0 bg-[#0b1324]/40" onClick={onCancel} />
      <Card className="pop-in relative z-10 w-full max-w-sm p-5">
        <h3 className="mb-2 text-base font-bold">{title}</h3>
        <p className="mb-4 text-sm text-ink-dim">{body}</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function EmptyState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center text-ink-dim">
      {icon}
      <p className="max-w-xs text-sm">{text}</p>
    </div>
  );
}
