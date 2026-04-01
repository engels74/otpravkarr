/**
 * Bootstrap token lifecycle — single-use, in-memory tokens for initial setup.
 *
 * Tokens are never persisted to a database. They exist only in process memory
 * and are consumed on first successful verification.
 */

/** Active token singleton — lives in memory only. */
let activeToken: { value: string; expiresAt: number } | null = null;

const TOKEN_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SEGMENT_LENGTH = 4;
const SEGMENT_COUNT = 3;
const DEFAULT_TTL_MINUTES = 15;

/**
 * Generate a bootstrap token in `xxxx-xxxx-xxxx` format.
 * Uses `crypto.getRandomValues` for cryptographic randomness.
 */
export function generateBootstrapToken(): string {
  const segments: string[] = [];

  for (let s = 0; s < SEGMENT_COUNT; s++) {
    const bytes = new Uint8Array(SEGMENT_LENGTH);
    crypto.getRandomValues(bytes);

    let segment = "";
    for (let i = 0; i < SEGMENT_LENGTH; i++) {
      const byte = bytes[i] ?? 0;
      segment += TOKEN_CHARSET[byte % TOKEN_CHARSET.length];
    }
    segments.push(segment);
  }

  return segments.join("-");
}

/**
 * Create a new bootstrap token with a TTL (default 15 minutes).
 * Replaces any existing active token.
 */
export function createBootstrapToken(ttlMinutes: number = DEFAULT_TTL_MINUTES): string {
  const token = generateBootstrapToken();
  activeToken = {
    value: token,
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
  };
  return token;
}

/**
 * Consume a bootstrap token. Returns `true` if the candidate matches the
 * active token and it has not expired. The token is nulled on success
 * (single-use). Uses constant-time comparison to prevent timing attacks.
 */
export function consumeBootstrapToken(candidate: string): boolean {
  if (!activeToken) return false;
  if (Date.now() >= activeToken.expiresAt) {
    activeToken = null;
    return false;
  }

  const match = timingSafeEqual(candidate, activeToken.value);
  if (match) {
    activeToken = null;
  }
  return match;
}

/** Check whether the active bootstrap token has expired. */
export function isBootstrapTokenExpired(): boolean {
  if (!activeToken) return true;
  return Date.now() >= activeToken.expiresAt;
}

/**
 * Constant-time string comparison.
 * Compares every byte regardless of mismatch position to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  // Always compare against the longer length to avoid leaking length information
  const maxLen = Math.max(bufA.length, bufB.length);
  if (maxLen === 0) return true;

  let result = bufA.length ^ bufB.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = bufA[i % bufA.length] ?? 0;
    const byteB = bufB[i % bufB.length] ?? 0;
    result |= byteA ^ byteB;
  }
  return result === 0;
}

/** Reset active token — for testing only. */
export function _resetForTesting(): void {
  activeToken = null;
}

/** Get active token metadata — for testing only. */
export function _getActiveTokenForTesting(): { value: string; expiresAt: number } | null {
  return activeToken;
}
