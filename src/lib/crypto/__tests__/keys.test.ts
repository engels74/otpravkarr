import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/env", () => ({
  getSecret: () => "test-secret-that-is-at-least-32-chars-long!!",
}));

const { clearKeyCache, deriveKey } = await import("$lib/crypto/keys");

describe("deriveKey", () => {
  afterEach(() => {
    clearKeyCache();
  });

  it("returns a CryptoKey", async () => {
    const key = await deriveKey("config-encryption");
    expect(key).toBeInstanceOf(CryptoKey);
  });

  it("returns the same key for the same purpose (cache hit)", async () => {
    const key1 = await deriveKey("config-encryption");
    const key2 = await deriveKey("config-encryption");
    expect(key1).toBe(key2);
  });

  it("returns different keys for different purposes", async () => {
    const key1 = await deriveKey("config-encryption");
    const key2 = await deriveKey("credential-encryption");

    const raw1 = await crypto.subtle.exportKey("raw", key1).catch(() => null);
    const raw2 = await crypto.subtle.exportKey("raw", key2).catch(() => null);

    // Keys are non-extractable, so we verify by encrypting data and confirming cross-decryption fails
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("test-data");

    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key1, data);

    // Decrypting with the wrong key should fail
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, key2, encrypted)).rejects.toThrow();
  });

  it("produces deterministic keys (same secret + purpose = same derived key)", async () => {
    const key1 = await deriveKey("config-encryption");
    clearKeyCache();
    const key2 = await deriveKey("config-encryption");

    // Both keys should encrypt identically
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("determinism-check");

    const enc1 = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key1, data);
    const enc2 = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key2, data);

    expect(new Uint8Array(enc1)).toEqual(new Uint8Array(enc2));
  });

  it("derived key has AES-GCM algorithm with 256-bit length", async () => {
    const key = await deriveKey("config-encryption");
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
  });

  it("derived key supports encrypt and decrypt", async () => {
    const key = await deriveKey("config-encryption");
    expect(key.usages).toContain("encrypt");
    expect(key.usages).toContain("decrypt");
  });
});
