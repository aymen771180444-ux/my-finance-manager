import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Check } from 'lucide-react';
import { useProfiles } from '../../hooks/data';
import { Card, Button, Sheet, Field, TextInput } from '../../components/ui';
import { createProfile } from '../../db/profiles';
import { useApp } from '../../store/app';

export default function ProfilesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const { settings, setActiveProfile } = useApp();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('profiles.title')}</h1>
        <Button variant="soft" onClick={() => setShowAdd(true)}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>
      <p className="mb-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('profiles.hint')}</p>

      <Card className="px-2">
        {profiles.map((p) => {
          const active = settings?.activeProfileId === p.id;
          return (
            <div key={p.id} className="flex items-center gap-3 px-2 py-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full text-lg" style={{ backgroundColor: `${p.color}22` }}>
                {p.icon}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{p.name}</span>
                {active && <span className="block text-xs text-primary">{t('profiles.activeProfile')}</span>}
              </span>
              {active ? (
                <Check size={18} className="text-primary" />
              ) : (
                <Button variant="ghost" onClick={() => void setActiveProfile(p.id)}>
                  {t('profiles.switchTo')}
                </Button>
              )}
            </div>
          );
        })}
      </Card>

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title={t('profiles.addTitle')}>
        <div className="space-y-4">
          <Field label={t('common.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            className="w-full"
            onClick={() => {
              void createProfile(name).then((p) => setActiveProfile(p.id));
              setShowAdd(false);
              setName('');
            }}
            disabled={!name.trim()}
          >
            {t('common.save')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
