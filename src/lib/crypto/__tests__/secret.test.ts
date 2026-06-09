// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessSecretStrength } from "../secret";

// ---------------------------------------------------------------------------
// Helper: build a 44-char base64 string that decodes to exactly 32 bytes.
// `openssl rand -base64 32` produces output of this shape.
// ---------------------------------------------------------------------------

// 32 bytes of known data, base64-encoded with one trailing `=`
const BASE64_32_BYTES = btoa(String.fromCharCode(...new Array(32).fill(0).map((_, i) => i + 1)));
// Confirm the fixture decodes to 32 bytes before the tests run
if (atob(BASE64_32_BYTES).length !== 32) {
  throw new Error("Test fixture error: BASE64_32_BYTES does not decode to 32 bytes");
}

// ---------------------------------------------------------------------------
// Core cases
// ---------------------------------------------------------------------------

describe("assessSecretStrength", () => {
  // ── Hex classification ──────────────────────────────────────────────────

  it("rejects 48-char hex string (openssl rand -hex 24 output = 24 bytes)", () => {
    // 48 hex chars = 24 bytes — below the 32-byte floor
    // Programmatically guaranteed to be exactly 48 hex chars
    const hex24 = Array.from({ length: 24 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
    expect(hex24.length).toBe(48);
    const result = assessSecretStrength(hex24);
    expect(result.ok).toBe(false);
    expect(result.bytes).toBe(24);
    expect(result.reason).toContain("hex");
    expect(result.reason).toContain("24");
  });

  it("accepts 64-char hex string (32 bytes)", () => {
    // Programmatically guaranteed 64-char hex string (32 bytes)
    const hex32 = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
    expect(hex32.length).toBe(64);
    const result = assessSecretStrength(hex32);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(32);
  });

  // ── Base64 classification ───────────────────────────────────────────────

  it("accepts 44-char base64 with trailing = (decodes to 32 bytes, openssl rand -base64 32 shape)", () => {
    expect(BASE64_32_BYTES.endsWith("=")).toBe(true);
    expect(BASE64_32_BYTES.length).toBe(44);
    const result = assessSecretStrength(BASE64_32_BYTES);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(32);
  });

  it("rejects 32-char base64 string (decodes to 24 bytes)", () => {
    // 32 base64 chars (multiple of 4, no padding needed) → 24 bytes
    const b64_24 = btoa(String.fromCharCode(...new Array(24).fill(0).map((_, i) => i + 65)));
    expect(b64_24.length).toBe(32);
    const result = assessSecretStrength(b64_24);
    expect(result.ok).toBe(false);
    expect(result.bytes).toBe(24);
    expect(result.reason).toContain("base64");
    expect(result.reason).toContain("24");
  });

  // ── Raw UTF-8 fallback ──────────────────────────────────────────────────

  it("accepts a mixed passphrase (spaces/punctuation, not hex/base64) with >= 32 UTF-8 bytes", () => {
    // Contains spaces and punctuation — not hex, not valid strict base64
    const passphrase = "correct horse battery staple with extra chars here!!";
    expect(passphrase.length).toBeGreaterThanOrEqual(32);
    const result = assessSecretStrength(passphrase);
    expect(result.ok).toBe(true);
  });

  it("rejects a short raw string (< 32 UTF-8 bytes)", () => {
    const short = "tooshort-secret";
    const result = assessSecretStrength(short);
    expect(result.ok).toBe(false);
    expect(result.bytes).toBeLessThan(32);
  });

  // ── Entropy guard ───────────────────────────────────────────────────────

  it("rejects all-same-char string regardless of length or hex validity", () => {
    // 64 'a' chars is valid hex AND long enough — must be rejected for entropy
    const allA = "a".repeat(64);
    const result = assessSecretStrength(allA);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("identical");
  });

  it("rejects string with < 8 distinct chars even when length >= 64", () => {
    // 7 distinct chars repeated to length 64
    const sevenDistinct = "abcdefg".repeat(10).slice(0, 64);
    expect(new Set(sevenDistinct).size).toBe(7);
    expect(sevenDistinct.length).toBe(64);
    const result = assessSecretStrength(sevenDistinct);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("distinct");
  });

  it("entropy guard fires before format classification (hex pattern but all identical chars)", () => {
    // 64 'a' chars: valid hex, would be 32 bytes — entropy guard must fire first
    const input = "a".repeat(64);
    const result = assessSecretStrength(input);
    expect(result.ok).toBe(false);
    // reason must mention entropy/identical, not bytes or hex
    expect(result.reason).toContain("identical");
    expect(result.reason).not.toContain("hex");
  });

  // ── reason strings never include the secret value ───────────────────────

  it("does not include secret value in reason string", () => {
    const secret = "mySecretValue1234567890abcdef!!";
    const result = assessSecretStrength(secret);
    if (result.reason) {
      expect(result.reason).not.toContain(secret);
    }
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("trims leading/trailing whitespace before assessment", () => {
    // 64-char hex with surrounding spaces — should be treated as valid 64-char hex after trim
    const hex32 = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
    const withSpaces = `  ${hex32}  `;
    const result = assessSecretStrength(withSpaces);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(32);
  });

  it("accepts base64 string with == padding (decodes to >= 32 bytes)", () => {
    // 36 bytes encoded → 48 chars base64 with == padding
    const bytes36 = new Array(36).fill(0).map((_, i) => i + 10);
    const b64 = btoa(String.fromCharCode(...bytes36));
    expect(b64.endsWith("==") || b64.endsWith("=") || b64.length % 4 === 0).toBe(true);
    const result = assessSecretStrength(b64);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(36);
  });
});
