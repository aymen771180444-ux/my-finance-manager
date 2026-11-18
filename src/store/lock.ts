import { create } from 'zustand';
import { getVault } from '../db/security';
import { setDek } from '../db/keyring';

interface LockState {
  status: 'checking' | 'open' | 'locked';
  vaultEnabled: boolean;
  autoLockMinutes: number;
  /** Leaving the app before this time does not lock (e.g. camera/file picker). */
  graceUntil: number;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  unlocked: () => void;
  lock: () => void;
  allowBackground: (ms: number) => void;
}

export const useLock = create<LockState>((set, get) => ({
  status: 'checking',
  vaultEnabled: false,
  autoLockMinutes: 10,
  graceUntil: 0,
  init: async () => {
    const v = await getVault();
    set({ vaultEnabled: !!v, autoLockMinutes: v?.autoLockMinutes ?? 10, status: v ? 'locked' : 'open' });
  },
  refresh: async () => {
    const v = await getVault();
    set({ vaultEnabled: !!v, autoLockMinutes: v?.autoLockMinutes ?? 10 });
  },
  unlocked: () => set({ status: 'open' }),
  lock: () => {
    if (!get().vaultEnabled) return;
    setDek(null); // the data key leaves memory
    set({ status: 'locked' });
  },
  allowBackground: (ms) => set({ graceUntil: Date.now() + ms }),
}));
