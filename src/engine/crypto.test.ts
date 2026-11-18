import { describe, it, expect } from 'vitest';
import {
  deriveKey, generateDek, wrapDek, unwrapDek, encryptBytes, decryptBytes, randomBytes,
  toB64, fromB64, sha256Hex, utf8, fromUtf8, keyFromSecretBytes,
} from './crypto';

const FAST = 1_000; // iterations for tests only

describe('encoding', () => {
  it('base64 round-trips binary, including large buffers', () => {
    const b = randomBytes(100_000);
    expect(fromB64(toB64(b))).toEqual(b);
  });
  it('sha256 is stable', async () => {
    expect(await sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('DEK wrapping (PIN + recovery)', () => {
  it('the right secret unwraps; a wrong one fails authentication', async () => {
    const dek = await generateDek();
    const salt = randomBytes(16);
    const wrapped = await wrapDek(dek, await deriveKey('1234', salt, FAST));
    const again = await unwrapDek(wrapped, await deriveKey('1234', salt, FAST));
    const { iv, data } = await encryptBytes(dek, utf8('receipt'));
    expect(fromUtf8(await decryptBytes(again, iv, data))).toBe('receipt');
    await expect(unwrapDek(wrapped, await deriveKey('1235', salt, FAST))).rejects.toThrow();
  });
  it('the same DEK can be wrapped by two independent secrets', async () => {
    const dek = await generateDek();
    const s1 = randomBytes(16);
    const s2 = randomBytes(16);
    const byPin = await wrapDek(dek, await deriveKey('2468', s1, FAST));
    const byRecovery = await wrapDek(dek, await deriveKey('long recovery phrase', s2, FAST));
    const { iv, data } = await encryptBytes(dek, utf8('x'));
    for (const [w, secret, salt] of [[byPin, '2468', s1], [byRecovery, 'long recovery phrase', s2]] as const) {
      const k = await unwrapDek(w, await deriveKey(secret, salt, FAST));
      expect(fromUtf8(await decryptBytes(k, iv, data))).toBe('x');
    }
  });
  it('wrapped key material never contains the raw key', async () => {
    const dek = await generateDek();
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
    const w = await wrapDek(dek, await deriveKey('1234', randomBytes(16), FAST));
    expect(w.data).not.toContain(toB64(raw));
  });
  it('a PRF-style secret derives a wrapping key', async () => {
    const dek = await generateDek();
    const secret = randomBytes(32);
    const w = await wrapDek(dek, await keyFromSecretBytes(secret, 'bio'));
    await expect(unwrapDek(w, await keyFromSecretBytes(secret, 'bio'))).resolves.toBeTruthy();
    await expect(unwrapDek(w, await keyFromSecretBytes(randomBytes(32), 'bio'))).rejects.toThrow();
  });
});

describe('encryptBytes', () => {
  it('detects tampering', async () => {
    const k = await generateDek();
    const { iv, data } = await encryptBytes(k, utf8('balance: 1000'));
    data[3] ^= 1;
    await expect(decryptBytes(k, iv, data)).rejects.toThrow();
  });
  it('uses a fresh IV every time', async () => {
    const k = await generateDek();
    const a = await encryptBytes(k, utf8('same'));
    const b = await encryptBytes(k, utf8('same'));
    expect(toB64(a.iv)).not.toBe(toB64(b.iv));
    expect(toB64(a.data)).not.toBe(toB64(b.data));
  });
});
