import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronUp, ChevronDown, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { Card, Button } from '../../components/ui';
import { useApp } from '../../store/app';
import { mergeLayout, moveCard, DEFAULT_LAYOUT, type CardPref } from './cardRegistry';

export default function DashboardCustomizePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { settings, setDashboardCards } = useApp();
  const layout = mergeLayout(settings?.dashboardCards);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  const save = (next: CardPref[]) => void setDashboardCards(next);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="text-xl font-bold">{t('cards.customize')}</h1>
      </div>
      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('cards.hint')}</p>
      <Card className="px-2">
        {layout.map((p, i) => (
          <div key={p.id} className={`flex items-center gap-2 px-2 py-2 ${p.visible ? '' : 'opacity-50'}`}>
            <span className="flex-1 text-sm font-medium">{t(`cards.names.${p.id}`)}</span>
            <button className="rounded-lg p-2 text-ink-dim disabled:opacity-30" disabled={i === 0} onClick={() => save(moveCard(layout, i, -1))} aria-label={t('cards.moveUp')}><ChevronUp size={18} /></button>
            <button className="rounded-lg p-2 text-ink-dim disabled:opacity-30" disabled={i === layout.length - 1} onClick={() => save(moveCard(layout, i, 1))} aria-label={t('cards.moveDown')}><ChevronDown size={18} /></button>
            <button
              className={`rounded-lg p-2 ${p.visible ? 'text-primary' : 'text-ink-dim'}`}
              onClick={() => save(layout.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)))}
              aria-label={t(`cards.names.${p.id}`)}
              aria-pressed={p.visible}
            >
              {p.visible ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        ))}
      </Card>
      <Button variant="ghost" className="mt-3 w-full" onClick={() => save(DEFAULT_LAYOUT)}>
        <span className="inline-flex items-center gap-1"><RotateCcw size={14} /> {t('cards.restore')}</span>
      </Button>
    </div>
  );
}
