import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, History } from 'lucide-react';
import { db } from '../../db/schema';
import { useActiveProfileId } from '../../hooks/data';
import { Card, EmptyState } from '../../components/ui';

export default function AuditPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const entries =
    useLiveQuery(async () => {
      if (!profileId) return [];
      const rows = await db.auditLog.where('profileId').equals(profileId).toArray();
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
    }, [profileId]) ?? [];
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const actionColor: Record<string, string> = {
    create: 'bg-income-soft text-income',
    update: 'bg-transfer-soft text-transfer',
    delete: 'bg-expense-soft text-expense',
    restore: 'bg-primary-soft text-primary',
    reconcile: 'bg-liability-soft text-liability',
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('audit.title')}</h1>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={<History size={40} />} text={t('audit.empty')} />
      ) : (
        <Card className="px-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-2 py-2.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${actionColor[e.action] ?? 'bg-surface-2'}`}>
                {t(`audit.actions.${e.action}`)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {t(`audit.tableNames.${e.table}`, { defaultValue: e.table })}
                </span>
                <span className="block text-xs text-ink-dim" dir="ltr">
                  {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(e.createdAt))}
                </span>
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
