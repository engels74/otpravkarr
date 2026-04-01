import { env } from "$env/dynamic/private";

export function validateEnv(): void {
  const secret = env.OTPRAVKARR_SECRET?.trim();
  if (!secret) {
    console.error("FATAL: OTPRAVKARR_SECRET environment variable is required but not set.");
    console.error("Generate one with: openssl rand -base64 32");
    process.exit(1);
  }
  if (secret.length < 32) {
    console.error(
      "FATAL: OTPRAVKARR_SECRET is too short (got %d chars, need ≥ 32).",
      secret.length,
    );
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
