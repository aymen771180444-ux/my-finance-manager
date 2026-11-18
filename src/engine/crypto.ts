/**
 * Cryptography — WebCrypto only (no third-party crypto).
 *
 * Key-management design (PRD §22, §28):
 *  - A random 256-bit Data Encryption Key (DEK) encrypts sensitive material
 *    (attachments). The DEK never touches storage in plaintext.
 *  - The DEK is stored WRAPPED (AES-GCM) under key-encryption keys derived
 *    with PBKDF2-SHA-256 from (a) the PIN and (b) a recovery password. Either
 *    one unwraps it, so a forgotten PIN is recoverable. A wrong secret fails the
 *    GCM authentication tag — that is the PIN check; no PIN hash is stored.
 *  - Optional biometric unlock wraps the DEK under a key derived from the
 *    WebAuthn PRF extension (hardware-backed). Not offered without PRF.
 *  - Backups use their own password-derived key, independent of the device
 *    DEK, so they restore on any device.
 */

export const KDF_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256

const subtle = () => globalThis.crypto.subtle;

/** Byte arrays backed by a plain ArrayBuffer (what Blob and WebCrypto accept). */
export type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  // getRandomValues refuses more than 65,536 bytes per call
  for (let i = 0; i < n; i += 65_536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
}

// ——— encoding helpers (browser-safe, no Buffer) ———
export function toB64(bytes: Bytes): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
export function fromB64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const utf8 = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s));
export const fromUtf8 = (b: Bytes) => new TextDecoder().decode(b);

export async function sha256Hex(data: Bytes): Promise<string> {
  const h = new Uint8Array(await subtle().digest('SHA-256', data));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Password/PIN → AES-GCM key-encryption key. */
export async function deriveKey(secret: string, salt: Bytes, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', utf8(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

/** Password → raw 32-byte key material (kept so a device can store it, wrapped, after joining). */
export async function deriveKeyBytes(secret: string, salt: Bytes, iterations = KDF_ITERATIONS): Promise<Bytes> {
  const base = await subtle().importKey('raw', utf8(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

/** Raw 32 bytes → AES-GCM encrypt/decrypt key. */
export function importAesKey(raw: Bytes): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Raw 32-byte secret (e.g. WebAuthn PRF output) → AES-GCM key via HKDF. */
export async function keyFromSecretBytes(secret: Bytes, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export function generateDek(): Promise<CryptoKey> {
  // extractable so it can be re-wrapped when the PIN changes
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export interface Wrapped {
  iv: string; // b64
  data: string; // b64
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<Wrapped> {
  const iv = randomBytes(12);
  const data = new Uint8Array(await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }));
  return { iv: toB64(iv), data: toB64(data) };
}

/** Throws (OperationError) when the key is wrong — GCM tag mismatch. */
export function unwrapDek(w: Wrapped, kek: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey('raw', fromB64(w.data), kek, { name: 'AES-GCM', iv: fromB64(w.iv) }, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptBytes(key: CryptoKey, plain: Bytes): Promise<{ iv: Bytes; data: Bytes }> {
  const iv = randomBytes(12);
  return { iv, data: new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain)) };
}

/** Throws when the key is wrong or the data was tampered with. */
export async function decryptBytes(key: CryptoKey, iv: Bytes, data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, data));
}
