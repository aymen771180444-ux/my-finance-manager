import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudAlert } from 'lucide-react';
import { db } from '../../db/schema';
import { useSync } from '../../sync/status';

/**
 * A small notice above every screen when Drive sync needs the user:
 * sign-in expired, password needed, repeated failures, or open conflicts.
 * Silent when sync is off or healthy.
 */
export function SyncBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const phase = useSync((s) => s.phase);
  const info = useLiveQuery(async () => {
    const s = await db.syncState.get('sync');
    if (!s) return null;
    return { failures: s.failures, conflicts: await db.syncConflicts.filter((c) => !c.resolvedAt).count() };
  }, []);
  if (!info || pathname === '/more/sync') return null;
  const text =
    phase === 'needsAuth' ? t('sync.banner.auth')
    : phase === 'needsPassword' ? t('sync.banner.password')
    : info.failures >= 3 ? t('sync.banner.failing')
    : info.conflicts > 0 ? t('sync.banner.conflicts', { count: info.conflicts })
    : null;
  if (!text) return null;
  return (
    <button
      onClick={() => navigate('/more/sync')}
      className="no-print mb-3 flex w-full items-center gap-2 rounded-2xl bg-liability-soft px-3 py-2 text-start text-sm text-liability"
    >
      <CloudAlert size={18} aria-hidden className="shrink-0" />
      <span className="flex-1">{text}</span>
    </button>
  );
}
