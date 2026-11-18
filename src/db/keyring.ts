/**
 * The unlocked data key lives ONLY here, in memory. Locking the app clears it;
 * it is never written to storage in plaintext.
 */
let dek: CryptoKey | null = null;

export const setDek = (k: CryptoKey | null) => {
  dek = k;
};
export const getDek = () => dek;
