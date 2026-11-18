import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Trash2, RotateCcw } from 'lucide-react';
import { db } from '../../db/schema';
import { useActiveProfileId } from '../../hooks/data';
import { Card, Button, EmptyState } from '../../components/ui';
import { restoreTransaction } from '../../db/transactions';
import { restoreAccount } from '../../db/accounts';
import { restoreCategory } from '../../db/categories';
import { restoreBudget } from '../../db/budgets';
import { restoreGoal } from '../../db/goals';
import { restoreDebt } from '../../db/debts';
import { restoreRecurring } from '../../db/recurring';
import { restoreInvestment } from '../../db/investments';
import { restoreAsset } from '../../db/assets';
import { restoreAttachment } from '../../db/attachments';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { TrashEntry } from '../../db/types';

export default function TrashPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const entries =
    useLiveQuery(async () => {
      if (!profileId) return [];
      const rows = await db.trash.where('profileId').equals(profileId).toArray();
      return rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    }, [profileId]) ?? [];
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function restore(entry: TrashEntry) {
    setError('');
    setOk('');
    try {
      if (entry.table === 'transactions') await restoreTransaction(entry.id);
      else if (entry.table === 'accounts') await restoreAccount(entry.id);
      else if (entry.table === 'categories') await restoreCategory(entry.id);
      else if (entry.table === 'budgets') await restoreBudget(entry.id);
      else if (entry.table === 'savingsGoals') await restoreGoal(entry.id);
      else if (entry.table === 'debts') await restoreDebt(entry.id);
      else if (entry.table === 'recurringObligations') await restoreRecurring(entry.id);
      else if (entry.table === 'investments') await restoreInvestment(entry.id);
      else if (entry.table === 'assets') await restoreAsset(entry.id);
      else if (entry.table === 'attachments') await restoreAttachment(entry.id);
      setOk(t('trash.restored'));
    } catch {
      setError(t('trash.restoreFailed'));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('trash.title')}</h1>
      </div>
      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('trash.hint')}</p>
      {ok && <p className="mb-2 rounded-2xl bg-income-soft px-3 py-2 text-sm text-income">{ok}</p>}
      {error && <p className="mb-2 rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}

      {entries.length === 0 ? (
        <EmptyState icon={<Trash2 size={40} />} text={t('trash.empty')} />
      ) : (
        <Card className="px-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-2 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {t(`audit.tableNames.${e.table}`, { defaultValue: e.table })}
                  {e.label ? ` · ${e.label}` : ''}
                </span>
                <span className="block text-xs text-ink-dim">
                  {t('trash.deletedOn')} {formatDate(e.deletedAt.slice(0, 10), i18n.language, calendar)} ·{' '}
                  {t('trash.purgeOn')} {formatDate(e.purgeAt.slice(0, 10), i18n.language, calendar)}
                </span>
              </span>
              <Button variant="soft" onClick={() => void restore(e)}>
                <span className="inline-flex items-center gap-1"><RotateCcw size={14} /> {t('common.restore')}</span>
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
