import { decrypt, encrypt } from "$lib/crypto/encryption";

export const INITIAL_PASSWORD_COOKIE_NAME = "otpravkarr_initial_password";
export const INITIAL_PASSWORD_COOKIE_MAX_AGE = 120;

const INITIAL_PASSWORD_FLASH_PURPOSE = "initial-password-flash";
const INITIAL_PASSWORD_FLASH_TTL_MS = INITIAL_PASSWORD_COOKIE_MAX_AGE * 1000;

interface InitialPasswordFlashPayload {
  password: string;
  expiresAt: number;
}

function isPayload(value: unknown): value is InitialPasswordFlashPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.password === "string" && typeof payload.expiresAt === "number";
}

export async function sealInitialPasswordFlash(password: string): Promise<string> {
  return encrypt(
    JSON.stringify({
      password,
      expiresAt: Date.now() + INITIAL_PASSWORD_FLASH_TTL_MS,
    } satisfies InitialPasswordFlashPayload),
    INITIAL_PASSWORD_FLASH_PURPOSE,
  );
}

export async function openInitialPasswordFlash(sealed: string): Promise<string | null> {
  try {
    const plaintext = await decrypt(sealed, INITIAL_PASSWORD_FLASH_PURPOSE);
    const parsed: unknown = JSON.parse(plaintext);
    if (!isPayload(parsed)) return null;
    if (Date.now() >= parsed.expiresAt) return null;
    return parsed.password;
  } catch {
    return null;
  }
}
