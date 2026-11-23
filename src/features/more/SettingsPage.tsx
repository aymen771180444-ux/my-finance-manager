import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ShieldCheck, DatabaseBackup, Cloud, Bell, LayoutGrid, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, Field, Segmented } from '../../components/ui';
import { useApp } from '../../store/app';
import { THEME_PRESETS, DEFAULT_THEME, deriveTheme, type ThemePreset } from '../../engine/theme';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { settings, setLanguage, setTheme, setCalendar, setHideBalances, setColorTheme } = useApp();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const Chevron = i18n.dir() === 'rtl' ? ChevronLeft : ChevronRight;
  if (!settings) return null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('settings.title')}</h1>
      </div>

      <Card className="mb-3 space-y-4 p-4">
        <Field label={t('settings.language')}>
          <Segmented
            options={[
              { value: 'ar' as const, label: t('settings.arabic') },
              { value: 'en' as const, label: t('settings.english') },
            ]}
            value={settings.language}
            onChange={(v) => void setLanguage(v)}
          />
        </Field>
        <Field label={t('settings.theme')}>
          <Segmented
            options={[
              { value: 'light' as const, label: t('settings.light') },
              { value: 'dark' as const, label: t('settings.dark') },
              { value: 'auto' as const, label: t('settings.auto') },
            ]}
            value={settings.theme}
            onChange={(v) => void setTheme(v)}
          />
        </Field>
        <div role="group" aria-label={t('themes.title')}>
          <span className="mb-1 block text-sm font-medium text-ink-dim">{t('themes.title')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((p) => {
              const on = (settings.colorTheme ?? DEFAULT_THEME) === p;
              return (
                <button key={p} type="button" onClick={() => void setColorTheme(p)} aria-label={t(`themes.presets.${p}`)} aria-pressed={on}
                  className={`h-9 w-9 rounded-full border-2 ${on ? 'border-ink' : 'border-transparent'}`} style={{ backgroundImage: `linear-gradient(135deg, ${THEME_PRESETS[p]}, ${deriveTheme(THEME_PRESETS[p]).light.primary2})` }} />
              );
            })}
            <label className={`flex h-9 items-center gap-1.5 rounded-full border-2 px-2 text-xs ${settings.colorTheme === 'custom' ? 'border-ink' : 'border-line'}`}>
              <input type="color" className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0" value={settings.customColor ?? THEME_PRESETS[DEFAULT_THEME]}
                onChange={(e) => void setColorTheme('custom', e.target.value)} aria-label={t('themes.custom')} />
              {t('themes.custom')}
            </label>
          </div>
          <span className="mt-1 block text-xs text-ink-dim">{t('themes.contrastNote')}</span>
        </div>
        <Field label={t('settings.calendar')}>
          <Segmented
            options={[
              { value: 'gregorian' as const, label: t('settings.gregorian') },
              { value: 'hijri' as const, label: t('settings.hijri') },
            ]}
            value={settings.calendar}
            onChange={(v) => void setCalendar(v)}
          />
        </Field>
        <label className="flex items-center justify-between py-1">
          <span className="text-sm font-medium">{t('dashboard.hideBalances')}</span>
          <input
            type="checkbox"
            checked={settings.hideBalances}
            onChange={(e) => void setHideBalances(e.target.checked)}
            className="h-5 w-5 accent-[var(--c-primary)]"
          />
        </label>
      </Card>

      <Card className="mb-3 p-4">
        <p className="text-sm font-medium">{t('settings.baseCurrency')}</p>
        <p className="mt-1 text-xs text-ink-dim">{t('settings.baseCurrencyNote')}</p>
      </Card>

      <Card className="px-2">
        {[
          { to: '/more/security', icon: ShieldCheck, label: t('security.title') },
          { to: '/more/backup', icon: DatabaseBackup, label: t('backup.title') },
          { to: '/more/sync', icon: Cloud, label: t('sync.title') },
          { to: '/more/notification-settings', icon: Bell, label: t('notifPrefs.title') },
          { to: '/more/dashboard', icon: LayoutGrid, label: t('cards.customize') },
        ].map(({ to, icon: Icon, label }) => (
          <button key={to} onClick={() => navigate(to)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-3.5 text-start active:bg-surface-2">
            <Icon size={20} className="text-primary" aria-hidden />
            <span className="flex-1 text-sm font-medium">{label}</span>
            <Chevron size={18} className="text-ink-dim" aria-hidden />
          </button>
        ))}
      </Card>
      <p className="mt-4 text-center text-xs text-ink-dim" dir="auto">{t('settings.version', { version: __APP_VERSION__ })}</p>
    </div>
  );
}
