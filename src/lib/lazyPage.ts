import { lazy, type ComponentType } from 'react';

const FLAG = 'mfm-chunk-reload';

/** A screen file that no longer exists on the server: the app on screen is older than the one published. */
export const isStaleChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(e instanceof Error ? e.message : String(e));

/**
 * `React.lazy` with a safety net: if a screen's file can't be fetched because
 * a newer version was published meanwhile, reload once to pick up the new
 * version instead of leaving the user on an error or an endless spinner.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same constraint as React.lazy
export function lazyPage<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().then(
      (m) => {
        try {
          sessionStorage.removeItem(FLAG);
        } catch {
          /* storage may be unavailable */
        }
        return m;
      },
      (e: unknown) => {
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(FLAG) === '1';
          if (isStaleChunkError(e) && !reloaded) sessionStorage.setItem(FLAG, '1');
        } catch {
          reloaded = true; // can't remember the attempt: don't risk a reload loop
        }
        if (isStaleChunkError(e) && !reloaded) {
          window.location.reload();
          return new Promise<{ default: T }>(() => undefined); // keep the spinner until the reload
        }
        throw e;
      },
    ),
  );
}
