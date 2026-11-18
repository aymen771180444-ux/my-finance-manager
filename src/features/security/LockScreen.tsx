import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Fingerprint, Delete } from 'lucide-react';
import { useLock } from '../../store/lock';
import { getVault, unlockWithPin, unlockWithRecovery, unlockWithPrf } from '../../db/security';
import { biometricSecret } from '../../lib/biometric';
import type { Vault } from '../../db/types';

/** Full-screen lock. The app stays mounted underneath, so unsaved form state survives. */
export function LockScreen() {
  const { t, i18n } = useTranslation();
  const unlocked = useLock((s) => s.unlocked);
  const [vault, setVault] = useState<Vault | null>(null);
  const [mode, setMode] = useState<'pin' | 'recovery'>('pin');
  const [pin, setPin] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getVault().then((v) => setVault(v ?? null));
  }, []);

  function explain(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e);
    if (m.startsWith('LOCKED_OUT:')) {
      const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(new Date(m.slice(11)));
      return t('lock.lockedOut', { time });
    }
    if (m.startsWith('WRONG_SECRET:')) return t('lock.wrongPin', { left: Math.max(0, parseInt(m.slice(13), 10)) });
    return t('common.error');
  }

  async function tryPin(value: string) {
    setBusy(true);
    setError('');
    try {
      await unlockWithPin(value);
      unlocked();
    } catch (e) {
      setError(explain(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  async function tryRecovery() {
    setBusy(true);
    setError('');
    try {
      await unlockWithRecovery(recovery);
      unlocked();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  async function tryBiometric() {
    if (!vault?.biometric) return;
    setError('');
    try {
      await unlockWithPrf(await biometricSecret(vault.biometric.credentialId, vault.biometric.prfSalt));
      unlocked();
    } catch {
      setError(t('lock.biometricFailed'));
    }
  }

  // offer fingerprint straight away when enrolled
  useEffect(() => {
    if (vault?.biometric) void tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.biometric?.credentialId]);

  function press(d: string) {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
    if (vault && next.length === vault.pinLength) void tryPin(next);
  }

  return (
    <div className="bg-blobs fixed inset-0 z-[100] flex flex-col items-center justify-center px-6" role="dialog" aria-modal aria-label={t('lock.title')}>
      <div className="glow mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-on-primary"><Lock size={26} /></div>
      <h1 className="mb-1 text-lg font-bold">{t('app.name')}</h1>
      <p className="mb-5 text-sm text-ink-dim">{mode === 'pin' ? t('lock.enterPin') : t('lock.useRecovery')}</p>

      {mode === 'pin' ? (
        <>
          <div className="mb-6 flex gap-3" dir="ltr" aria-live="polite">
            {Array.from({ length: vault?.pinLength ?? 4 }, (_, i) => (
              <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? 'bg-primary' : 'border-2 border-line'}`} />
            ))}
          </div>
          <div className="grid w-full max-w-xs grid-cols-3 gap-3" dir="ltr">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)} className="h-16 rounded-2xl bg-surface text-2xl font-semibold shadow-sm active:bg-surface-2" aria-label={d}>{d}</button>
            ))}
            {vault?.biometric ? (
              <button onClick={() => void tryBiometric()} className="flex h-16 items-center justify-center rounded-2xl text-primary active:bg-surface-2" aria-label={t('lock.useBiometric')}>
                <Fingerprint size={28} />
              </button>
            ) : (
              <span />
            )}
            <button onClick={() => press('0')} className="h-16 rounded-2xl bg-surface text-2xl font-semibold shadow-sm active:bg-surface-2" aria-label="0">0</button>
            <button onClick={() => setPin(pin.slice(0, -1))} className="flex h-16 items-center justify-center rounded-2xl text-ink-dim active:bg-surface-2" aria-label={t('common.delete')}>
              <Delete size={24} />
            </button>
          </div>
        </>
      ) : (
        <div className="w-full max-w-xs space-y-3">
          <input
            type="password"
            autoFocus
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void tryRecovery()}
            placeholder={t('lock.recoveryPlaceholder')}
            className="w-full rounded-2xl border border-line bg-surface px-3 py-3 text-ink outline-none focus:border-primary"
          />
          <button onClick={() => void tryRecovery()} disabled={busy || !recovery} className="w-full rounded-2xl bg-primary py-3 font-semibold text-on-primary disabled:opacity-40">
            {t('lock.unlock')}
          </button>
        </div>
      )}

      {error && <p className="mt-4 max-w-xs text-center text-sm text-expense" role="alert">{error}</p>}
      {busy && <p className="mt-4 text-xs text-ink-dim">{t('security.working')}</p>}
      <button className="mt-6 text-sm font-medium text-primary" onClick={() => { setMode(mode === 'pin' ? 'recovery' : 'pin'); setError(''); }}>
        {mode === 'pin' ? t('lock.useRecovery') : t('lock.usePin')}
      </button>
    </div>
  );
}
