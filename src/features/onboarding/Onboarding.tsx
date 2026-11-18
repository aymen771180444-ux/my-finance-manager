import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet2 } from 'lucide-react';
import { Button, Card, Field, TextInput, Segmented } from '../../components/ui';
import { applyLanguage, type AppLanguage } from '../../i18n';
import { createProfile } from '../../db/profiles';
import { useApp } from '../../store/app';

export default function Onboarding() {
  const { t } = useTranslation();
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const [lang, setLang] = useState<AppLanguage>('ar');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const profile = await createProfile(name.trim() || t('onboarding.profilePlaceholder'));
      await completeOnboarding({ language: lang, profileId: profile.id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="glow mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-primary text-on-primary">
          <Wallet2 size={32} />
        </div>
        <h1 className="text-3xl font-bold">{t('onboarding.welcome')}</h1>
        <p className="mt-2 text-sm text-ink-dim">{t('onboarding.intro')}</p>
      </div>
      <Card className="p-5">
        <div className="space-y-4">
          <Field label={t('onboarding.chooseLanguage')}>
            <Segmented
              options={[
                { value: 'ar' as const, label: 'العربية' },
                { value: 'en' as const, label: 'English' },
              ]}
              value={lang}
              onChange={(v) => {
                setLang(v);
                applyLanguage(v);
              }}
            />
          </Field>
          <Field label={t('onboarding.profileName')}>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('onboarding.profilePlaceholder')}
            />
          </Field>
          <Button className="w-full" onClick={() => void start()} disabled={busy}>
            {t('onboarding.start')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
