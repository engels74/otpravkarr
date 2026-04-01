import { afterEach, describe, expect, it, vi } from "vitest";
import { DecryptionError, decrypt, encrypt } from "../encryption";

// Mock deriveKey to return deterministic test keys without needing env/HKDF setup
vi.mock("../keys", () => {
  const keyCache = new Map<string, CryptoKey>();

  return {
    deriveKey: async (purpose: string): Promise<CryptoKey> => {
      const cached = keyCache.get(purpose);
      if (cached) return cached;

      // Derive a deterministic key from the purpose string for testing
      const raw = new TextEncoder().encode(purpose.padEnd(32, "\0").slice(0, 32));
      const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
      keyCache.set(purpose, key);
      return key;
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encrypt/decrypt", () => {
  it("round-trips plaintext through encrypt then decrypt", async () => {
    const plaintext = "hello, world!";
    const purpose = "config-encryption";

    const ciphertext = await encrypt(plaintext, purpose);
    const result = await decrypt(ciphertext, purpose);

    expect(result).toBe(plaintext);
  });

  it("produces valid base64 output", async () => {
    const ciphertext = await encrypt("test", "config-encryption");
    expect(() => atob(ciphertext)).not.toThrow();
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const plaintext = "same input";
    const purpose = "config-encryption";

    const ct1 = await encrypt(plaintext, purpose);
    const ct2 = await encrypt(plaintext, purpose);

    expect(ct1).not.toBe(ct2);

    // Both decrypt to the same plaintext
    expect(await decrypt(ct1, purpose)).toBe(plaintext);
    expect(await decrypt(ct2, purpose)).toBe(plaintext);
  });

  it("handles empty string", async () => {
    const ciphertext = await encrypt("", "config-encryption");
    const result = await decrypt(ciphertext, "config-encryption");
    expect(result).toBe("");
  });

  it("handles unicode content", async () => {
    const plaintext = "こんにちは世界 🌍 émojis & spëcial chars";
    const ciphertext = await encrypt(plaintext, "config-encryption");
    const result = await decrypt(ciphertext, "config-encryption");
    expect(result).toBe(plaintext);
  });

  it("handles long plaintext", async () => {
    const plaintext = "x".repeat(10_000);
    const ciphertext = await encrypt(plaintext, "config-encryption");
    const result = await decrypt(ciphertext, "config-encryption");
    expect(result).toBe(plaintext);
  });
});

describe("tamper detection", () => {
  it("throws DecryptionError when ciphertext is modified", async () => {
    const ciphertext = await encrypt("secret", "config-encryption");
    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

    // Flip a byte in the encrypted data portion (after IV)
    const byte14 = raw[14];
    if (byte14 !== undefined) raw[14] = byte14 ^ 0xff;
    const tampered = btoa(String.fromCharCode(...raw));

    await expect(decrypt(tampered, "config-encryption")).rejects.toThrow(DecryptionError);
  });

  it("throws DecryptionError when IV is modified", async () => {
    const ciphertext = await encrypt("secret", "config-encryption");
    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

    // Flip a byte in the IV
    const byte0 = raw[0];
    if (byte0 !== undefined) raw[0] = byte0 ^ 0xff;
    const tampered = btoa(String.fromCharCode(...raw));

    await expect(decrypt(tampered, "config-encryption")).rejects.toThrow(DecryptionError);
  });

  it("throws DecryptionError for truncated ciphertext", async () => {
    const ciphertext = await encrypt("secret", "config-encryption");
    const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

    // Truncate to just IV + partial data
    const truncated = btoa(String.fromCharCode(...raw.slice(0, 20)));

    await expect(decrypt(truncated, "config-encryption")).rejects.toThrow(DecryptionError);
  });

  it("throws DecryptionError for ciphertext shorter than IV + tag", async () => {
    const tooShort = btoa(String.fromCharCode(...new Uint8Array(10)));
    await expect(decrypt(tooShort, "config-encryption")).rejects.toThrow(DecryptionError);
    await expect(decrypt(tooShort, "config-encryption")).rejects.toThrow("Ciphertext too short");
  });

  it("throws DecryptionError for invalid base64", async () => {
    await expect(decrypt("not-valid-base64!!!", "config-encryption")).rejects.toThrow(
      DecryptionError,
    );
    await expect(decrypt("not-valid-base64!!!", "config-encryption")).rejects.toThrow(
      "Invalid base64",
    );
  });
});

describe("cross-purpose decryption", () => {
  it("fails to decrypt with a different purpose", async () => {
    const ciphertext = await encrypt("secret data", "config-encryption");

    await expect(decrypt(ciphertext, "credential-encryption")).rejects.toThrow(DecryptionError);
  });

  it("succeeds with the same purpose", async () => {
    const ciphertext = await encrypt("secret data", "credential-encryption");
    const result = await decrypt(ciphertext, "credential-encryption");
    expect(result).toBe("secret data");
  });
});

describe("DecryptionError", () => {
  it("has correct name property", () => {
    const error = new DecryptionError("test");
    expect(error.name).toBe("DecryptionError");
  });

  it("is an instance of Error", () => {
    const error = new DecryptionError("test");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DecryptionError);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("original");
    const error = new DecryptionError("wrapped", { cause });
    expect(error.cause).toBe(cause);
  });

  it("has correct message", () => {
    const error = new DecryptionError("something went wrong");
    expect(error.message).toBe("something went wrong");
  });
});
