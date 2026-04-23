import { z } from "zod";

/**
 * Strip control characters (except tab, newline, carriage return),
 * collapse runs of whitespace into single spaces, and trim.
 */
// biome-ignore lint/complexity/useRegexLiterals: literal form triggers noControlCharactersInRegex
const CONTROL_CHARS = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "g");

export function sanitizeString(input: string): string {
  return input.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

/**
 * Extract string fields from FormData, sanitize them, and validate against a Zod schema.
 * Returns the parsed result (success or error).
 */
export function parseFormData<T extends z.ZodTypeAny>(formData: FormData, schema: T) {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      raw[key] = sanitizeString(value);
    }
  }
  return schema.safeParse(raw);
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const LoginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// Setup — Create Admin
// ---------------------------------------------------------------------------

export const CreateAdminSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9_-]{3,32}$/,
        "Username must be 3-32 characters (letters, numbers, underscore, dash)",
      ),
    password: z.string().min(12, "Password must be at least 12 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ---------------------------------------------------------------------------
// Setup — Plex Token
// ---------------------------------------------------------------------------

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export function isHttpUrl(value: string): boolean {
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Shared guard for credentialled HTTP flows (Dispatcharr, Plex): HTTPS, or HTTP on loopback only. */
export function isSafeHttpSecretUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export const PlexTokenSchema = z.object({
  plexToken: z.string().trim().min(1, "Plex token is required"),
  plexServerUrl: z
    .string()
    .trim()
    .url("Plex server URL must be a valid URL")
    .refine(
      isSafeHttpSecretUrl,
      "Plex server URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
    ),
});

// ---------------------------------------------------------------------------
// Setup — Dispatcharr Config
// ---------------------------------------------------------------------------

export const DispatcharrConfigSchema = z.object({
  dispatcharrUrl: z
    .string()
    .trim()
    .url("Dispatcharr URL must be a valid URL")
    .refine(
      isSafeHttpSecretUrl,
      "Dispatcharr URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
    ),
  dispatcharrApiKey: z.string().trim().min(1, "Dispatcharr API key is required"),
  dispatcharrExternalUrl: z
    .string()
    .trim()
    .url("External URL must be a valid URL")
    .refine(
      isSafeHttpSecretUrl,
      "External URL must use HTTPS (HTTP only allowed for localhost, 127.0.0.1, or [::1])",
    )
    .optional()
    .or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Setup — Origins
// ---------------------------------------------------------------------------

export const OriginsSchema = z.object({
  allowedOrigins: z.string().min(1, "At least one origin is required"),
});

// ---------------------------------------------------------------------------
// Setup — Defaults
// ---------------------------------------------------------------------------

export const DefaultsSchema = z.object({
  defaultGroupId: z.string().optional(),
  defaultProfileId: z.string().optional(),
  syncInterval: z.coerce
    .number()
    .int("Sync interval must be a whole number")
    .min(1, "Sync interval must be at least 1")
    .max(1440, "Sync interval must be at most 1440"),
  defaultProvisioningMode: z.enum(["automatic", "self_managed"], {
    message: "Provisioning mode must be 'automatic' or 'self_managed'",
  }),
});

// ---------------------------------------------------------------------------
// Settings — Sync interval
// ---------------------------------------------------------------------------

export const SyncIntervalSchema = z.object({
  interval: z.coerce
    .number({ message: "Sync interval must be a number between 1 and 1440" })
    .int("Sync interval must be a number between 1 and 1440")
    .min(1, "Sync interval must be a number between 1 and 1440")
    .max(1440, "Sync interval must be a number between 1 and 1440"),
});

// ---------------------------------------------------------------------------
// Settings — Audit retention
// ---------------------------------------------------------------------------

export const AuditRetentionSchema = z.object({
  days: z.coerce
    .number()
    .int("Retention days must be a whole number")
    .min(1, "Retention days must be a positive integer"),
});

// ---------------------------------------------------------------------------
// Settings — Session TTL
// ---------------------------------------------------------------------------

export const SessionTtlSchema = z.object({
  seconds: z.coerce
    .number()
    .int("Session TTL must be a whole number")
    .min(300, "Session TTL must be at least 300 seconds")
    .max(86400, "Session TTL must be at most 86400 seconds"),
});
