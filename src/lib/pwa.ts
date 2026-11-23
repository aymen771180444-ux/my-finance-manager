import { create } from 'zustand';
import { isNativeApp } from './platform';

/**
 * Offline worker (service worker) with controlled updates.
 *
 * A new version downloads in the background but does not take over while the
 * app is open, because the running app still needs its own screen files.
 * Swapping underneath it caused "Failed to fetch dynamically imported module"
 * errors and endless loading. Instead:
 *  - an update that is already waiting when the app opens is applied at once
 *    (one quick reload, before the user has started anything);
 *  - an update that arrives later shows a banner; tapping it reloads into the new version.
 */
interface UpdateState {
  ready: boolean;
  apply: () => void;
}
export const useAppUpdate = create<UpdateState>(() => ({ ready: false, apply: () => undefined }));

const HOUR = 60 * 60 * 1000;

export function setupServiceWorker(): void {
  if (import.meta.env.DEV || isNativeApp() || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const openedAt = Date.now();

  const offer = (reg: ServiceWorkerRegistration) => {
    const apply = () => {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    };
    // found while the app is just opening: switch immediately
    if (Date.now() - openedAt < 4000) return apply();
    useAppUpdate.setState({ ready: true, apply });
  };

  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      // only an *update* needs offering; the very first install just starts caching
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(reg);
        });
      });
      // look for a new version now and then while the app stays open (a blocked network just fails quietly)
      setInterval(() => void reg.update().catch(() => undefined), HOUR);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    } catch {
      /* no offline support in this browser: the app still works online */
    }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}
