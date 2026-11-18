import { describe, it, expect, vi, afterEach } from 'vitest';
import { DriveStore } from './googleDriveStore';

type Call = { url: string; init: RequestInit };
function mockFetch(responses: Response[]) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift()!;
  }));
  return calls;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

afterEach(() => vi.unstubAllGlobals());

describe('Google Drive store', () => {
  it('lists only the hidden app folder, following pages', async () => {
    const calls = mockFetch([json({ files: [{ id: '1', name: 'a' }], nextPageToken: 'p2' }), json({ files: [{ id: '2', name: 'b' }] })]);
    const files = await new DriveStore(() => 'tok').list();
    expect(files.map((f) => f.id)).toEqual(['1', '2']);
    expect(calls[0].url).toContain('spaces=appDataFolder');
    expect(calls[1].url).toContain('pageToken=p2');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('creates files inside appDataFolder with a multipart upload', async () => {
    const calls = mockFetch([json({ id: 'new', name: 'mfm-x.enc' })]);
    const f = await new DriveStore(() => 'tok').write('mfm-x.enc', new Uint8Array([1, 2, 3]));
    expect(f.id).toBe('new');
    expect(calls[0].url).toContain('uploadType=multipart');
    const body = await (calls[0].init.body as Blob).text();
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('"name":"mfm-x.enc"');
  });

  it('an expired sign-in surfaces as SYNC_AUTH_NEEDED', async () => {
    mockFetch([new Response('', { status: 401 })]);
    await expect(new DriveStore(() => 'tok').read('1')).rejects.toThrow('SYNC_AUTH_NEEDED');
  });

  it('a full Drive is reported clearly', async () => {
    mockFetch([new Response('{"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}', { status: 403 })]);
    await expect(new DriveStore(() => 'tok').write('x', new Uint8Array([1]))).rejects.toThrow('SYNC_DRIVE_FULL');
  });

  it('deleting a file that is already gone is fine', async () => {
    mockFetch([new Response('', { status: 404 })]);
    await expect(new DriveStore(() => 'tok').remove('gone')).resolves.toBeUndefined();
  });
});
