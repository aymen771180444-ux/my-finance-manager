import { create } from 'zustand';
import type { Transaction } from '../db/types';

/** Global state for the add/edit transaction sheet (opened by the FAB everywhere). */
interface TxnSheetState {
  open: boolean;
  editing: Transaction | null;
  presetAccountId: string | null;
  openNew: (presetAccountId?: string) => void;
  openEdit: (txn: Transaction) => void;
  close: () => void;
}

export const useTxnSheet = create<TxnSheetState>((set) => ({
  open: false,
  editing: null,
  presetAccountId: null,
  openNew: (presetAccountId) => set({ open: true, editing: null, presetAccountId: presetAccountId ?? null }),
  openEdit: (txn) => set({ open: true, editing: txn, presetAccountId: null }),
  close: () => set({ open: false, editing: null, presetAccountId: null }),
}));
