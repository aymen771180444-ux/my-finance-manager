import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Plus, TrendingUp, Trash2 } from 'lucide-react';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, EmptyState, ConfirmDialog } from '../../components/ui';
import { MoneyText } from '../../components/MoneyText';
import { useInvestments, useInvestmentHistory } from '../../hooks/stage4';
import { useAccounts, useActiveProfileId } from '../../hooks/data';
import { createInvestment, buyInvestment, sellInvestment, recordValuation, deleteInvestment, deleteInvestmentTxn } from '../../db/investments';
import { latestRatesMap } from '../../db/reportData';
import { performance, toQuantityMicro, quantityToString } from '../../engine/investments';
import { toMinor, convertToBase, formatMoney, CURRENCY_CODES, type CurrencyCode } from '../../engine/money';
import { todayISO } from '../../db/schema';
import { formatDate } from '../../lib/dates';
import { useApp } from '../../store/app';
import type { Investment, InvestmentType } from '../../db/types';
import { AttachmentList } from '../../components/AttachmentList';

const TYPES: InvestmentType[] = ['stock', 'fund', 'crypto', 'gold', 'bond', 'deposit', 'other'];
type TradeKind = 'buy' | 'sell' | 'valuation';

export default function InvestmentsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const profileId = useActiveProfileId();
  const investments = useInvestments();
  const accounts = useAccounts();
  const rates = useLiveQuery(() => latestRatesMap(), []);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<Investment | null>(null);
  const [trade, setTrade] = useState<{ inv: Investment; kind: TradeKind } | null>(null);
  const [toDelete, setToDelete] = useState<Investment | null>(null);
  const [error, setError] = useState('');

  const portfolio = useMemo(() => {
    let mv = 0;
    let cost = 0;
    let missing = false;
    for (const inv of investments) {
      if (inv.quantityMicro <= 0) continue;
      const p = performance(inv);
      const r = inv.currency === 'YER' ? 1 : rates?.get(inv.currency);
      if (r === undefined) {
        missing = true;
        continue;
      }
      cost += convertToBase(p.costBasisMinor, inv.currency, r);
      if (p.marketValueMinor !== null) mv += convertToBase(p.marketValueMinor, inv.currency, r);
    }
    return { mv, cost, missing };
  }, [investments, rates]);

  function friendly(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes('INSUFFICIENT_QUANTITY')) return t('investments.insufficient');
    if (m.includes('INVESTMENT_HISTORY_CONFLICT')) return t('investments.conflict');
    if (m.includes('CURRENCY_MISMATCH')) return t('investments.currencyMismatch');
    return m;
  }

  const current = detail ? investments.find((i) => i.id === detail.id) ?? null : null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="flex-1 text-xl font-bold">{t('investments.title')}</h1>
        <Button variant="soft" onClick={() => { setError(''); setShowAdd(true); }}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      {investments.some((i) => i.quantityMicro > 0) && (
        <Card className="mb-3 p-4">
          <p className="text-xs text-ink-dim">{t('investments.total')} · {t('investments.marketValue')}</p>
          <p className="text-2xl font-bold"><MoneyText minor={portfolio.mv} currency="YER" /></p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div><p className="text-xs text-ink-dim">{t('investments.costBasis')}</p><MoneyText minor={portfolio.cost} currency="YER" /></div>
            <div><p className="text-xs text-ink-dim">{t('investments.unrealized')}</p>
              <MoneyText minor={portfolio.mv - portfolio.cost} currency="YER" kind={portfolio.mv >= portfolio.cost ? 'income' : 'expense'} signed /></div>
          </div>
          {portfolio.missing && <p className="mt-2 text-xs text-liability">{t('common.cannotConvert')}</p>}
        </Card>
      )}
      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('investments.priceHint')}</p>

      {investments.length === 0 ? (
        <EmptyState icon={<TrendingUp size={40} />} text={t('investments.empty')} />
      ) : (
        <Card className="px-2">
          {investments.map((inv) => {
            const p = performance(inv);
            return (
              <button key={inv.id} onClick={() => { setError(''); setDetail(inv); }} className="flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-start active:bg-surface-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><TrendingUp size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {inv.name}
                    {inv.status === 'closed' && <span className="ms-2 rounded-full bg-surface-2 px-2 text-[10px] text-ink-dim">{t('investments.closed')}</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-dim">
                    {t(`investments.types.${inv.type}`)} · <span dir="ltr">{quantityToString(inv.quantityMicro)}</span> {inv.unit}
                    {inv.lastPriceDate && ` · ${formatDate(inv.lastPriceDate, lang, calendar)}`}
                  </span>
                </span>
                <span className="text-end">
                  {p.marketValueMinor !== null ? <MoneyText minor={p.marketValueMinor} currency={inv.currency} className="block text-sm" /> : <span className="text-xs text-ink-dim">{t('investments.noPrice')}</span>}
                  {p.unrealizedMinor !== null && inv.quantityMicro > 0 && (
                    <span className={`block text-[11px] font-semibold ${p.unrealizedMinor >= 0 ? 'text-income' : 'text-expense'}`} dir="ltr">
                      {p.unrealizedMinor >= 0 ? '+' : ''}{p.unrealizedPct ?? 0}%
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </Card>
      )}

      {/* detail */}
      <Sheet open={current !== null} onClose={() => setDetail(null)} title={current?.name ?? ''}>
        {current && <InvestmentDetail inv={current} onTrade={(kind) => { setError(''); setTrade({ inv: current, kind }); }} onDelete={() => setToDelete(current)} error={error} setError={(e) => setError(friendly(e))} />}
      </Sheet>

      {/* trade */}
      <Sheet open={trade !== null} onClose={() => setTrade(null)} title={trade ? t(`investments.${trade.kind}`) : ''}>
        {trade && (
          <TradeForm
            inv={trade.inv}
            kind={trade.kind}
            accounts={accounts.filter((a) => a.currency === trade.inv.currency)}
            error={error}
            onSubmit={async (v) => {
              setError('');
              try {
                if (trade.kind === 'valuation') await recordValuation(trade.inv.id, v.priceMinor, v.date);
                else if (trade.kind === 'buy') await buyInvestment(trade.inv.id, v);
                else await sellInvestment(trade.inv.id, v);
                setTrade(null);
              } catch (e) {
                setError(friendly(e));
              }
            }}
          />
        )}
      </Sheet>

      {/* add */}
      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title={t('investments.addTitle')}>
        <AddInvestment
          accounts={accounts}
          error={error}
          onSubmit={async (v) => {
            if (!profileId) return;
            setError('');
            try {
              await createInvestment({ ...v, profileId });
              setShowAdd(false);
            } catch (e) {
              setError(friendly(e));
            }
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={t('investments.deleteHint')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) void deleteInvestment(target.id).then(() => setDetail(null)).catch((e) => setError(friendly(e)));
        }}
      />
      {error && !detail && !trade && !showAdd && <p className="mt-3 rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
    </div>
  );
}

function InvestmentDetail({ inv, onTrade, onDelete, error, setError }: { inv: Investment; onTrade: (k: TradeKind) => void; onDelete: () => void; error: string; setError: (e: unknown) => void }) {
  const { t, i18n } = useTranslation();
  const calendar = useApp((s) => s.settings?.calendar ?? 'gregorian');
  const history = useInvestmentHistory(inv.id);
  const p = performance(inv);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-surface-2 p-2.5"><p className="text-xs text-ink-dim">{t('investments.quantity')}</p><p className="font-semibold" dir="ltr">{quantityToString(inv.quantityMicro)} {inv.unit}</p></div>
        <div className="rounded-2xl bg-surface-2 p-2.5"><p className="text-xs text-ink-dim">{t('investments.costBasis')}</p><MoneyText minor={p.costBasisMinor} currency={inv.currency} /></div>
        <div className="rounded-2xl bg-surface-2 p-2.5"><p className="text-xs text-ink-dim">{t('investments.marketValue')}</p>{p.marketValueMinor === null ? '—' : <MoneyText minor={p.marketValueMinor} currency={inv.currency} />}</div>
        <div className="rounded-2xl bg-surface-2 p-2.5"><p className="text-xs text-ink-dim">{t('investments.unrealized')}</p>{p.unrealizedMinor === null ? '—' : <MoneyText minor={p.unrealizedMinor} currency={inv.currency} kind={p.unrealizedMinor >= 0 ? 'income' : 'expense'} signed />}</div>
        <div className="col-span-2 rounded-2xl bg-surface-2 p-2.5"><p className="text-xs text-ink-dim">{t('investments.realized')}</p><MoneyText minor={p.realizedMinor} currency={inv.currency} kind={p.realizedMinor >= 0 ? 'income' : 'expense'} signed /></div>
      </div>
      <p className="text-xs text-ink-dim">
        {inv.lastPriceMinor !== null && inv.lastPriceDate
          ? t('investments.lastPrice', { price: formatMoney(inv.lastPriceMinor, inv.currency, i18n.language), date: formatDate(inv.lastPriceDate, i18n.language, calendar) })
          : t('investments.noPrice')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="soft" onClick={() => onTrade('buy')}>{t('investments.buy')}</Button>
        <Button variant="soft" onClick={() => onTrade('sell')} disabled={inv.quantityMicro <= 0}>{t('investments.sell')}</Button>
        <Button variant="ghost" onClick={() => onTrade('valuation')}>{t('investments.valuation')}</Button>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-ink-dim">{t('attachments.title')}</p>
        <div className="mb-3"><AttachmentList ownerType="investment" ownerId={inv.id} /></div>
        <p className="mb-1 text-xs font-semibold text-ink-dim">{t('investments.history')}</p>
        <Card className="max-h-64 overflow-y-auto px-2">
          {history.map((h) => (
            <div key={h.id} className="flex items-center gap-2 py-2 text-xs">
              <span className="w-20 shrink-0 text-ink-dim">{formatDate(h.date, i18n.language, calendar)}</span>
              <span className="flex-1">
                {t(`investments.kinds.${h.kind}`)}
                {h.kind !== 'valuation' && <span dir="ltr"> · {quantityToString(h.quantityMicro)}</span>}
                <span className="text-ink-dim"> @ {formatMoney(h.priceMinor, inv.currency, i18n.language)}</span>
                {h.kind === 'sell' && <span className={h.realizedMinor >= 0 ? 'text-income' : 'text-expense'} dir="ltr"> ({h.realizedMinor >= 0 ? '+' : ''}{formatMoney(h.realizedMinor, inv.currency, i18n.language)})</span>}
              </span>
              <button className="p-1 text-ink-dim" aria-label={t('common.delete')} onClick={() => void deleteInvestmentTxn(h.id).catch(setError)}><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      </div>
      {error && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error}</p>}
      <Button variant="danger" className="w-full" onClick={onDelete}>{t('common.delete')}</Button>
    </div>
  );
}

interface TradeValues { quantityMicro: number; priceMinor: number; feesMinor: number; date: string; accountId: string | null }

function TradeForm({ inv, kind, accounts, error, onSubmit }: { inv: Investment; kind: TradeKind; accounts: { id: string; name: string }[]; error: string; onSubmit: (v: TradeValues) => Promise<void> }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  const [local, setLocal] = useState('');
  async function submit() {
    setLocal('');
    try {
      await onSubmit({
        quantityMicro: kind === 'valuation' ? 0 : toQuantityMicro(qty),
        priceMinor: toMinor(price, inv.currency),
        feesMinor: fees ? toMinor(fees, inv.currency) : 0,
        date,
        accountId: accountId || null,
      });
    } catch (e) {
      setLocal(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="space-y-3">
      {kind !== 'valuation' && (
        <Field label={`${t('investments.quantity')}${inv.unit ? ` (${inv.unit})` : ''}`}>
          <TextInput dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t('investments.price')} (${inv.currency})`}><TextInput dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" /></Field>
        <Field label={t('common.date')}><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {kind !== 'valuation' && (
        <>
          <Field label={t('investments.fees')}><TextInput dir="ltr" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" /></Field>
          <Field label={t('investments.throughAccount')} hint={t('investments.accountHint')}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{t('investments.noAccount')}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        </>
      )}
      {(error || local) && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error || local}</p>}
      <Button className="w-full" onClick={() => void submit()} disabled={!price || (kind !== 'valuation' && !qty)}>{t('common.save')}</Button>
    </div>
  );
}

function AddInvestment({ accounts, error, onSubmit }: {
  accounts: { id: string; name: string; currency: CurrencyCode }[];
  error: string;
  onSubmit: (v: { name: string; type: InvestmentType; currency: CurrencyCode; unit: string; initialBuy: { quantityMicro: number; priceMinor: number; feesMinor: number; date: string; accountId: string | null } | null }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState<InvestmentType>('stock');
  const [currency, setCurrency] = useState<CurrencyCode>('YER');
  const [unit, setUnit] = useState('');
  const [withBuy, setWithBuy] = useState<'yes' | 'no'>('yes');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  const [local, setLocal] = useState('');
  async function submit() {
    setLocal('');
    try {
      await onSubmit({
        name, type, currency, unit,
        initialBuy: withBuy === 'yes'
          ? { quantityMicro: toQuantityMicro(qty), priceMinor: toMinor(price, currency), feesMinor: fees ? toMinor(fees, currency) : 0, date, accountId: accountId || null }
          : null,
      });
    } catch (e) {
      setLocal(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="space-y-3">
      <Field label={t('common.name')}><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('txn.type')}>
          <Select value={type} onChange={(e) => setType(e.target.value as InvestmentType)}>{TYPES.map((ty) => <option key={ty} value={ty}>{t(`investments.types.${ty}`)}</option>)}</Select>
        </Field>
        <Field label={t('common.currency')}>
          <Select value={currency} onChange={(e) => { setCurrency(e.target.value as CurrencyCode); setAccountId(''); }}>{CURRENCY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
      </div>
      <Field label={t('investments.unit')}><TextInput value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
      <Segmented options={[{ value: 'yes' as const, label: t('investments.buy') }, { value: 'no' as const, label: t('common.none') }]} value={withBuy} onChange={setWithBuy} />
      {withBuy === 'yes' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('investments.quantity')}><TextInput dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" /></Field>
            <Field label={t('investments.price')}><TextInput dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('investments.fees')}><TextInput dir="ltr" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" /></Field>
            <Field label={t('common.date')}><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label={t('investments.throughAccount')} hint={t('investments.accountHint')}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{t('investments.noAccount')}</option>
              {accounts.filter((a) => a.currency === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        </>
      )}
      {(error || local) && <p className="rounded-2xl bg-expense-soft px-3 py-2 text-sm text-expense">{error || local}</p>}
      <Button className="w-full" onClick={() => void submit()} disabled={!name.trim() || (withBuy === 'yes' && (!qty || !price))}>{t('common.save')}</Button>
    </div>
  );
}
