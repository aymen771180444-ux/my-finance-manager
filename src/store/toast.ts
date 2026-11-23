import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
interface ToastState {
  current: Toast | null;
  show: (text: string, kind?: ToastKind) => void;
  dismiss: () => void;
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** One pop-up at a time (a newer one replaces it), like iOS banners. */
export const useToast = create<ToastState>((set) => ({
  current: null,
  show: (text, kind = 'success') => {
    clearTimeout(timer);
    set({ current: { id: ++seq, kind, text } });
    // a light tap of the vibration motor confirms the action without looking (Android)
    try {
      if (kind === 'success') navigator.vibrate?.(12);
      else if (kind === 'error') navigator.vibrate?.([20, 60, 20]);
    } catch {
      /* vibration is optional */
    }
    timer = setTimeout(() => set({ current: null }), kind === 'error' ? 4000 : 2400);
  },
  dismiss: () => {
    clearTimeout(timer);
    set({ current: null });
  },
}));

/** Show a pop-up from anywhere. */
export const toast = (text: string, kind?: ToastKind) => useToast.getState().show(text, kind);
