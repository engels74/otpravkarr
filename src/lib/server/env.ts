import { env } from "$env/dynamic/private";

export function validateEnv(): void {
  if (!env.OTPRAVKARR_SECRET) {
    console.error("FATAL: OTPRAVKARR_SECRET environment variable is required but not set.");
    console.error("Generate one with: openssl rand -base64 32");
    process.exit(1);
  }
}

export function getSecret(): string {
  const secret = env.OTPRAVKARR_SECRET;
  if (!secret) {
    throw new Error("OTPRAVKARR_SECRET is not set");
  }
  return secret;
}
