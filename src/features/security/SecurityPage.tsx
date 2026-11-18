import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, ShieldCheck, ShieldOff, Fingerprint, Lock } from 'lucide-react';
import { Card, Button, Field, TextInput, Select, ConfirmDialog } from '../../components/ui';
import { useLock } from '../../store/lock';
import { getDek } from '../../db/keyring';
import {
  getVault, enableLock, changePin, changeRecovery, disableLock, setAutoLockMinutes, enrollBiometric, removeBiometric,
  validatePin, validateRecovery,
} from '../../db/security';
import { biometricSupport, enrollPlatformCredential } from '../../lib/biometric';

function PinInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={props.label}>
      <TextInput type="password" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={8} value={props.value}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ''))} />
    </Field>
  );
}

export default function SecurityPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;
  // null = no vault; undefined = still loading (useLiveQuery returns undefined for both otherwise)
  const vault = useLiveQuery(async () => (await getVault()) ?? null, []);
  const { refresh, lock } = useLock();
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [rec, setRec] = useState('');
  const [rec2, setRec2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [bio, setBio] = useState<Awaited<ReturnType<typeof biometricSupport>> | null>(null);

  useEffect(() => {
    void biometricSupport().then(setBio);
  }, []);

  const reset = () => { setPin(''); setPin2(''); setRec(''); setRec2(''); };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await refresh();
      setMsg({ ok: true, text: t('security.saved') });
      reset();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, text: m === 'NO_PRF' ? t('security.bioNoPrf') : m === 'INVALID_PIN' ? t('security.invalidPin') : m === 'INVALID_RECOVERY' ? t('security.invalidRecovery') : t('common.error') });
    } finally {
      setBusy(false);
    }
  }

  function needDek(): CryptoKey {
    const dek = getDek();
    if (!dek) {
      lock();
      throw new Error('APP_LOCKED');
    }
    return dek;
  }

  const enableError =
    pin && !validatePin(pin) ? t('security.invalidPin')
    : pin2 && pin !== pin2 ? t('security.pinMismatch')
    : rec && !validateRecovery(rec) ? t('security.invalidRecovery')
    : rec2 && rec !== rec2 ? t('security.recoveryMismatch') : '';

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}><Back size={20} /></button>
        <h1 className="text-xl font-bold">{t('security.title')}</h1>
      </div>

      <Card className="mb-3 flex items-center gap-3 p-4">
        {vault ? <ShieldCheck className="text-income" /> : <ShieldOff className="text-ink-dim" />}
        <div className="flex-1">
          <p className="font-semibold">{vault ? t('security.enabled') : t('security.disabled')}</p>
          {!vault && <p className="text-xs text-ink-dim">{t('security.intro')}</p>}
        </div>
        {vault && <Button variant="ghost" onClick={lock}><span className="inline-flex items-center gap-1"><Lock size={14} /> {t('lock.lockNow')}</span></Button>}
      </Card>

      {msg && <p className={`mb-3 rounded-2xl px-3 py-2 text-sm ${msg.ok ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`} role="status">{msg.text}</p>}

      {vault === undefined ? null : !vault ? (
        <Card className="space-y-3 p-4">
          <PinInput label={t('security.pin')} value={pin} onChange={setPin} />
          <PinInput label={t('security.pinConfirm')} value={pin2} onChange={setPin2} />
          <Field label={t('security.recovery')}><TextInput type="password" autoComplete="new-password" value={rec} onChange={(e) => setRec(e.target.value)} /></Field>
          <Field label={t('security.recoveryConfirm')}><TextInput type="password" autoComplete="new-password" value={rec2} onChange={(e) => setRec2(e.target.value)} /></Field>
          <p className="rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{t('security.recoveryWarning')}</p>
          {enableError && <p className="text-xs text-expense">{enableError}</p>}
          <Button className="w-full" disabled={busy || !!enableError || !pin || pin !== pin2 || !rec || rec !== rec2} onClick={() => void run(async () => { await enableLock(pin, rec); useLock.getState().unlocked(); })}>
            {busy ? t('security.working') : t('security.enable')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          <Card className="space-y-2 p-4">
            <Field label={t('security.autoLock')}>
              <Select value={vault.autoLockMinutes} onChange={(e) => void run(() => setAutoLockMinutes(Number(e.target.value)))}>
                {[1, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{t('security.minutes', { n })}</option>)}
              </Select>
            </Field>
            <p className="text-xs text-ink-dim">{t('security.lockOnLeave')}</p>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Fingerprint size={16} /> {t('security.biometric')}</h2>
            {vault.biometric ? (
              <>
                <p className="text-xs text-income">{t('security.biometricOn')}</p>
                <Button variant="ghost" onClick={() => void run(removeBiometric)}>{t('security.disableBiometric')}</Button>
              </>
            ) : bio === 'supported' ? (
              <Button variant="soft" disabled={busy} onClick={() => void run(async () => {
                const dek = needDek();
                const r = await enrollPlatformCredential();
                await enrollBiometric(dek, r.credentialId, r.prfSalt, r.prfOutput);
              })}>
                {t('security.enableBiometric')}
              </Button>
            ) : (
              <p className="text-xs text-ink-dim">{bio === 'no-prf' ? t('security.bioNoPrf') : t('security.bioUnsupported')}</p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('security.changePin')}</h2>
            <PinInput label={t('security.newPin')} value={pin} onChange={setPin} />
            <PinInput label={t('security.pinConfirm')} value={pin2} onChange={setPin2} />
            <Button variant="soft" disabled={busy || !validatePin(pin) || pin !== pin2} onClick={() => void run(() => changePin(needDek(), pin))}>{t('common.save')}</Button>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('security.changeRecovery')}</h2>
            <Field label={t('security.newRecovery')}><TextInput type="password" autoComplete="new-password" value={rec} onChange={(e) => setRec(e.target.value)} /></Field>
            <Field label={t('security.recoveryConfirm')}><TextInput type="password" autoComplete="new-password" value={rec2} onChange={(e) => setRec2(e.target.value)} /></Field>
            <Button variant="soft" disabled={busy || !validateRecovery(rec) || rec !== rec2} onClick={() => void run(() => changeRecovery(needDek(), rec))}>{t('common.save')}</Button>
          </Card>

          <Button variant="danger" className="w-full" onClick={() => setConfirmOff(true)}>{t('security.turnOff')}</Button>
        </div>
      )}

      <p className="mt-4 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-dim">{t('security.dbNote')}</p>

      <ConfirmDialog
        open={confirmOff}
        title={t('security.turnOff')}
        body={t('security.turnOffBody')}
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => {
          setConfirmOff(false);
          void run(() => disableLock(needDek()));
        }}
      />
    </div>
  );
}
