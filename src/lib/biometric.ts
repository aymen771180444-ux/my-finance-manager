/**
 * Biometric unlock via WebAuthn + the PRF extension. PRF turns a successful
 * fingerprint/face check into a secret that only this device's authenticator
 * can produce, so biometric unlock is cryptographic — not just a UI gate.
 * Devices/browsers without a platform authenticator or PRF are reported as
 * unsupported; the app never claims biometric support it cannot deliver.
 */
import { randomBytes, toB64, fromB64 } from '../engine/crypto';
import type { Bytes } from '../engine/crypto';

export async function biometricSupport(): Promise<'supported' | 'no-authenticator' | 'no-prf' | 'unavailable'> {
  const PKC = (globalThis as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential;
  if (!PKC || !navigator.credentials) return 'unavailable';
  try {
    if (!(await PKC.isUserVerifyingPlatformAuthenticatorAvailable())) return 'no-authenticator';
    const caps = await (PKC as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.();
    // when the capability API is missing we only know after enrolling (create() reports prf.enabled)
    if (caps && caps['extension:prf'] === false) return 'no-prf';
    return 'supported';
  } catch {
    return 'unavailable';
  }
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

async function getPrf(credentialId: string, prfSalt: Bytes): Promise<Bytes> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const out = (cred?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
  if (!out) throw new Error('NO_PRF');
  return new Uint8Array(out);
}

/** Create a platform credential with PRF and return what the vault needs. */
export async function enrollPlatformCredential(): Promise<{ credentialId: string; prfSalt: Bytes; prfOutput: Bytes }> {
  const prfSalt = randomBytes(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'My Finance Manager', id: location.hostname },
      user: { id: randomBytes(16), name: 'owner', displayName: 'My Finance Manager' },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('CANCELLED');
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (!ext.prf?.enabled && !ext.prf?.results?.first) throw new Error('NO_PRF');
  const credentialId = toB64(new Uint8Array(cred.rawId));
  // some authenticators only evaluate PRF during get(), not create()
  const prfOutput = ext.prf?.results?.first ? new Uint8Array(ext.prf.results.first) : await getPrf(credentialId, prfSalt);
  return { credentialId, prfSalt, prfOutput };
}

export function biometricSecret(credentialId: string, prfSaltB64: string): Promise<Bytes> {
  return getPrf(credentialId, fromB64(prfSaltB64));
}
