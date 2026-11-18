/**
 * Google sign-in for Drive sync, using Google Identity Services (token model).
 *
 * - Scope `drive.appdata` only: the app can see nothing in the user's Drive
 *   except its own hidden folder.
 * - The OAuth *client ID* (VITE_GOOGLE_CLIENT_ID) is public by design; there
 *   is no client secret anywhere in the app.
 * - Access tokens live in memory for about an hour. There is no refresh token
 *   in a browser app, so after expiry the user taps "Reconnect".
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';
export const googleConfigured = () => GOOGLE_CLIENT_ID.length > 0;

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; login_hint?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let gis: Promise<GoogleOAuth2> | null = null;

function loadGis(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error('GOOGLE_LOAD_FAILED')));
    s.onerror = () => {
      gis = null;
      s.remove();
      reject(new Error('GOOGLE_LOAD_FAILED'));
    };
    document.head.appendChild(s);
  });
  return gis;
}

let token: { value: string; expiresAt: number } | null = null;

/** A token valid for at least another minute, or null. */
export function currentToken(): string | null {
  return token && token.expiresAt - 60_000 > Date.now() ? token.value : null;
}

export function clearToken(): void {
  token = null;
}

/**
 * Ask Google for an access token. Must run from a tap (Google opens a popup).
 * `selectAccount` shows the account chooser; otherwise a known account is reused.
 */
export async function requestToken(opts: { hint?: string | null; selectAccount?: boolean } = {}): Promise<string> {
  if (!googleConfigured()) throw new Error('GOOGLE_NOT_CONFIGURED');
  const oauth2 = await loadGis();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error === 'access_denied' ? 'GOOGLE_DENIED' : 'GOOGLE_AUTH_FAILED'));
        // the consent screen lets people untick the Drive permission
        if (!oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) return reject(new Error('GOOGLE_SCOPE_MISSING'));
        token = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e.type === 'popup_failed_to_open' ? 'GOOGLE_POPUP_BLOCKED' : 'GOOGLE_POPUP_CLOSED')),
    });
    client.requestAccessToken({ prompt: opts.selectAccount ? 'select_account' : '', login_hint: opts.hint ?? undefined });
  });
}

/** The signed-in Google account's email (shown so the user knows which Drive holds the data). */
export async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return null;
    return ((await r.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** Withdraw the app's Drive permission for this browser session's token. */
export async function revokeToken(): Promise<void> {
  const t = token?.value;
  token = null;
  if (!t || !window.google?.accounts?.oauth2) return;
  await new Promise<void>((done) => window.google!.accounts!.oauth2!.revoke(t, done));
}

/** Load Google's script ahead of the tap, so the popup opens within the tap's activation window. */
export function preloadGoogle(): void {
  if (googleConfigured()) void loadGis().catch(() => undefined);
}
