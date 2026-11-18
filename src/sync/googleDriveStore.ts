/**
 * RemoteStore backed by the Google Drive v3 REST API, restricted to the
 * hidden per-app "appDataFolder" (scope drive.appdata). Plain fetch — no SDK.
 */
import type { RemoteFile, RemoteStore } from './store';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class DriveStore implements RemoteStore {
  /** `getToken` throws SYNC_AUTH_NEEDED when there is no valid token. */
  constructor(private getToken: () => string) {}

  private async call(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    let r: Response;
    try {
      r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.getToken()}` } });
    } catch (e) {
      if (e instanceof Error && e.message === 'SYNC_AUTH_NEEDED') throw e;
      throw new Error(navigator.onLine === false ? 'SYNC_OFFLINE' : 'SYNC_NETWORK');
    }
    if (r.ok || (r.status === 404 && init.method === 'DELETE')) return r;
    if (r.status === 401) throw new Error('SYNC_AUTH_NEEDED');
    // rate limits and server hiccups: retry with backoff (Google's guidance)
    const body = r.status === 403 ? await r.text().catch(() => '') : '';
    const retryable = r.status === 429 || r.status >= 500 || /rateLimit/i.test(body);
    if (retryable && attempt < 3) {
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt + Math.random() * 500));
      return this.call(url, init, attempt + 1);
    }
    if (/storageQuota/i.test(body)) throw new Error('SYNC_DRIVE_FULL');
    if (r.status === 403) throw new Error('SYNC_FORBIDDEN');
    throw new Error(`SYNC_HTTP_${r.status}`);
  }

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    let page = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
      if (page) q.set('pageToken', page);
      const j = (await (await this.call(`${API}?${q}`)).json()) as { files: RemoteFile[]; nextPageToken?: string };
      out.push(...j.files);
      page = j.nextPageToken ?? '';
    } while (page);
    return out;
  }

  async read(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.call(`${API}/${encodeURIComponent(id)}?alt=media`)).arrayBuffer());
  }

  async write(name: string, bytes: Uint8Array, existingId?: string): Promise<RemoteFile> {
    const content = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    if (existingId) {
      await this.call(`${UPLOAD}/${encodeURIComponent(existingId)}?uploadType=media`, { method: 'PATCH', body: content });
      return { id: existingId, name };
    }
    const boundary = `mfm${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ]);
    const r = await this.call(`${UPLOAD}?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await r.json()) as RemoteFile;
  }

  async remove(id: string): Promise<void> {
    await this.call(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
