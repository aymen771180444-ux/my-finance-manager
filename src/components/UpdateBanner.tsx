import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { useAppUpdate } from '../lib/pwa';

/** "A new version is ready" — the switch happens only when the user taps it. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { ready, apply } = useAppUpdate();
  if (!ready) return null;
  return (
    <button
      onClick={apply}
      className="no-print toast-in mb-3 flex w-full items-center gap-2 rounded-2xl bg-primary-soft px-3 py-2.5 text-start text-sm text-primary"
    >
      <Sparkles size={18} aria-hidden className="shrink-0" />
      <span className="flex-1 font-medium">{t('update.ready')}</span>
      <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary">{t('update.apply')}</span>
    </button>
  );
}
