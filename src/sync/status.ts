/** Live sync status for the UI — tiny on purpose: the banner imports it on every screen, the sync engine loads lazily. */
import { create } from 'zustand';

export type SyncPhase = 'idle' | 'syncing' | 'needsAuth' | 'needsPassword' | 'error';

interface SyncUi {
  phase: SyncPhase;
  lastResult: { pulled: number; pushed: number; conflicts: number } | null;
  error: string | null;
}
export const useSync = create<SyncUi>(() => ({ phase: 'idle', lastResult: null, error: null }));
