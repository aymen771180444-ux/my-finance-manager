import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useToast, toast } from '../store/toast';
import { setMutationSink } from '../db/audit';

/** iOS-style glass banner that drops in from the top after an action completes. */
export function Toaster() {
  const { current, dismiss } = useToast();
  const { t } = useTranslation();

  // every saved change the user made (add, edit, delete, restore…) announces itself once committed.
  // Background work (recurring bills, auto-saving, sync) runs without a recent tap, so it stays silent —
  // without muting a save the user makes while that work is running.
  useEffect(() => {
    let lastTap = 0;
    const tapped = () => {
      lastTap = Date.now();
    };
    window.addEventListener('pointerdown', tapped, true);
    window.addEventListener('keydown', tapped, true);
    setMutationSink(({ table, action }) => {
      if (Date.now() - lastTap > 10_000) return;
      const item = t(`toast.items.${table}`, { defaultValue: t('toast.items.default') });
      toast(t(`toast.${action}`, { item }));
    });
    return () => {
      setMutationSink(null);
      window.removeEventListener('pointerdown', tapped, true);
      window.removeEventListener('keydown', tapped, true);
    };
  }, [t]);

  if (!current) return null;
  const Icon = current.kind === 'success' ? CheckCircle2 : current.kind === 'error' ? AlertCircle : Info;
  const tone = current.kind === 'success' ? 'text-income' : current.kind === 'error' ? 'text-expense' : 'text-primary';
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-[90] flex justify-center px-4">
      <button
        key={current.id}
        onClick={dismiss}
        role="status"
        aria-live="polite"
        className="toast-in glass-bar pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full border py-2.5 ps-3 pe-5 text-sm font-semibold text-ink shadow-xl"
      >
        <Icon size={22} className={`toast-icon shrink-0 ${tone}`} aria-hidden />
        <span className="text-start">{current.text}</span>
      </button>
    </div>
  );
}
