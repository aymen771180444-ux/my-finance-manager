import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, Segmented } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { db, todayISO } from '../../db/schema';
import { useActiveProfileId } from '../../hooks/data';
import { profileAccounts } from '../../db/reportData';
import { monthGrid, collectEvents, hijriParts, type CalendarEvent, type CalendarEventKind } from '../../engine/calendar';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { CurrencyCode } from '../../engine/money';

const DOT: Record<CalendarEventKind, string> = {
  income: 'bg-income',
  expense: 'bg-expense',
  recurring: 'bg-transfer',
  debtDue: 'bg-liability',
  installment: 'bg-liability',
  goalDeadline: 'bg-primary',
  contribution: 'bg-primary',
};

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const settingsCalendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const [cal, setCal] = useState<'gregorian' | 'hijri'>(settingsCalendar);
  const [anchor, setAnchor] = useState(todayISO());
  const [selected, setSelected] = useState(todayISO());
  const [view, setView] = useState<'month' | 'day'>('month');
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const PrevIcon = i18n.dir() === 'rtl' ? ChevronRight : ChevronLeft;
  const NextIcon = i18n.dir() === 'rtl' ? ChevronLeft : ChevronRight;

  const grid = useMemo(() => monthGrid(anchor, cal), [anchor, cal]);
  const from = grid.days[0];
  const to = grid.days[grid.days.length - 1];

  const events = useLiveQuery(async () => {
    if (!profileId) return new Map<string, CalendarEvent[]>();
    const txns = await db.transactions.where('[profileId+date]').between([profileId, from], [profileId, to + '￿']).toArray();
    const accounts = new Map((await profileAccounts(profileId)).map((a) => [a.id, a]));
    const recurring = (await db.recurringObligations.where('profileId').equals(profileId).toArray()).map((r) => ({
      ...r,
      currency: accounts.get(r.accountId)?.currency ?? 'YER',
    }));
    const debts = await db.debts.where('profileId').equals(profileId).toArray();
    const goals = await db.savingsGoals.where('profileId').equals(profileId).toArray();
    const goalById = new Map(goals.map((g) => [g.id, g]));
    const contributions = (await db.savingsContributions.where('[profileId+date]').between([profileId, from], [profileId, to + '￿']).toArray()).map((c) => ({
      ...c,
      currency: goalById.get(c.goalId)?.currency ?? 'YER',
      goalName: goalById.get(c.goalId)?.name ?? '',
    }));
    return collectEvents(from, to, { txns, recurring, debts, goals, contributions, today: todayISO() });
  }, [profileId, from, to]);

  const weekdays = useMemo(() => {
    const base = new Date(2026, 0, 3); // Saturday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(d);
    });
  }, [lang]);

  const title = useMemo(() => {
    const mid = grid.days[Math.floor(grid.days.length / 2)];
    return formatDate(mid, lang, cal, { month: 'long', year: 'numeric' });
  }, [grid, lang, cal]);
  const secondary = useMemo(() => {
    const other = cal === 'hijri' ? 'gregorian' : 'hijri';
    const a = formatDate(from, lang, other, { month: 'short', year: 'numeric' });
    const b = formatDate(to, lang, other, { month: 'short', year: 'numeric' });
    return a === b ? a : `${a} – ${b}`;
  }, [from, to, lang, cal]);

  const today = todayISO();
  const dayEvents = events?.get(selected) ?? [];

  function dayNumber(d: string): number {
    return cal === 'hijri' ? hijriParts(d).day : parseInt(d.slice(8), 10);
  }
  function step(dir: -1 | 1) {
    if (view === 'month') {
      const next = dir === -1 ? grid.prevAnchor : grid.nextAnchor;
      setAnchor(next);
    } else {
      const d = new Date(`${selected}T12:00:00`);
      d.setDate(d.getDate() + dir);
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setSelected(s);
      setAnchor(s);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('calendar.title')}</h1>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Segmented
          options={[
            { value: 'gregorian' as const, label: t('settings.gregorian') },
            { value: 'hijri' as const, label: t('settings.hijri') },
          ]}
          value={cal}
          onChange={setCal}
        />
        <Segmented
          options={[
            { value: 'month' as const, label: t('calendar.monthView') },
            { value: 'day' as const, label: t('calendar.dayView') },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => step(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('calendar.prev')}><PrevIcon size={20} /></button>
        <div className="flex-1 text-center">
          <p className="font-bold">{view === 'month' ? title : formatDate(selected, lang, cal, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="text-xs text-ink-dim">{view === 'month' ? secondary : formatDate(selected, lang, cal === 'hijri' ? 'gregorian' : 'hijri', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={() => step(1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('calendar.next')}><NextIcon size={20} /></button>
      </div>
      <div className="mb-3 text-center">
        <button className="text-xs font-semibold text-primary" onClick={() => { setAnchor(today); setSelected(today); }}>{t('calendar.today')}</button>
      </div>

      {view === 'month' && (
        <Card className="mb-3 p-2">
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-ink-dim">
            {weekdays.map((w, i) => <div key={i} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: grid.leadingBlanks }, (_, i) => <div key={`b${i}`} />)}
            {grid.days.map((d) => {
              const ev = events?.get(d) ?? [];
              const kinds = [...new Set(ev.map((e) => e.kind))].slice(0, 4);
              const isSel = d === selected;
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d)}
                  onDoubleClick={() => { setSelected(d); setView('day'); }}
                  className={`flex aspect-square flex-col items-center justify-center rounded-2xl text-sm ${isSel ? 'bg-primary text-on-primary' : d === today ? 'bg-primary-soft text-primary font-bold' : 'active:bg-surface-2'}`}
                >
                  <span>{dayNumber(d)}</span>
                  <span className="mt-0.5 flex h-1.5 gap-0.5">
                    {kinds.map((k) => <span key={k} className={`h-1.5 w-1.5 rounded-full ${isSel ? 'bg-white' : DOT[k]}`} />)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1 text-[10px] text-ink-dim">
            {(['income', 'expense', 'recurring', 'debtDue', 'goalDeadline'] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${DOT[k]}`} />{t(`calendar.events.${k}`)}</span>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-3">
        {view === 'month' && <p className="mb-2 text-sm font-semibold">{formatDate(selected, lang, cal, { weekday: 'long', day: 'numeric', month: 'long' })}</p>}
        {dayEvents.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-dim">{t('calendar.nothing')}</p>
        ) : (
          dayEvents.map((e, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[e.kind]}`} />
              <span className="flex-1 text-sm">
                {t(`calendar.events.${e.kind}`)}
                {e.label && <span className="text-ink-dim"> · {e.label}</span>}
                {e.scheduled && <span className="ms-1 rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-dim">{t('calendar.estimated')}</span>}
              </span>
              {e.amountMinor !== null && (
                <MoneyText
                  minor={e.amountMinor}
                  currency={e.currency as CurrencyCode}
                  kind={e.kind === 'income' ? 'income' : e.kind === 'expense' ? 'expense' : e.kind === 'debtDue' || e.kind === 'installment' ? 'liability' : 'neutral'}
                  className="text-sm"
                />
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
