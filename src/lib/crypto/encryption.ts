import { deriveKey } from "./keys";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class DecryptionError extends Error {
  override name = "DecryptionError" as const;
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a purpose-specific key.
 * Returns a base64-encoded string containing: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export async function encrypt(plaintext: string, purpose: string): Promise<string> {
  const key = await deriveKey(purpose);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
  );

  // AES-GCM output = ciphertext + tag (tag is appended by Web Crypto)
  // Final layout: IV (12) + ciphertext + tag (16)
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(ciphertext, IV_LENGTH);

  return Buffer.from(result).toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext string using AES-256-GCM with a purpose-specific key.
 * Expects the format: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 * Throws DecryptionError on any failure.
 */
export async function decrypt(ciphertext: string, purpose: string): Promise<string> {
  let raw: Uint8Array;
  try {
    const binary = atob(ciphertext);
    raw = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch (e) {
    throw new DecryptionError("Invalid base64 input", { cause: e });
  }

  if (raw.byteLength < IV_LENGTH + TAG_LENGTH) {
    throw new DecryptionError("Ciphertext too short");
  }

  const iv = raw.slice(0, IV_LENGTH);
  const encrypted = raw.slice(IV_LENGTH);

  let key: CryptoKey;
  try {
    key = await deriveKey(purpose);
  } catch (e) {
    throw new DecryptionError("Key derivation failed", { cause: e });
  }

  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    throw new DecryptionError("Decryption failed: authentication tag mismatch or corrupted data", {
      cause: e,
    });
  }
}
