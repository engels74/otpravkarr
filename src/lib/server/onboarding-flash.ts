import { decrypt, encrypt } from "$lib/crypto/encryption";
import type { PlexIdentity } from "$lib/plex/types";

/**
 * Sealed carrier for a Plex identity that has been OAuth-verified and confirmed
 * to be an accepted friend, but NOT yet provisioned.
 *
 * The mandatory group picker shown to new friends happens BEFORE provisioning,
 * across a separate request (GET picker → POST confirm). We can't hold the
 * verified identity server-side without a store, so it rides in a short-lived,
 * encrypted (tamper-proof) cookie. The Plex auth token is intentionally NOT
 * sealed — provisioning never needs it, and keeping it out of the cookie avoids
 * persisting a credential client-side. The confirm step still re-verifies friend
 * status against Plex, so the cookie is a convenience carrier, not a trust root.
 */

export const ONBOARDING_COOKIE_NAME = "otpravkarr_onboarding";
export const ONBOARDING_COOKIE_MAX_AGE = 600; // 10 minutes to make a selection

const ONBOARDING_FLASH_PURPOSE = "onboarding-identity-flash";
const ONBOARDING_FLASH_TTL_MS = ONBOARDING_COOKIE_MAX_AGE * 1000;

/** The subset of PlexIdentity provisioning needs (no auth token). */
export type OnboardingIdentity = Omit<PlexIdentity, "authenticationToken">;

interface OnboardingFlashPayload extends OnboardingIdentity {
  expiresAt: number;
}

function isPayload(value: unknown): value is OnboardingFlashPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "number" &&
    typeof p.uuid === "string" &&
    typeof p.username === "string" &&
    typeof p.email === "string" &&
    typeof p.thumb === "string" &&
    typeof p.expiresAt === "number"
  );
}

export async function sealOnboardingIdentity(identity: OnboardingIdentity): Promise<string> {
  return encrypt(
    JSON.stringify({
      id: identity.id,
      uuid: identity.uuid,
      username: identity.username,
      email: identity.email,
      thumb: identity.thumb,
      expiresAt: Date.now() + ONBOARDING_FLASH_TTL_MS,
    } satisfies OnboardingFlashPayload),
    ONBOARDING_FLASH_PURPOSE,
  );
}

export async function openOnboardingIdentity(sealed: string): Promise<OnboardingIdentity | null> {
  try {
    const plaintext = await decrypt(sealed, ONBOARDING_FLASH_PURPOSE);
    const parsed: unknown = JSON.parse(plaintext);
    if (!isPayload(parsed)) return null;
    if (Date.now() >= parsed.expiresAt) return null;
    return {
      id: parsed.id,
      uuid: parsed.uuid,
      username: parsed.username,
      email: parsed.email,
      thumb: parsed.thumb,
    };
  } catch {
    return null;
  }
}
