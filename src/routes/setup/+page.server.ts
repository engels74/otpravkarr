import type { Actions, Cookies, RequestEvent } from "@sveltejs/kit";
import { fail, redirect } from "@sveltejs/kit";
import { clearBootstrapToken, validateBootstrapToken } from "$lib/crypto/bootstrap";
import { hashAdminPassword, verifyAdminPassword } from "$lib/crypto/passwords";
import {
  adminExists,
  getAdminByUsername,
  createAdmin as insertAdmin,
} from "$lib/db/repositories/admin";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig, setConfig } from "$lib/db/repositories/config";
import { createSession, deleteSession } from "$lib/db/repositories/sessions";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import { createHealthEndpoints } from "$lib/dispatcharr/endpoints/health";
import { listProfiles } from "$lib/dispatcharr/endpoints/profiles";
import { discoverServers, validateServerToken } from "$lib/plex/client";
import { completeOAuth, initiateOAuth, removePendingOAuth } from "$lib/plex/oauth";
import { PlexAuthError, PlexConnectionError } from "$lib/plex/types";
import { seedInitialHealth } from "$lib/scheduler/jobs/health";
import {
  ADMIN_COOKIE_OPTIONS,
  ADMIN_SESSION_TTL,
  isSecure,
  isSetupComplete,
  requireSetupIncomplete,
  SESSION_COOKIE_NAME,
  SETUP_COMPLETED_CONFIG_KEY,
} from "$lib/server/auth";
import { parseAndNormalizeOrigins } from "$lib/server/origins";
import { setupLimiter } from "$lib/server/ratelimit";
import { isQuarantineGroup } from "$lib/server/subscription-config";
import {
  CreateAdminSchema,
  DefaultsSchema,
  DispatcharrConfigSchema,
  OriginsSchema,
  PlexTokenSchema,
  RecoverWithAdminSchema,
  sanitizeString,
} from "$lib/server/validation";
import { probeXcSurface } from "$lib/url/discover";
import type { RetryOptions } from "$lib/utils/retry";
import { retryAsync } from "$lib/utils/retry";

const SETUP_CLAIMED_CONFIG_KEY = "setup_claimed";
const SETUP_CLAIM_PROOF_CONFIG_KEY = "setup_claim_proof";
const SETUP_CLAIMED_AT_CONFIG_KEY = "setup_claimed_at";
const SETUP_CLAIMED_VALUE = "true";
const SETUP_UNCLAIMED_VALUE = "false";
const SETUP_COMPLETED_VALUE = "true";
const SETUP_INCOMPLETE_VALUE = "false";
const SETUP_CLAIM_COOKIE_NAME = "otpravkarr_setup_claim";
const POST_SETUP_REDIRECT_PATH = "/dashboard";
// Keep claim TTL shorter than bootstrap token TTL (15m) so expired claims can be reclaimed.
const SETUP_CLAIM_TTL_SECONDS = 10 * 60;
const SETUP_CLAIM_TTL_MS = SETUP_CLAIM_TTL_SECONDS * 1000;
const SETUP_PREREQUISITE_KEYS = [
  "plex_server_url",
  "plex_admin_token",
  "plex_machine_id",
  "dispatcharr_url",
  "dispatcharr_api_key",
  "allowed_origins",
] as const;
const PLEX_SETUP_KEYS = ["plex_server_url", "plex_admin_token", "plex_machine_id"] as const;
const DISPATCHARR_SETUP_KEYS = ["dispatcharr_url", "dispatcharr_api_key"] as const;
const SETUP_CONNECTION_RETRY: RetryOptions = {
  maxRetries: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 5_000,
  jitter: 0.5,
};
const ORIGIN_SETUP_KEY = "allowed_origins";
const SETUP_CLAIM_COOKIE_OPTIONS = {
  path: "/setup",
  httpOnly: true,
  secure: isSecure,
  sameSite: "strict" as const,
  maxAge: SETUP_CLAIM_TTL_SECONDS,
};
/**
 * Setup-specific retry predicate for Plex errors.
 * Only retries transient PlexConnectionError cases (timeouts, network blips).
 * Deterministic errors (bad URL, not-found) and all non-PlexConnectionError
 * errors (including programmer errors) are not retried.
 */
