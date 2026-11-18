import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bell, PiggyBank, RefreshCw, HandCoins, Target, BarChart3, AlarmClock, DatabaseBackup, Settings2, CloudOff } from 'lucide-react';
import { notificationText } from './format';
import { Card, Button, EmptyState } from '../../components/ui';
import { useNotifications } from '../../hooks/stage2';
import { markNotificationRead, markAllRead } from '../../db/notifications';
import { useActiveProfileId } from '../../hooks/data';
import { useApp } from '../../store/app';
import type { NotificationKind } from '../../db/types';

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  budget: PiggyBank,
  recurring: RefreshCw,
  debt: HandCoins,
  goal: Target,
  summary: BarChart3,
  reminder: AlarmClock,
  backup: DatabaseBackup,
  sync: CloudOff,
};

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const notifications = useNotifications();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('notifications.title')}</h1>
        <button onClick={() => navigate('/more/notification-settings')} className="rounded-full p-2 text-ink-dim active:bg-surface-2" aria-label={t('notifPrefs.title')}>
          <Settings2 size={20} />
        </button>
        {notifications.some((n) => !n.read) && (
          <Button variant="ghost" onClick={() => profileId && void markAllRead(profileId)}>
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon={<Bell size={40} />} text={t('notifications.empty')} />
      ) : (
        <Card className="px-2">
          {notifications.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? Bell;
            return (
              <button
                key={n.id}
                onClick={() => void markNotificationRead(n.id)}
                className={`flex w-full items-start gap-3 rounded-2xl px-2 py-3 text-start active:bg-surface-2 ${n.read ? 'opacity-55' : ''}`}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{notificationText(n, calendar)}</span>
                  <span className="block text-xs text-ink-dim" dir="ltr">
                    {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(n.createdAt))}
                  </span>
                </span>
                {!n.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}
