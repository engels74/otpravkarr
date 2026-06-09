/**
 * Secret strength validator for OTPRAVKARR_SECRET.
 *
 * This module enforces the operator format contract documented in the README:
 * ">= 32 random bytes, base64". It does NOT measure the literal KDF input
 * strength — HKDF in keys.ts:9 consumes the raw UTF-8 string regardless of
 * encoding. What we enforce here is the entropy floor and minimum byte count
 * that the operator format contract requires.
 *
 * Pure module: no $env / SvelteKit / server-only imports. Safe to import from
 * standalone scripts (e.g. scripts/rotate-key.ts).
 */

export interface SecretStrengthResult {
  ok: boolean;
  bytes: number;
  reason?: string;
}

const MIN_BYTES = 32;
const MIN_DISTINCT_CHARS = 8;

/**
 * Assess whether a raw secret string meets the minimum strength requirements.
 *
 * Classification order (matters for correctness):
 *   1. Hex-first: /^[0-9a-fA-F]+$/ with even length → bytes = length / 2
 *   2. Strict base64: /^[A-Za-z0-9+/]+={0,2}$/ with length % 4 === 0
 *      and successful decode → bytes = decoded byte length
 *   3. Raw UTF-8 byte length fallback
 *
 * Hex is checked before base64 to avoid misclassifying hex strings as base64
 * (e.g. `openssl rand -hex 24` produces 48-char hex = 24 bytes, which is also
 * valid base64 but would yield an incorrect byte count of 36).
 */
export function assessSecretStrength(raw: string): SecretStrengthResult {
  const s = raw.trim();

  // ── Low-entropy guard ───────────────────────────────────────────────────────
  const distinctChars = new Set(s).size;
  if (s.length > 0 && distinctChars < MIN_DISTINCT_CHARS) {
    return {
      ok: false,
      bytes: 0,
      reason:
        distinctChars === 1
          ? "Secret rejected: all characters are identical (low entropy)."
          : `Secret rejected: fewer than ${MIN_DISTINCT_CHARS} distinct characters (low entropy).`,
    };
  }

  // ── (a) Hex classification (must be checked before base64) ─────────────────
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    const bytes = s.length / 2;
    if (bytes < MIN_BYTES) {
      return {
        ok: false,
        bytes,
        reason: `Secret rejected: detected hex encoding, decoded to ${bytes} bytes (need ≥ ${MIN_BYTES}).`,
      };
    }
    return { ok: true, bytes };
  }

  // ── (b) Strict base64 classification ────────────────────────────────────────
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) {
    try {
      const binary = atob(s);
      const bytes = binary.length;
      if (bytes < MIN_BYTES) {
        return {
          ok: false,
          bytes,
          reason: `Secret rejected: detected base64 encoding, decoded to ${bytes} bytes (need ≥ ${MIN_BYTES}).`,
        };
      }
      return { ok: true, bytes };
    } catch {
      // atob failed — fall through to raw UTF-8
    }
  }

  // ── (c) Raw UTF-8 byte length fallback ──────────────────────────────────────
  const bytes = new TextEncoder().encode(s).byteLength;
  if (bytes < MIN_BYTES) {
    return {
      ok: false,
      bytes,
      reason: `Secret rejected: raw UTF-8 length is ${bytes} bytes (need ≥ ${MIN_BYTES}).`,
    };
  }
  return { ok: true, bytes };
}
