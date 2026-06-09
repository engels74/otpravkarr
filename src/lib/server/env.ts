import { env } from "$env/dynamic/private";
import { assessSecretStrength } from "$lib/crypto/secret";

export function validateEnv(): void {
  const secret = env.OTPRAVKARR_SECRET?.trim();
  if (!secret) {
    console.error("FATAL: OTPRAVKARR_SECRET environment variable is required but not set.");
    console.error("Generate one with: openssl rand -base64 32");
    process.exit(1);
  }
  const strength = assessSecretStrength(secret);
  if (!strength.ok) {
    console.error("FATAL: OTPRAVKARR_SECRET does not meet minimum strength requirements.");
    console.error(strength.reason);
    console.error("Generate one with: openssl rand -base64 32");
    process.exit(1);
  }
}

export function getSecret(): string {
  const secret = env.OTPRAVKARR_SECRET?.trim();
  if (!secret) {
    throw new Error("OTPRAVKARR_SECRET is not set");
  }
  return secret;
}
