import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.randomUUID) {
  // @ts-expect-error node polyfill
  globalThis.crypto = webcrypto;
}
