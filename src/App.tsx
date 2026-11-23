import { Suspense, useEffect, useRef } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, ReceiptText, Wallet, ChartPie, Menu, Plus } from 'lucide-react';
import { useApp } from './store/app';
import { useLock } from './store/lock';
import { useTxnSheet } from './store/txnSheet';
import Onboarding from './features/onboarding/Onboarding';
import Dashboard from './features/dashboard/Dashboard';
import TxnFormSheet from './features/transactions/TxnFormSheet';
import { LockScreen } from './features/security/LockScreen';
import { runChecks } from './services/scheduler';
import { ErrorBoundary } from './components/ErrorBoundary';
import { setNotificationSink } from './db/notifications';
import { notificationText } from './features/notifications/format';
import { DEFAULT_NOTIFICATION_PREFS } from './db/types';
import { SyncBanner } from './features/sync/SyncBanner';
import { Toaster } from './components/Toaster';
import { usePageTransition } from './hooks/pageTransition';
import { isNativeApp } from './lib/platform';
import { lazyPage } from './lib/lazyPage';
import { UpdateBanner } from './components/UpdateBanner';

// Screens load on demand: the first paint only needs the dashboard.
const TransactionsPage = lazyPage(() => import('./features/transactions/TransactionsPage'));
const AccountsPage = lazyPage(() => import('./features/accounts/AccountsPage'));
const AccountDetailPage = lazyPage(() => import('./features/accounts/AccountDetailPage'));
const AnalyticsPage = lazyPage(() => import('./features/analytics/AnalyticsPage'));
const MorePage = lazyPage(() => import('./features/more/MorePage'));
const SettingsPage = lazyPage(() => import('./features/more/SettingsPage'));
const CategoriesPage = lazyPage(() => import('./features/more/CategoriesPage'));
const RatesPage = lazyPage(() => import('./features/more/RatesPage'));
const TrashPage = lazyPage(() => import('./features/more/TrashPage'));
const AuditPage = lazyPage(() => import('./features/more/AuditPage'));
const ProfilesPage = lazyPage(() => import('./features/more/ProfilesPage'));
const BudgetsPage = lazyPage(() => import('./features/budgets/BudgetsPage'));
const GoalsPage = lazyPage(() => import('./features/goals/GoalsPage'));
const DebtsPage = lazyPage(() => import('./features/debts/DebtsPage'));
const RecurringPage = lazyPage(() => import('./features/recurring/RecurringPage'));
const NotificationsPage = lazyPage(() => import('./features/notifications/NotificationsPage'));
const NotificationSettingsPage = lazyPage(() => import('./features/notifications/NotificationSettingsPage'));
const ReportsPage = lazyPage(() => import('./features/reports/ReportsPage'));
const CalendarPage = lazyPage(() => import('./features/calendar/CalendarPage'));
const SearchPage = lazyPage(() => import('./features/search/SearchPage'));
const CalculatorPage = lazyPage(() => import('./features/calculator/CalculatorPage'));
const TagsPage = lazyPage(() => import('./features/more/TagsPage'));
const InvestmentsPage = lazyPage(() => import('./features/investments/InvestmentsPage'));
const AssetsPage = lazyPage(() => import('./features/assets/AssetsPage'));
const DashboardCustomizePage = lazyPage(() => import('./features/dashboard/DashboardCustomizePage'));
const SecurityPage = lazyPage(() => import('./features/security/SecurityPage'));
const BackupPage = lazyPage(() => import('./features/backup/BackupPage'));
const ImportPage = lazyPage(() => import('./features/import/ImportPage'));
const SyncPage = lazyPage(() => import('./features/sync/SyncPage'));

