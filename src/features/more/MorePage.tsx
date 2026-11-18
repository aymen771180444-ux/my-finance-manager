import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Settings, Tags, ArrowRightLeft, Trash2, History, Users, Bell, PiggyBank, RefreshCw, Search, Hash, LayoutGrid, ShieldCheck, DatabaseBackup, Cloud, FileUp,
  CalendarDays, Target, HandCoins, TrendingUp, Gem, FileText, Calculator, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Card } from '../../components/ui';

export default function MorePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const Chevron = i18n.dir() === 'rtl' ? ChevronLeft : ChevronRight;

  const groups = [
    {
      title: t('more.groupPlanning'),
      items: [
        { to: '/more/budgets', icon: PiggyBank, label: t('budgets.title') },
        { to: '/more/goals', icon: Target, label: t('more.goals') },
        { to: '/more/debts', icon: HandCoins, label: t('more.debts') },
        { to: '/more/recurring', icon: RefreshCw, label: t('recurring.title') },
        { to: '/more/investments', icon: TrendingUp, label: t('more.investments') },
        { to: '/more/assets', icon: Gem, label: t('more.assets') },
      ],
    },
    {
      title: t('more.groupTools'),
      items: [
        { to: '/more/reports', icon: FileText, label: t('more.reports') },
        { to: '/more/calendar', icon: CalendarDays, label: t('more.calendar') },
        { to: '/more/calculator', icon: Calculator, label: t('more.calculator') },
        { to: '/more/import', icon: FileUp, label: t('more.importTx') },
        { to: '/search', icon: Search, label: t('search.title') },
        { to: '/more/notifications', icon: Bell, label: t('notifications.title') },
      ],
    },
    {
      title: t('more.groupSetup'),
      items: [
        { to: '/more/settings', icon: Settings, label: t('common.settings') },
        { to: '/more/security', icon: ShieldCheck, label: t('security.title') },
        { to: '/more/backup', icon: DatabaseBackup, label: t('backup.title') },
        { to: '/more/sync', icon: Cloud, label: t('sync.title') },
        { to: '/more/dashboard', icon: LayoutGrid, label: t('cards.customize') },
        { to: '/more/profiles', icon: Users, label: t('more.profiles') },
        { to: '/more/categories', icon: Tags, label: t('more.categories') },
        { to: '/more/tags', icon: Hash, label: t('tags.title') },
        { to: '/more/rates', icon: ArrowRightLeft, label: t('more.ratesTitle') },
        { to: '/more/trash', icon: Trash2, label: t('more.trash') },
        { to: '/more/audit', icon: History, label: t('more.auditLog') },
      ],
    },
  ];

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">{t('more.title')}</h1>
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <p className="mb-1 px-1 text-xs font-semibold text-ink-dim">{g.title}</p>
          <Card className="px-2">
            {g.items.map(({ to, icon: Icon, label }) => (
              <button key={to} onClick={() => navigate(to)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-3.5 text-start active:bg-surface-2">
                <Icon size={20} className="text-primary" />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <Chevron size={18} className="text-ink-dim" />
              </button>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