function isTransientPlexSetupError(error: unknown): boolean {
  if (error instanceof PlexConnectionError) {
    const msg = error.message.toLowerCase();
    // Deterministic errors — no point retrying
    if (msg.startsWith("bad request") || msg.startsWith("not found")) {
      return false;
    }
    return true;
  }
  return false;
}

type SetupResumePhase = 1 | 2 | 3 | 4 | 5;
type SetupSelectionOption = { id: number; name: string };

type SetupResumePayload = {
  dispatcharrGroups: SetupSelectionOption[];
  dispatcharrProfiles: SetupSelectionOption[];
};

function safeAuditSetupStep(
  actor: string,
  step: string,
  detail: Record<string, unknown>,
  ipAddress: string,
): void {
  try {
    appendAuditLog({
      actor,
      action: AuditAction.CONFIG_CHANGED,
      detail: { step, ...detail },
      ipAddress,
    });
  } catch (err) {
    console.warn(
      `Failed to append audit log for setup step ${step}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function isSetupClaimed(): Promise<boolean> {
  const claimed = await getConfig(SETUP_CLAIMED_CONFIG_KEY);
  return claimed === SETUP_CLAIMED_VALUE;
}

async function getActiveSetupClaimProof(): Promise<string | null> {
  if (!(await isSetupClaimed())) {
    return null;
  }

  const [expectedProof, claimTimestampRaw] = await Promise.all([
    getConfig(SETUP_CLAIM_PROOF_CONFIG_KEY),
    getConfig(SETUP_CLAIMED_AT_CONFIG_KEY),
  ]);
  if (!expectedProof || !claimTimestampRaw) {
    return null;
  }

  const claimTimestamp = Number(claimTimestampRaw);
  // A future `setup_claimed_at` (clock skew or tampering) is untrusted: every write
  // site stores String(Date.now()), so a legitimate timestamp is never ahead of now.
  // Honoring a future value makes `Date.now() >= claimTimestamp + TTL` false for the
  // whole now..future+TTL window, extending the 409 lockout well past the 10-min TTL.
  if (
    !Number.isFinite(claimTimestamp) ||
    claimTimestamp > Date.now() ||
    Date.now() >= claimTimestamp + SETUP_CLAIM_TTL_MS
  ) {
    return null;
  }

  return expectedProof;
}

/**
 * Epoch-ms timestamp at which an active setup claim expires and the instance can
 * be re-claimed, or null when there is no still-valid claim. Used by `load` to
 * tell a stranded user (lost claim cookie, no admin yet) WHEN re-claiming opens
 * up again (ISSUE-004). Mirrors getActiveSetupClaimProof, including its
 * requirement of a non-empty `setup_claim_proof`, so the guidance matches the
 * real re-claim gate: if the proof is missing/corrupt, claimInstance does NOT
 * block, so this returns null instead of falsely flagging claimHeldElsewhere.
 * Future `setup_claimed_at` values are treated as untrusted (mirrors
 * getActiveSetupClaimProof) so a skewed/tampered timestamp can't push the
 * reported expiry past the real re-claim window.
 */
async function getActiveSetupClaimExpiry(): Promise<number | null> {
  if (!(await isSetupClaimed())) {
    return null;
  }

  const [expectedProof, claimTimestampRaw] = await Promise.all([
    getConfig(SETUP_CLAIM_PROOF_CONFIG_KEY),
    getConfig(SETUP_CLAIMED_AT_CONFIG_KEY),
  ]);
  if (!expectedProof || !claimTimestampRaw) {
    return null;
  }

  const claimTimestamp = Number(claimTimestampRaw);
  // Future timestamps are untrusted (see getActiveSetupClaimProof): a tampered or
  // clock-skewed value would otherwise push `expiry` far beyond the 10-min TTL and
  // strand the user past the real re-claim window the gate actually enforces.
  if (!Number.isFinite(claimTimestamp) || claimTimestamp > Date.now()) {
    return null;
  }

  const expiry = claimTimestamp + SETUP_CLAIM_TTL_MS;
  // A corrupted/tampered `setup_claimed_at` can hold a finite value whose expiry
  // exceeds the max representable JS Date (±8.64e15 ms). Feeding that to
  // `new Date(expiry).toISOString()` in `load` throws RangeError and 500s the
  // setup page, so treat out-of-range expiries as "no active claim" — the
  // graceful fallback the UI already handles via claimRetryAt: null.
  const MAX_DATE_MS = 8_640_000_000_000_000;
  if (!Number.isFinite(expiry) || Math.abs(expiry) > MAX_DATE_MS) {
    return null;
  }
  return Date.now() >= expiry ? null : expiry;
}

async function hasActiveSetupClaim(cookies: Cookies): Promise<boolean> {
  const expectedProof = await getActiveSetupClaimProof();
  if (!expectedProof) {
    return false;
  }

  const claimProof = cookies.get(SETUP_CLAIM_COOKIE_NAME);
  return claimProof !== undefined && claimProof === expectedProof;
}

async function requireSetupClaimedAction(cookies: Cookies) {
  if (await hasActiveSetupClaim(cookies)) {
    await renewSetupClaim(cookies);
    return null;
  }

  return fail(403, { error: "setup_not_claimed" });
}

async function renewSetupClaim(cookies: Cookies): Promise<void> {
  const claimProof = cookies.get(SETUP_CLAIM_COOKIE_NAME);
  if (!claimProof) {
    return;
  }

  await setConfig(SETUP_CLAIMED_AT_CONFIG_KEY, String(Date.now()));
  cookies.set(SETUP_CLAIM_COOKIE_NAME, claimProof, SETUP_CLAIM_COOKIE_OPTIONS);
}

async function getMissingSetupPrerequisites(): Promise<string[]> {
  const values = await Promise.all(SETUP_PREREQUISITE_KEYS.map((key) => getConfig(key)));

  return SETUP_PREREQUISITE_KEYS.filter((_, index) => {
    const value = values[index];
    return value === undefined || value === null || value.trim().length === 0;
  });
}

async function hasNonEmptyConfigValues(keys: readonly string[]): Promise<boolean> {
  const values = await Promise.all(keys.map((key) => getConfig(key)));
  return values.every((value) => value !== null && value.trim().length > 0);
}

async function deriveSetupResumePhase(): Promise<SetupResumePhase> {
  if (!adminExists()) {
    return 1;
  }
  if (!(await hasNonEmptyConfigValues(PLEX_SETUP_KEYS))) {
    return 2;
  }
  if (!(await hasNonEmptyConfigValues(DISPATCHARR_SETUP_KEYS))) {
    return 3;
  }
  if (!(await hasNonEmptyConfigValues([ORIGIN_SETUP_KEY]))) {
    return 4;
  }
  return 5;
}

async function loadDispatcharrSetupPayload(phase: SetupResumePhase): Promise<SetupResumePayload> {
  if (phase < 4) {
    return {
      dispatcharrGroups: [],
      dispatcharrProfiles: [],
    };
  }

  const [dispatcharrUrl, dispatcharrApiKey] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
  ]);
  if (!dispatcharrUrl || !dispatcharrApiKey) {
    return {
      dispatcharrGroups: [],
      dispatcharrProfiles: [],
    };
  }

  try {
    const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
    const [groupsResult, profilesResult] = await Promise.all([
      listChannelGroups(client),
      listProfiles(client),
    ]);

    return {
      // Mirror Settings: the default-group picker offers the SUBSCRIBABLE
      // channel groups (/api/channels/groups/), not Django permission groups,
      // excluding quarantine groups. Map to the {id, name} option shape.
      dispatcharrGroups: groupsResult.ok
        ? groupsResult.data
            .filter((g) => !isQuarantineGroup(g.name))
            .map((g) => ({ id: g.id, name: g.name }))
        : [],
      dispatcharrProfiles: profilesResult.ok ? profilesResult.data : [],
    };
  } catch {
    return {
      dispatcharrGroups: [],
      dispatcharrProfiles: [],
    };
  }
}

export const load = async ({ url, cookies }: RequestEvent) => {
  await requireSetupIncomplete();

  const oauthCallback = url.searchParams.get("oauthCallback") === "1";
  const [claimActive, resumePhase] = await Promise.all([
    hasActiveSetupClaim(cookies),
    deriveSetupResumePhase(),
  ]);
  const { dispatcharrGroups, dispatcharrProfiles } = claimActive
    ? await loadDispatcharrSetupPayload(resumePhase)
    : { dispatcharrGroups: [], dispatcharrProfiles: [] };
  const adminPresent = adminExists();
  const recoveryAvailable = adminPresent && !claimActive;

  // ISSUE-004: a claim is active but THIS browser does not hold it and no admin
  // exists yet. The user is stranded — createAdmin → 403 (not claimed here), a
  // fresh claimInstance → 409 (already claimed), recoverWithAdmin → 409 (no
  // admin). The anti-claim-stealing guard is intentional; surface WHY re-claim
  // is blocked and WHEN it reopens (the claim TTL) instead of leaving the Claim
  // step silently dead. No gate is relaxed.
  const claimRetryAtMs = !claimActive && !adminPresent ? await getActiveSetupClaimExpiry() : null;

  return {
    claimActive,
    resumePhase,
    dispatcharrGroups,
    dispatcharrProfiles,
    oauthCallback,
    adminPresent,
    recoveryAvailable,
    claimHeldElsewhere: claimRetryAtMs !== null,
    claimRetryAt: claimRetryAtMs !== null ? new Date(claimRetryAtMs).toISOString() : null,
  };
};

export const actions: Actions = {
  claimInstance: async ({ request, getClientAddress, cookies }) => {
    if (await hasActiveSetupClaim(cookies)) {
      await renewSetupClaim(cookies);
      return { success: true };
    }
    if (await getActiveSetupClaimProof()) {
      return fail(409, { error: "setup_claimed" });
    }

    const limit = setupLimiter.check(getClientAddress());
    if (!limit.allowed) {
      return fail(429, { error: "rate_limited" });
    }

    const formData = await request.formData();
    const token = String(formData.get("token") ?? "").trim();

    if (!token) {
      return fail(400, { error: "invalid_token" });
    }

    const valid = validateBootstrapToken(token);
    if (!valid) {
      return fail(400, { error: "invalid_token" });
    }

    const claimProof = crypto.randomUUID();
    await Promise.all([
      setConfig(SETUP_CLAIMED_CONFIG_KEY, SETUP_CLAIMED_VALUE),
      setConfig(SETUP_CLAIM_PROOF_CONFIG_KEY, claimProof, true),
      setConfig(SETUP_CLAIMED_AT_CONFIG_KEY, String(Date.now())),
    ]);
    cookies.set(SETUP_CLAIM_COOKIE_NAME, claimProof, SETUP_CLAIM_COOKIE_OPTIONS);

    safeAuditSetupStep("setup-wizard", "bootstrap_token_claimed", {}, getClientAddress());

    return { success: true };
  },

  recoverWithAdmin: async ({ request, cookies, getClientAddress }) => {
    if (await isSetupComplete()) {
      return fail(404, { error: "not_found" });
    }
    if (!adminExists()) {
      return fail(409, { error: "no_admin" });
    }
    if (await hasActiveSetupClaim(cookies)) {
      await renewSetupClaim(cookies);
      const resumePhase = await deriveSetupResumePhase();
      const { dispatcharrGroups, dispatcharrProfiles } =
        await loadDispatcharrSetupPayload(resumePhase);
      return { success: true, resumePhase, dispatcharrGroups, dispatcharrProfiles };
    }

    const clientAddress = getClientAddress();
    const limit = setupLimiter.check(clientAddress);
    if (!limit.allowed) {
      return fail(429, { error: "rate_limited" });
    }

    const formData = await request.formData();
    // Validate username via schema (sanitized), but read password raw to match
    // how it was stored by createAdmin and how /login authenticates. Sanitizing
    // the password would trim whitespace and collapse internal space runs,
    // breaking recovery for admins whose passwords contain such characters.
    const parsed = RecoverWithAdminSchema.safeParse({
      username: sanitizeString(String(formData.get("username") ?? "")),
      password: String(formData.get("password") ?? ""),
    });
    if (!parsed.success) {
      return fail(400, { error: "invalid_input" });
    }

    const { username, password } = parsed.data;
    const admin = getAdminByUsername(username);
    if (!admin) {
      return fail(401, { error: "invalid_credentials" });
    }

    const passwordValid = await verifyAdminPassword(password, admin.password_hash);
    if (!passwordValid) {
      return fail(401, { error: "invalid_credentials" });
    }

    const existingProof = await getActiveSetupClaimProof();
    const proof = existingProof ?? crypto.randomUUID();
    if (!existingProof) {
      await Promise.all([
        setConfig(SETUP_CLAIMED_CONFIG_KEY, SETUP_CLAIMED_VALUE),
        setConfig(SETUP_CLAIM_PROOF_CONFIG_KEY, proof, true),
      ]);
    }
    await setConfig(SETUP_CLAIMED_AT_CONFIG_KEY, String(Date.now()));
    cookies.set(SETUP_CLAIM_COOKIE_NAME, proof, SETUP_CLAIM_COOKIE_OPTIONS);

    appendAuditLog({
      action: AuditAction.SETUP_RECOVERY_LOGIN,
      actor: admin.username,
      detail: { ip: clientAddress },
      ipAddress: clientAddress,
    });
    safeAuditSetupStep(
      "setup-wizard",
      "setup_resumed_via_admin",
      { username: admin.username },
      clientAddress,
    );

    const resumePhase = await deriveSetupResumePhase();
    const { dispatcharrGroups, dispatcharrProfiles } =
      await loadDispatcharrSetupPayload(resumePhase);

    return { success: true, resumePhase, dispatcharrGroups, dispatcharrProfiles };
  },

  createAdmin: async ({ request, cookies, getClientAddress }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    if (adminExists()) {
      return fail(409, {
        error: "An admin account already exists for this installation",
        field: "username",
      });
    }

    const formData = await request.formData();
    const parsed = CreateAdminSchema.safeParse({
      username: sanitizeString(String(formData.get("username") ?? "")),
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0] as string | undefined;
      return fail(400, {
        error: issue?.message ?? "Invalid input",
        field: field ?? "username",
      });
    }

    const { username, password } = parsed.data;

    const adminPasswordHash = await hashAdminPassword(password);
    try {
      insertAdmin(username, adminPasswordHash);
    } catch {
      return fail(400, {
        error: "Admin account could not be created",
        field: "username",
      });
    }

    await Promise.all([
      setConfig("admin_username", username),
      setConfig(SETUP_COMPLETED_CONFIG_KEY, SETUP_INCOMPLETE_VALUE),
    ]);

    safeAuditSetupStep(username, "admin_created", { username }, getClientAddress());

    return { success: true };
  },

  configurePlex: async ({ request, url, cookies, getClientAddress }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const plexMode = String(formData.get("plexMode") ?? "");
    const adminUsername = (await getConfig("admin_username")) ?? "setup-wizard";

    try {
      if (plexMode === "token") {
        const tokenResult = PlexTokenSchema.safeParse({
          plexToken: sanitizeString(String(formData.get("plexToken") ?? "")),
          plexServerUrl: sanitizeString(String(formData.get("plexServerUrl") ?? "")),
        });

        if (!tokenResult.success) {
          return fail(400, {
            error: tokenResult.error.issues[0]?.message ?? "Plex token and server URL are required",
          });
        }

        const { plexToken, plexServerUrl } = tokenResult.data;
        const serverInfo = await retryAsync(
          () => validateServerToken(plexServerUrl, plexToken),
          isTransientPlexSetupError,
          SETUP_CONNECTION_RETRY,
        );

        await Promise.all([
          setConfig("plex_server_url", plexServerUrl),
          setConfig("plex_admin_token", plexToken, true),
          setConfig("plex_machine_id", serverInfo.machineIdentifier),
        ]);
        safeAuditSetupStep(
          adminUsername,
          "plex_configured",
          { mode: "token", machine_id: serverInfo.machineIdentifier },
          getClientAddress(),
        );
        return {
          success: true,
          friendlyName: serverInfo.friendlyName,
          machineIdentifier: serverInfo.machineIdentifier,
          version: serverInfo.version,
        };
      }

      if (plexMode === "oauth_initiate") {
        // Use the request origin (not the configured ORIGIN) so the OAuth
        // callback popup lands on the same origin as the opener window.
        // This is required for the postMessage handshake to succeed.
        const forwardUrl = `${url.origin}/setup?oauthCallback=1`;
        const result = await initiateOAuth(forwardUrl);
        return {
          success: true,
          oauthId: result.id,
          oauthUri: result.uri,
        };
      }

      if (plexMode === "oauth_discover") {
        const oauthId = String(formData.get("oauthId") ?? "").trim();
        if (!oauthId) {
          return fail(400, { error: "OAuth session ID is required" });
        }

        const identity = await completeOAuth(oauthId);
        const servers = await discoverServers(identity.authenticationToken);
        return { success: true, servers };
      }

      if (plexMode === "oauth_complete") {
        const oauthId = String(formData.get("oauthId") ?? "").trim();
        const rawPlexServerUrl = sanitizeString(String(formData.get("plexServerUrl") ?? ""));

        if (!oauthId) {
          return fail(400, { error: "OAuth session ID is required" });
        }

        const urlResult = PlexTokenSchema.pick({ plexServerUrl: true }).safeParse({
          plexServerUrl: rawPlexServerUrl,
        });
        if (!urlResult.success) {
          return fail(400, {
            error: urlResult.error.issues[0]?.message ?? "Invalid Plex server URL",
          });
        }
        const plexServerUrl = urlResult.data.plexServerUrl;

        const identity = await completeOAuth(oauthId);
        const serverInfo = await retryAsync(
          () => validateServerToken(plexServerUrl, identity.authenticationToken),
          isTransientPlexSetupError,
          SETUP_CONNECTION_RETRY,
        );

        await Promise.all([
          setConfig("plex_server_url", plexServerUrl),
          setConfig("plex_admin_token", identity.authenticationToken, true),
          setConfig("plex_machine_id", serverInfo.machineIdentifier),
        ]);
        // Evict after config is persisted so the id cannot be replayed on a
        // subsequent setup step. The oauth_discover branch intentionally omits
        // eviction because setup calls completeOAuth twice (discover, then complete).
        removePendingOAuth(oauthId);
        safeAuditSetupStep(
          adminUsername,
          "plex_configured",
          { mode: "oauth", machine_id: serverInfo.machineIdentifier },
          getClientAddress(),
        );
        return {
          success: true,
          friendlyName: serverInfo.friendlyName,
          machineIdentifier: serverInfo.machineIdentifier,
          version: serverInfo.version,
        };
      }

      return fail(400, { error: "Invalid plex mode" });
    } catch (err: unknown) {
      if (err instanceof PlexAuthError) {
        return fail(400, { error: "Invalid or expired Plex token" });
      }
      if (err instanceof PlexConnectionError) {
        const detail = err.message || "unknown error";
        return fail(400, { error: `Could not connect to Plex server: ${detail}` });
      }
      throw err;
    }
  },

  configureDispatcharr: async ({ request, cookies, getClientAddress }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const dcResult = DispatcharrConfigSchema.safeParse({
      dispatcharrUrl: sanitizeString(String(formData.get("dispatcharrUrl") ?? "")),
      dispatcharrApiKey: sanitizeString(String(formData.get("dispatcharrApiKey") ?? "")),
      dispatcharrExternalUrl: sanitizeString(String(formData.get("dispatcharrExternalUrl") ?? "")),
    });

    if (!dcResult.success) {
      return fail(400, {
        error: dcResult.error.issues[0]?.message ?? "Dispatcharr URL and API key are required",
      });
    }

    const { dispatcharrUrl, dispatcharrApiKey, dispatcharrExternalUrl } = dcResult.data;
    const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);

    let healthData: { reachable: boolean; authValid: boolean };
    try {
      healthData = await retryAsync(
        async () => {
          const result = await createHealthEndpoints(client).checkHealth();
          // checkHealth() normalizes all errors into { ok: true, data: { reachable, authValid } }.
          // The !ok guard satisfies the discriminated-union narrowing for TypeScript
          // but is not reachable at runtime.
          if (!result.ok) {
            throw new Error(result.message);
          }
          // Only network failures (reachable=false) are worth retrying —
          // auth and config issues won't self-resolve.
          if (!result.data.reachable) {
            throw new Error("Dispatcharr server is unreachable");
          }
          return result.data;
        },
        (err) => err instanceof Error && err.message === "Dispatcharr server is unreachable",
        SETUP_CONNECTION_RETRY,
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[setup] Dispatcharr connection failed after retries: ${detail}`);
      return fail(400, { error: "Could not connect to Dispatcharr after multiple attempts" });
    }

    if (!healthData.authValid) {
      return fail(400, { error: "Dispatcharr API key is invalid" });
    }

    await Promise.all([
      setConfig("dispatcharr_url", dispatcharrUrl),
      setConfig("dispatcharr_api_key", dispatcharrApiKey, true),
      setConfig("dispatcharr_external_url", dispatcharrExternalUrl ?? ""),
    ]);

    const [groupsResult, profilesResult] = await Promise.all([
      listChannelGroups(client),
      listProfiles(client),
    ]);

    const groups = groupsResult.ok
      ? groupsResult.data
          .filter((g) => !isQuarantineGroup(g.name))
          .map((g) => ({ id: g.id, name: g.name }))
      : [];
    const profiles = profilesResult.ok ? profilesResult.data : [];

    let xcProbe: { found: boolean; template?: string; probedPaths: string[] } | null = null;
    try {
      xcProbe = await probeXcSurface(dispatcharrUrl, "", "");
    } catch {
      // Probe is best-effort; ignore failures
    }

    const adminUsername = (await getConfig("admin_username")) ?? "setup-wizard";
    // Strip userinfo, query string, and fragment before persisting to the audit log
    // to prevent credentials or tokens embedded in the URL from leaking into audit_log.
    const auditUrl = (() => {
      const u = new URL(dispatcharrUrl);
      u.username = "";
      u.password = "";
      u.search = "";
      u.hash = "";
      return u.toString();
    })();
    safeAuditSetupStep(
      adminUsername,
      "dispatcharr_configured",
      {
        url: auditUrl,
        hasExternalUrl: Boolean(dispatcharrExternalUrl && dispatcharrExternalUrl.length > 0),
      },
      getClientAddress(),
    );

    return { success: true, groups, profiles, xcProbe };
  },

  configureOrigin: async ({ request, cookies, getClientAddress }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const originsResult = OriginsSchema.safeParse({
      allowedOrigins: sanitizeString(String(formData.get("allowedOrigins") ?? "")),
    });

    if (!originsResult.success) {
      return fail(400, {
        field: "allowedOrigins",
        error: originsResult.error.issues[0]?.message ?? "At least one origin is required",
      });
    }

    const { origins: normalizedOrigins, invalidOrigin } = parseAndNormalizeOrigins(
      originsResult.data.allowedOrigins,
      ",",
    );
    if (invalidOrigin) {
      return fail(400, { field: "allowedOrigins", error: `Invalid origin: ${invalidOrigin}` });
    }

    if (normalizedOrigins.length === 0) {
      return fail(400, { field: "allowedOrigins", error: "At least one origin is required" });
    }

    await setConfig("allowed_origins", JSON.stringify(normalizedOrigins));

    const adminUsername = (await getConfig("admin_username")) ?? "setup-wizard";
    safeAuditSetupStep(
      adminUsername,
      "origins_configured",
      { origins: normalizedOrigins },
      getClientAddress(),
    );

    return { success: true };
  },

  setDefaults: async ({ request, cookies, getClientAddress }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const missingPrerequisites = await getMissingSetupPrerequisites();
    if (missingPrerequisites.length > 0) {
      return fail(400, {
        error: "Complete Plex, Dispatcharr, and origin setup before finishing setup",
        field: "defaults",
        missingPrerequisites,
      });
    }

    const adminUsername = await getConfig("admin_username");
    if (!adminUsername || !adminExists()) {
      return fail(400, {
        error: "Admin account must be created before completing setup",
        field: "defaults",
      });
    }

    const formData = await request.formData();
    const defaultsResult = DefaultsSchema.safeParse({
      defaultGroupId: sanitizeString(String(formData.get("defaultGroupId") ?? "")),
      defaultProfileId: sanitizeString(String(formData.get("defaultProfileId") ?? "")),
      syncInterval: sanitizeString(String(formData.get("syncInterval") ?? "")),
      defaultProvisioningMode: sanitizeString(
        String(formData.get("defaultProvisioningMode") ?? ""),
      ),
    });

    if (!defaultsResult.success) {
      const issue = defaultsResult.error.issues[0];
      const field = issue?.path[0] as string | undefined;
      return fail(400, {
        error: issue?.message ?? "Invalid input",
        field: field ?? "syncInterval",
      });
    }

    const {
      defaultGroupId,
      defaultProfileId,
      syncInterval: syncMinutes,
      defaultProvisioningMode,
    } = defaultsResult.data;

    await Promise.all([
      setConfig("default_group_id", defaultGroupId ?? ""),
      setConfig("default_profile_id", defaultProfileId ?? ""),
      setConfig("sync_interval_minutes", String(syncMinutes)),
      setConfig("default_provisioning_mode", defaultProvisioningMode),
      setConfig(SETUP_COMPLETED_CONFIG_KEY, SETUP_COMPLETED_VALUE),
    ]);

    await Promise.all([
      setConfig(SETUP_CLAIMED_CONFIG_KEY, SETUP_UNCLAIMED_VALUE),
      setConfig(SETUP_CLAIM_PROOF_CONFIG_KEY, "", true),
      setConfig(SETUP_CLAIMED_AT_CONFIG_KEY, ""),
    ]);
    clearBootstrapToken();
    cookies.delete(SETUP_CLAIM_COOKIE_NAME, { path: SETUP_CLAIM_COOKIE_OPTIONS.path });

    seedInitialHealth();

    const priorSessionId = cookies.get(SESSION_COOKIE_NAME);
    if (priorSessionId) {
      deleteSession(priorSessionId);
    }
    const sessionId = createSession(adminUsername, "admin", ADMIN_SESSION_TTL);
    cookies.set(SESSION_COOKIE_NAME, sessionId, ADMIN_COOKIE_OPTIONS);

    appendAuditLog({
      actor: adminUsername,
      action: AuditAction.SETUP_COMPLETED,
      detail: {
        defaultGroupId,
        defaultProfileId,
        syncInterval: syncMinutes,
        defaultProvisioningMode,
      },
      ipAddress: getClientAddress(),
    });

    redirect(303, POST_SETUP_REDIRECT_PATH);
  },
};
