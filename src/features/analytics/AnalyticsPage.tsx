import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import { ChartPie, Lightbulb, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { Card, EmptyState, Segmented, TextInput } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useAnalytics, usePeriodDigest, type PeriodMode } from '../../hooks/analytics';
import { useGoals } from '../../hooks/stage2';
import { averages, pctChange, topEntries, type Insight } from '../../engine/analytics';
import { goalProgressPct } from '../../engine/goals';
import { formatMoney } from '../../engine/money';
import { categoryName } from '../../components/CategoryBadge';
import { formatDate, monthRange } from '../../lib/dates';
import { useApp } from '../../store/app';
import { todayISO } from '../../db/schema';
import { ForecastView } from '../forecast/ForecastView';
import { useNetWorthTrend } from '../../hooks/stage4';
import type { Category } from '../../db/types';

const PALETTE = ['#1d4ed8', '#0d9488', '#f59e0b', '#059669', '#6366f1', '#0ea5e9', '#a16207', '#64748b'];

function catName(id: string, cats: Map<string, Category>, lang: string, none: string) {
  return id === '_none' ? none : categoryName(cats.get(id), lang);
}

function Change({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  const { t } = useTranslation();
  const ch = pctChange(cur, prev);
  if (ch === null) return <span className="text-[11px] text-ink-dim">{t('analytics.noBaseline')}</span>;
  const good = invert ? ch <= 0 : ch >= 0;
  const Icon = ch >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? 'text-income' : 'text-expense'}`} dir="ltr">
      <Icon size={12} /> {ch > 0 ? '+' : ''}{ch}%
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-5 px-1 text-sm font-bold">{children}</h2>;
}

export default function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const hide = useApp((s) => s.settings?.hideBalances ?? false);
  const [mode, setMode] = useState<PeriodMode>('month');
  const [custom, setCustom] = useState(() => monthRange());
  const a = useAnalytics(mode, custom);
  const goals = useGoals();
  const fmt = (m: number) => formatMoney(m, 'YER', lang);

  const weekdayData = useMemo(() => {
    if (!a) return [];
    // Saturday-first week
    const order = [6, 0, 1, 2, 3, 4, 5];
    const base = new Date(2026, 0, 3); // a Saturday
    return order.map((wd, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return { name: new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d), value: a.current.expenseByWeekday[wd] };
    });
  }, [a, lang]);

  if (!a) return null;
  const { current: cur, previous: prev } = a;
  const none = t('common.none');
  // averages over elapsed days so a half-finished month is not diluted
  const avg = averages(cur.expenseMinor, a.cur.from, a.daysElapsed > 0 && a.daysElapsed < a.daysTotal ? todayISO() : a.cur.to);
  const topCats = topEntries(cur.expenseByCategory, 7).map(([id, v]) => ({ name: catName(id, a.cats, lang, none), value: v, color: a.cats.get(id)?.color ?? '#94a3b8' }));
  const topDays = topEntries(cur.expenseByDay, 5);
  const incomeSources = topEntries(cur.incomeByCategory, 8).map(([id, v], i) => ({ name: catName(id, a.cats, lang, none), value: v, color: a.cats.get(id)?.color ?? PALETTE[i % PALETTE.length] }));
  const nwTotal = cur.needsMinor + cur.wantsMinor + cur.otherMinor;
  const hasData = cur.txnCount > 0 || prev.txnCount > 0;

  function renderInsight(ins: Insight): string {
    const p: Record<string, string | number> = { ...ins.params };
    if (typeof p.categoryId === 'string') p.category = catName(p.categoryId, a!.cats, lang, none);
    for (const k of ['amount', 'projected', 'budget']) if (typeof p[k] === 'number') p[k] = fmt(p[k] as number);
    return t(`analytics.insight.${ins.kind}`, p);
  }

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">{t('analytics.title')}</h1>

      <DigestCard />

      <div className="mb-3 mt-4">
        <Segmented
          options={[
            { value: 'month' as const, label: t('analytics.periodMonth') },
            { value: 'year' as const, label: t('analytics.periodYear') },
            { value: 'custom' as const, label: t('analytics.periodCustom') },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TextInput type="date" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
            <TextInput type="date" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <p className="mt-1 px-1 text-xs text-ink-dim">
          {formatDate(a.cur.from, lang, calendar)} – {formatDate(a.cur.to, lang, calendar)} · {t('analytics.vsPrevious')}
        </p>
      </div>

      {/* comparison KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <p className="text-xs text-ink-dim">{t('dashboard.income')}</p>
          <MoneyText minor={cur.incomeMinor} currency="YER" kind="income" />
          <div><Change cur={cur.incomeMinor} prev={prev.incomeMinor} /></div>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-dim">{t('dashboard.expenses')}</p>
          <MoneyText minor={cur.expenseMinor} currency="YER" kind="expense" />
          <div><Change cur={cur.expenseMinor} prev={prev.expenseMinor} invert /></div>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-dim">{t('reports.net')}</p>
          <MoneyText minor={cur.netMinor} currency="YER" kind={cur.netMinor >= 0 ? 'income' : 'expense'} />
          <div><Change cur={cur.netMinor} prev={prev.netMinor} /></div>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-dim">{t('analytics.savingsRate')}</p>
          <p className="font-semibold">{cur.savingsRatePct === null ? '—' : `${cur.savingsRatePct}%`}</p>
          {prev.savingsRatePct !== null && <p className="text-[11px] text-ink-dim">{prev.savingsRatePct}%</p>}
        </Card>
      </div>
      {cur.unconvertible > 0 && (
        <p className="mt-2 rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{t('dashboard.unconvertedNote', { count: cur.unconvertible })}</p>
      )}

      {/* insights */}
      <SectionTitle>{t('analytics.insights')}</SectionTitle>
      <Card className="p-3">
        {a.insights.length === 0 ? (
          <p className="text-sm text-ink-dim">{t('analytics.noInsights')}</p>
        ) : (
          <ul className="space-y-2">
            {a.insights.map((ins, i) => (
              <li key={i} className="flex gap-2 text-sm">
                {ins.severity === 'warn' ? (
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-liability" />
                ) : (
                  <Lightbulb size={16} className={`mt-0.5 shrink-0 ${ins.severity === 'good' ? 'text-income' : 'text-primary'}`} />
                )}
                <span>{renderInsight(ins)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!hasData ? (
        <EmptyState icon={<ChartPie size={40} />} text={t('common.noData')} />
      ) : hide ? null : (
        <>
          {/* spending */}
          <SectionTitle>{t('analytics.spending')}</SectionTitle>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              [t('analytics.avgDaily'), avg.dailyMinor],
              [t('analytics.avgWeekly'), avg.weeklyMinor],
              [t('analytics.avgMonthly'), avg.monthlyMinor],
            ].map(([label, v]) => (
              <Card key={label as string} className="p-2.5">
                <p className="text-[11px] text-ink-dim">{label}</p>
                <MoneyText minor={v as number} currency="YER" className="text-xs" />
              </Card>
            ))}
          </div>
          {topCats.length > 0 && (
            <Card className="mb-3 p-4">
              <h3 className="mb-2 text-sm font-semibold">{t('analytics.topCategories')}</h3>
              <div className="h-60" dir="ltr">
                <ResponsiveContainer>
                  <BarChart data={topCats} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} orientation={lang.startsWith('ar') ? 'right' : 'left'} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {topCats.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">{t('analytics.highestDays')}</h3>
              {topDays.length === 0 ? <p className="text-xs text-ink-dim">—</p> : topDays.map(([d, v]) => (
                <div key={d} className="flex justify-between py-1 text-sm">
                  <span className="text-ink-dim">{formatDate(d, lang, calendar, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <MoneyText minor={v} currency="YER" kind="expense" />
                </div>
              ))}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">{t('analytics.needsWants')}</h3>
              {nwTotal <= 0 ? <p className="text-xs text-ink-dim">—</p> : (
                <>
                  <div className="flex h-3 overflow-hidden rounded-full" dir="ltr">
                    <div className="bg-primary" style={{ width: `${(cur.needsMinor / nwTotal) * 100}%` }} />
                    <div className="bg-[#f59e0b]" style={{ width: `${(cur.wantsMinor / nwTotal) * 100}%` }} />
                    <div className="bg-ink-dim" style={{ width: `${(cur.otherMinor / nwTotal) * 100}%` }} />
                  </div>
                  {[
                    [t('analytics.needs'), cur.needsMinor, 'bg-primary'],
                    [t('analytics.wants'), cur.wantsMinor, 'bg-[#f59e0b]'],
                    [t('analytics.other'), cur.otherMinor, 'bg-ink-dim'],
                  ].map(([label, v, color]) => (
                    <div key={label as string} className="mt-1.5 flex items-center gap-2 text-sm">
                      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                      <span className="flex-1">{label}</span>
                      <span className="text-xs text-ink-dim">{Math.round(((v as number) / nwTotal) * 100)}%</span>
                      <MoneyText minor={v as number} currency="YER" className="text-xs" />
                    </div>
                  ))}
                </>
              )}
            </Card>
          </div>
          <Card className="mb-3 p-4">
            <h3 className="mb-2 text-sm font-semibold">{t('analytics.weekdays')}</h3>
            <div className="h-44" dir="ltr">
              <ResponsiveContainer>
                <BarChart data={lang.startsWith('ar') ? [...weekdayData].reverse() : weekdayData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="value" fill="var(--c-expense)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* income */}
          <SectionTitle>{t('analytics.income')}</SectionTitle>
          {incomeSources.length > 0 && (
            <Card className="mb-3 p-4">
              <h3 className="mb-2 text-sm font-semibold">{t('analytics.incomeBySource')}</h3>
              <div className="h-52">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={incomeSources} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                      {incomeSources.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${fmt(v)} (${Math.round((v / cur.incomeMinor) * 100)}%)`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <Card className="mb-3 p-4">
            <h3 className="mb-2 text-sm font-semibold">{t('analytics.incomeTrend')}</h3>
            <div className="h-44" dir="ltr">
              <ResponsiveContainer>
                <LineChart data={a.incomeTrend.map((m) => ({ name: new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(`${m.month}T12:00:00`)), value: m.incomeMinor }))}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} reversed={lang.startsWith('ar')} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Line type="monotone" dataKey="value" stroke="var(--c-income)" strokeWidth={2.5} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}

      {/* savings */}
      <SectionTitle>{t('analytics.savings')}</SectionTitle>
      <Card className="mb-3 p-4">
        <p className="text-sm">
          {t('analytics.savingsRate')}: <span className="font-bold">{cur.savingsRatePct === null ? '—' : `${cur.savingsRatePct}%`}</span>
        </p>
        {goals.length > 0 && (
          <>
            <h3 className="mb-1 mt-3 text-xs font-semibold text-ink-dim">{t('analytics.goalsProgress')}</h3>
            {goals.map((g) => {
              const pct = goalProgressPct(g);
              return (
                <div key={g.id} className="py-1.5">
                  <div className="flex justify-between text-sm"><span>{g.name}</span><span className="text-xs font-semibold">{pct}%</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" dir="ltr">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      {/* forecast */}
      <SectionTitle>{t('forecast.title')}</SectionTitle>
      <ForecastView />

      {/* net worth */}
      <SectionTitle>{t('analytics.netWorth')}</SectionTitle>
      {!hide && <NetWorthTrend />}
      <Card className="mb-3 p-4">
        <p className="text-2xl font-bold"><MoneyText minor={a.netWorth.netMinor} currency="YER" /></p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div><p className="text-xs text-ink-dim">{t('reports.assets')}</p><MoneyText minor={a.netWorth.assetsMinor} currency="YER" kind="income" /></div>
          <div><p className="text-xs text-ink-dim">{t('reports.liabilities')}</p><MoneyText minor={a.netWorth.liabilitiesMinor} currency="YER" kind="liability" /></div>
        </div>
        {!hide && <Distribution title={t('analytics.assetDist')} items={a.netWorth.assets} total={a.netWorth.assetsMinor} color="bg-income" />}
        {!hide && <Distribution title={t('analytics.liabilityDist')} items={a.netWorth.liabilities} total={a.netWorth.liabilitiesMinor} color="bg-liability" />}
        {a.netWorth.unconverted.length > 0 && (
          <p className="mt-2 text-xs text-liability">{a.netWorth.unconverted.map((u) => `${u.label} (${u.currency})`).join('، ')}: {t('common.cannotConvert')}</p>
        )}
        <p className="mt-2 text-[11px] text-ink-dim">{t('reports.netWorthNote')}</p>
      </Card>
    </div>
  );
}

function NetWorthTrend() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly');
  const points = useNetWorthTrend(mode);
  if (!points) return null;
  const data = points.map((p) => ({
    name: mode === 'monthly'
      ? new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(`${p.date}T12:00:00`))
      : p.date.slice(0, 4),
    net: p.netMinor,
    partial: p.partial,
  }));
  return (
    <Card className="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('nwTrend.title')}</h3>
        <div className="w-40">
          <Segmented options={[{ value: 'monthly' as const, label: t('nwTrend.monthly') }, { value: 'yearly' as const, label: t('nwTrend.yearly') }]} value={mode} onChange={setMode} />
        </div>
      </div>
      <div className="h-48" dir="ltr">
        <ResponsiveContainer>
          <LineChart data={lang.startsWith('ar') ? [...data].reverse() : data}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip formatter={(v: number) => formatMoney(v, 'YER', lang)} />
            <Line type="monotone" dataKey="net" stroke="var(--c-primary)" strokeWidth={2.5} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {points.some((p) => p.partial) && <p className="mt-1 text-[11px] text-liability">{t('common.cannotConvert')}</p>}
      <p className="mt-1 text-[11px] text-ink-dim">{t('nwTrend.note')}</p>
    </Card>
  );
}

function Distribution({ title, items, total, color }: { title: string; items: { id: string; label: string; baseMinor: number }[]; total: number; color: string }) {
  if (items.length === 0 || total <= 0) return null;
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-xs font-semibold text-ink-dim">{title}</h3>
      {[...items].sort((x, y) => y.baseMinor - x.baseMinor).map((x) => (
        <div key={x.id} className="py-1">
          <div className="flex justify-between text-xs"><span>{x.label}</span><span>{Math.round((x.baseMinor / total) * 100)}%</span></div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-2" dir="ltr">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${(x.baseMinor / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Daily / weekly / monthly summary (PRD §18). */
export function DigestCard() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const d = usePeriodDigest(period);
  if (!d) return null;
  const s = d.summary;
  const largest = topEntries(s.expenseByCategory, 1)[0];
  let vsAvg: string;
  if (d.averageMinor === null || d.averageMinor === 0) vsAvg = t('analytics.noAverage');
  else {
    const ch = pctChange(s.expenseMinor, d.averageMinor)!;
    vsAvg = ch >= 0 ? t('analytics.aboveAvg', { pct: ch }) : t('analytics.belowAvg', { pct: -ch });
  }
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="mb-2 text-sm font-bold">{t('analytics.summary')}</h2>
        <div>
          <Segmented
            options={[
              { value: 'daily' as const, label: t('analytics.summaryDay') },
              { value: 'weekly' as const, label: t('analytics.summaryWeek') },
              { value: 'monthly' as const, label: t('analytics.summaryMonth') },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <span className="text-ink-dim">{t('dashboard.income')}</span>
        <MoneyText minor={s.incomeMinor} currency="YER" kind="income" className="text-end" />
        <span className="text-ink-dim">{t('dashboard.expenses')}</span>
        <MoneyText minor={s.expenseMinor} currency="YER" kind="expense" className="text-end" />
        <span className="text-ink-dim">{t('analytics.largestCategory')}</span>
        <span className="text-end font-medium">{largest ? (largest[0] === '_none' ? t('common.none') : categoryName(d.cats.get(largest[0]), i18n.language)) : '—'}</span>
        <span className="text-ink-dim">{t('analytics.netChange')}</span>
        <MoneyText minor={d.netChangeMinor} currency="YER" kind={d.netChangeMinor >= 0 ? 'income' : 'expense'} signed className="text-end" />
      </div>
      <p className="mt-2 text-xs text-ink-dim">{t('analytics.vsAverage')}: {vsAvg}</p>
    </Card>
  );
}
