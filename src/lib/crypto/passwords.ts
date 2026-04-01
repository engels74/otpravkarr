/**
 * Password utilities for admin authentication and XC credential generation.
 *
 * - Admin passwords: argon2id via Bun.password
 * - XC passwords: cryptographically random alphanumeric strings
 */

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_XC_PASSWORD_LENGTH = 24;

/**
 * Hash an admin password using argon2id via Bun's built-in password hashing.
 */
export async function hashAdminPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

/**
 * Verify an admin password against an argon2id hash.
 */
export async function verifyAdminPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/**
 * Generate a cryptographically random alphanumeric password for XC credentials.
 *
 * Uses rejection sampling via crypto.getRandomValues to avoid modulo bias.
 */
export function generateXcPassword(length: number = DEFAULT_XC_PASSWORD_LENGTH): string {
  const charsetLen = ALPHANUMERIC.length; // 62
  // Largest multiple of 62 that fits in a byte (248 = 62 * 4)
  const limit = 256 - (256 % charsetLen);

  const result: string[] = [];
  while (result.length < length) {
    const bytes = new Uint8Array(length - result.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (result.length >= length) break;
      if (byte < limit) {
        const char = ALPHANUMERIC[byte % charsetLen];
        if (char !== undefined) result.push(char);
      }
    }
  }

  return result.join("");
}
