import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';
import { Card, Select } from '../../components/ui';
import { useApp } from '../../store/app';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '../../db/types';

const TOGGLES: (keyof NotificationPrefs)[] = ['budget', 'bills', 'installments', 'recurring', 'dailySummary', 'weeklySummary', 'monthlySummary', 'backupReminder'];

export default function NotificationSettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const { settings, setNotificationPrefs } = useApp();
  const prefs: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(settings?.notificationPrefs ?? {}) };
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported');
  useEffect(() => {
    if (supported) setPermission(Notification.permission);
  }, [supported]);
  const save = (patch: Partial<NotificationPrefs>) => void setNotificationPrefs({ ...prefs, ...patch });

  async function toggleSystem(on: boolean) {
    if (on && supported && Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') return;
    }
    save({ system: on && permission !== 'denied' });
  }

  const Row = ({ k, label }: { k: keyof NotificationPrefs; label: string }) => (
    <label className="flex items-center justify-between py-2.5">
      <span className="text-sm">{label}</span>
      <input type="checkbox" className="h-5 w-5 accent-[var(--c-primary)]" checked={Boolean(prefs[k])} onChange={(e) => save({ [k]: e.target.checked })} />
    </label>
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="text-xl font-bold">{t('notifPrefs.title')}</h1>
      </div>

      <Card className="mb-3 px-4 py-1">
        <label className="flex items-center justify-between py-2.5">
          <span className="text-sm font-medium">{t('notifPrefs.system')}</span>
          <input type="checkbox" className="h-5 w-5 accent-[var(--c-primary)]" disabled={permission === 'unsupported' || permission === 'denied'}
            checked={prefs.system && permission === 'granted'} onChange={(e) => void toggleSystem(e.target.checked)} />
        </label>
        {permission === 'denied' && <p className="pb-2 text-xs text-liability">{t('notifPrefs.systemDenied')}</p>}
      </Card>

      <Card className="mb-3 divide-y divide-line px-4">
        {TOGGLES.map((k) => <Row key={k} k={k} label={t(`notifPrefs.${k}`)} />)}
        <Row k="dailyReminder" label={t('notifPrefs.dailyReminder')} />
        {prefs.dailyReminder && (
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm">{t('notifPrefs.reminderHour')}</span>
            <Select className="w-28" value={prefs.dailyReminderHour} onChange={(e) => save({ dailyReminderHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{new Intl.DateTimeFormat(i18n.language, { hour: 'numeric' }).format(new Date(2026, 0, 1, h))}</option>
              ))}
            </Select>
          </div>
        )}
      </Card>

      <p className="flex gap-2 rounded-2xl bg-surface-2 px-3 py-3 text-xs text-ink-dim">
        <Info size={16} className="mt-0.5 shrink-0" />
        {t('notifPrefs.limitation')}
      </p>
    </div>
  );
}