function BottomNav() {
  const { t } = useTranslation();
  const openNew = useTxnSheet((s) => s.openNew);
  const tabs = [
    { to: '/', icon: Home, label: t('nav.home') },
    { to: '/transactions', icon: ReceiptText, label: t('nav.transactions') },
    { to: '/accounts', icon: Wallet, label: t('nav.accounts') },
    { to: '/analytics', icon: ChartPie, label: t('nav.analytics') },
    { to: '/more', icon: Menu, label: t('nav.more') },
  ];
  return (
    <>
      <button
        onClick={() => openNew()}
        aria-label={t('txn.addTitle')}
        className="no-print glow fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary ring-4 ring-white/40 transition active:scale-95"
      >
        <Plus size={26} />
      </button>
      <nav className="glass-bar fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg rounded-[1.75rem] border shadow-xl" aria-label={t('app.name')}>
        <div className="mx-auto flex max-w-lg gap-1 p-1.5">
          {tabs.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 rounded-[1.25rem] py-1.5 text-[11px] font-semibold transition ${isActive ? 'bg-primary-soft text-primary' : 'text-ink-dim'}`}
            >
              <Icon size={22} aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}

/** Auto-lock after inactivity, and immediately when the user leaves the app. */
function useAutoLock() {
  const { status, vaultEnabled, autoLockMinutes, lock } = useLock();
  useEffect(() => {
    if (!vaultEnabled || status !== 'open') return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - last > autoLockMinutes * 60_000) lock();
    }, 15_000);
    const onHide = () => {
      // the camera / file picker also hides the page — honor the short grace window
      if (document.visibilityState === 'hidden' && Date.now() > useLock.getState().graceUntil) lock();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [vaultEnabled, status, autoLockMinutes, lock]);
}

/** Show device notifications for new in-app ones, when enabled and permitted. */
function useSystemNotifications() {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(settings?.notificationPrefs ?? {}) };
    if (!prefs.system || typeof Notification === 'undefined') {
      setNotificationSink(null);
      return;
    }
    setNotificationSink((n) => {
      if (Notification.permission !== 'granted') return;
      const body = notificationText(n, settings?.calendar ?? 'gregorian');
      const title = String(useApp.getState().settings?.language === 'en' ? 'My Finance Manager' : 'مدير أموالي');
      const show = (reg?: ServiceWorkerRegistration): void => {
        if (reg) void reg.showNotification(title, { body, tag: n.dedupe, icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, badge: `${import.meta.env.BASE_URL}icons/icon-192.png` });
        else new Notification(title, { body, tag: n.dedupe });
      };
      if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration().then((r) => show(r ?? undefined));
      else show();
    });
    return () => setNotificationSink(null);
  }, [settings?.notificationPrefs, settings?.calendar]);
}

export default function App() {
  const { ready, settings, init } = useApp();
  const lockStatus = useLock((s) => s.status);
  const initLock = useLock((s) => s.init);
  const location = useLocation();
  const page = usePageTransition();

  useEffect(() => {
    void init();
    void initLock();
  }, [init, initLock]);

  useAutoLock();
  useSystemNotifications();

  // Android app: the hardware/gesture Back goes back a screen instead of closing the app
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(({ App: NativeApp }) =>
      NativeApp.addListener('backButton', ({ canGoBack }) => (canGoBack ? window.history.back() : void NativeApp.exitApp())).then((h) => {
        remove = () => void h.remove();
      }),
    );
    return () => remove?.();
  }, []);

  // Google Drive sync runs in the background once onboarding is done (no-op when not connected)
  const onboarded = !!settings?.onboardingDone;
  useEffect(() => {
    if (ready && onboarded) void import('./sync/service').then((m) => m.startSyncLoop());
  }, [ready, onboarded]);

  // keep the app underneath the lock screen out of focus/tab order (React 18 has no inert prop)
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    shellRef.current?.toggleAttribute('inert', lockStatus === 'locked');
  }, [lockStatus, ready]);

  // recurring catch-up + alerts: on start, and when the app regains focus
  const profileId = settings?.activeProfileId ?? null;
  useEffect(() => {
    if (!profileId) return;
    void runChecks(profileId);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runChecks(profileId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [profileId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // never paint financial data before we know whether the app is locked
  if (!ready || lockStatus === 'checking') return null;
  if (!settings?.onboardingDone || !settings.activeProfileId) return <Onboarding />;

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-lg px-4 pb-36 pt-5" ref={shellRef} aria-hidden={lockStatus === 'locked'}>
        <UpdateBanner />
        <SyncBanner />
        <ErrorBoundary resetKey={location.pathname}>
          <div key={page.key} className={page.className}>
          <Suspense fallback={<div className="py-16 text-center text-sm text-ink-dim">…</div>}>
            <Routes location={location}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/accounts/:id" element={<AccountDetailPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="/more/settings" element={<SettingsPage />} />
              <Route path="/more/categories" element={<CategoriesPage />} />
              <Route path="/more/rates" element={<RatesPage />} />
              <Route path="/more/trash" element={<TrashPage />} />
              <Route path="/more/audit" element={<AuditPage />} />
              <Route path="/more/profiles" element={<ProfilesPage />} />
              <Route path="/more/budgets" element={<BudgetsPage />} />
              <Route path="/more/goals" element={<GoalsPage />} />
              <Route path="/more/debts" element={<DebtsPage />} />
              <Route path="/more/recurring" element={<RecurringPage />} />
              <Route path="/more/notifications" element={<NotificationsPage />} />
              <Route path="/more/notification-settings" element={<NotificationSettingsPage />} />
              <Route path="/more/reports" element={<ReportsPage />} />
              <Route path="/more/calendar" element={<CalendarPage />} />
              <Route path="/more/calculator" element={<CalculatorPage />} />
              <Route path="/more/tags" element={<TagsPage />} />
              <Route path="/more/investments" element={<InvestmentsPage />} />
              <Route path="/more/assets" element={<AssetsPage />} />
              <Route path="/more/dashboard" element={<DashboardCustomizePage />} />
              <Route path="/more/security" element={<SecurityPage />} />
              <Route path="/more/backup" element={<BackupPage />} />
              <Route path="/more/import" element={<ImportPage />} />
              <Route path="/more/sync" element={<SyncPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Suspense>
          </div>
        </ErrorBoundary>
        <BottomNav />
        <ErrorBoundary resetKey={location.pathname}>
          <TxnFormSheet />
        </ErrorBoundary>
      </div>
      {lockStatus === 'locked' && <LockScreen />}
      <Toaster />
    </>
  );
}
