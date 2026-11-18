/**
 * Remote file storage used by sync. Production: the user's Google Drive
 * "appDataFolder" (hidden, app-private). Tests: an in-memory store shared by
 * simulated devices.
 */
export interface RemoteFile {
  id: string;
  name: string;
}

export interface RemoteStore {
  list(): Promise<RemoteFile[]>;
  read(id: string): Promise<Uint8Array>;
  /** Create a file (or replace the content of `existingId`). */
  write(name: string, bytes: Uint8Array, existingId?: string): Promise<RemoteFile>;
  remove(id: string): Promise<void>;
}

export class MemoryStore implements RemoteStore {
  files = new Map<string, { name: string; bytes: Uint8Array }>();
  private seq = 0;
  /** Set to make the next call fail (simulated network error). */
  failNext: string | null = null;

  private check() {
    if (this.failNext) {
      const m = this.failNext;
      this.failNext = null;
      throw new Error(m);
    }
  }
  async list() {
    this.check();
    return [...this.files.entries()].map(([id, f]) => ({ id, name: f.name }));
  }
  async read(id: string) {
    this.check();
    const f = this.files.get(id);
    if (!f) throw new Error('NOT_FOUND');
    return f.bytes.slice();
  }
  async write(name: string, bytes: Uint8Array, existingId?: string) {
    this.check();
    const id = existingId ?? `f${++this.seq}`;
    this.files.set(id, { name, bytes: bytes.slice() });
    return { id, name };
  }
  async remove(id: string) {
    this.check();
    this.files.delete(id);
  }
}
