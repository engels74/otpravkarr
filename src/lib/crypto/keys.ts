import { getSecret } from "$lib/server/env";

const HKDF_SALT = new TextEncoder().encode("otpravkarr-hkdf-v1");

const keyCache = new Map<string, CryptoKey>();

async function importMasterKey(): Promise<CryptoKey> {
  const secret = getSecret();
  const raw = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
}

export async function deriveKey(purpose: string): Promise<CryptoKey> {
  const cached = keyCache.get(purpose);
  if (cached) return cached;

  const masterKey = await importMasterKey();
  const info = new TextEncoder().encode(purpose);

  const derived = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info,
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  keyCache.set(purpose, derived);
  return derived;
}

export function clearKeyCache(): void {
  keyCache.clear();
}
