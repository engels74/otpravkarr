import { type Cookies, fail, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { clearBootstrapToken, validateBootstrapToken } from "$lib/crypto/bootstrap";
import { hashAdminPassword } from "$lib/crypto/passwords";
import { adminExists, createAdmin as insertAdmin } from "$lib/db/repositories/admin";
import { appendAuditLog } from "$lib/db/repositories/audit";
import { getConfig, setConfig } from "$lib/db/repositories/config";
import { createSession } from "$lib/db/repositories/sessions";
import { AuditAction } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listGroups } from "$lib/dispatcharr/endpoints/groups";
import { createHealthEndpoints } from "$lib/dispatcharr/endpoints/health";
import { listProfiles } from "$lib/dispatcharr/endpoints/profiles";
import { validateServerToken } from "$lib/plex/client";
import { completeOAuth, initiateOAuth } from "$lib/plex/oauth";
import { PlexAuthError, PlexConnectionError } from "$lib/plex/types";
import {
  ADMIN_COOKIE_OPTIONS,
  ADMIN_SESSION_TTL,
  requireSetupIncomplete,
  SESSION_COOKIE_NAME,
  SETUP_COMPLETED_CONFIG_KEY,
} from "$lib/server/auth";
import { setupLimiter } from "$lib/server/ratelimit";
import { probeXcSurface } from "$lib/url/discover";
import type { Actions, PageServerLoad } from "./$types";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 12;
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
const SETUP_CLAIM_COOKIE_OPTIONS = {
  path: "/setup",
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  maxAge: SETUP_CLAIM_TTL_SECONDS,
};

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
  if (!Number.isFinite(claimTimestamp) || Date.now() >= claimTimestamp + SETUP_CLAIM_TTL_MS) {
    return null;
  }

  return expectedProof;
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

export const load: PageServerLoad = async ({ url, cookies }) => {
  await requireSetupIncomplete();

  const tokenFromUrl = url.searchParams.get("token");
  const claimActive = await hasActiveSetupClaim(cookies);

  return {
    tokenProvided: tokenFromUrl !== null,
    tokenFromUrl,
    claimActive,
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
    const token = String(formData.get("token") ?? "");

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

    return { success: true };
  },

  createAdmin: async ({ request, cookies }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!USERNAME_PATTERN.test(username)) {
      return fail(400, {
        error: "Username must be 3-32 characters (letters, numbers, underscore, dash)",
        field: "username",
      });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(400, {
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        field: "password",
      });
    }

    if (password !== confirmPassword) {
      return fail(400, {
        error: "Passwords do not match",
        field: "confirmPassword",
      });
    }

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

    return { success: true };
  },

  configurePlex: async ({ request, url, cookies }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const plexMode = String(formData.get("plexMode") ?? "");

    try {
      if (plexMode === "token") {
        const plexToken = String(formData.get("plexToken") ?? "").trim();
        const plexServerUrl = String(formData.get("plexServerUrl") ?? "").trim();

        if (!plexToken || !plexServerUrl) {
          return fail(400, { error: "Plex token and server URL are required" });
        }

        const serverInfo = await validateServerToken(plexServerUrl, plexToken);

        await Promise.all([
          setConfig("plex_server_url", plexServerUrl),
          setConfig("plex_admin_token", plexToken, true),
          setConfig("plex_machine_id", serverInfo.machineIdentifier),
        ]);
        return {
          success: true,
          friendlyName: serverInfo.friendlyName,
          machineIdentifier: serverInfo.machineIdentifier,
          version: serverInfo.version,
        };
      }

      if (plexMode === "oauth_initiate") {
        const configuredOrigin = env.ORIGIN?.trim();
        const forwardOrigin =
          configuredOrigin && configuredOrigin.length > 0 ? configuredOrigin : url.origin;
        const forwardUrl = `${forwardOrigin.replace(/\/$/, "")}/setup`;
        const result = await initiateOAuth(forwardUrl);
        return {
          success: true,
          oauthId: result.id,
          oauthUri: result.uri,
        };
      }

      if (plexMode === "oauth_complete") {
        const oauthId = String(formData.get("oauthId") ?? "").trim();
        const plexServerUrl = String(formData.get("plexServerUrl") ?? "").trim();

        if (!oauthId) {
          return fail(400, { error: "OAuth session ID is required" });
        }

        if (!plexServerUrl) {
          return fail(400, { error: "Plex server URL is required" });
        }

        const identity = await completeOAuth(oauthId);
        const serverInfo = await validateServerToken(plexServerUrl, identity.authenticationToken);

        await Promise.all([
          setConfig("plex_server_url", plexServerUrl),
          setConfig("plex_admin_token", identity.authenticationToken, true),
          setConfig("plex_machine_id", serverInfo.machineIdentifier),
        ]);
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
        return fail(400, { error: err.message });
      }
      if (err instanceof PlexConnectionError) {
        return fail(400, { error: err.message });
      }
      throw err;
    }
  },

  configureDispatcharr: async ({ request, cookies }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const dispatcharrUrl = String(formData.get("dispatcharrUrl") ?? "").trim();
    const dispatcharrApiKey = String(formData.get("dispatcharrApiKey") ?? "").trim();

    if (!dispatcharrUrl || !dispatcharrApiKey) {
      return fail(400, { error: "Dispatcharr URL and API key are required" });
    }

    const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);

    const healthResult = await createHealthEndpoints(client).checkHealth();
    if (!healthResult.ok) {
      return fail(400, { error: "Could not connect to Dispatcharr" });
    }

    if (!healthResult.data.reachable) {
      return fail(400, { error: "Dispatcharr server is unreachable" });
    }

    if (!healthResult.data.authValid) {
      return fail(400, { error: "Dispatcharr API key is invalid" });
    }

    await Promise.all([
      setConfig("dispatcharr_url", dispatcharrUrl),
      setConfig("dispatcharr_api_key", dispatcharrApiKey, true),
    ]);

    const [groupsResult, profilesResult] = await Promise.all([
      listGroups(client),
      listProfiles(client),
    ]);

    const groups = groupsResult.ok ? groupsResult.data : [];
    const profiles = profilesResult.ok ? profilesResult.data : [];

    let xcProbe: { found: boolean; template?: string; probedPaths: string[] } | null = null;
    try {
      xcProbe = await probeXcSurface(dispatcharrUrl, "test", "test");
    } catch {
      // Probe is best-effort; ignore failures
    }

    return { success: true, groups, profiles, xcProbe };
  },

  configureOrigin: async ({ request, cookies }) => {
    const claimError = await requireSetupClaimedAction(cookies);
    if (claimError) {
      return claimError;
    }

    const formData = await request.formData();
    const rawOrigins = String(formData.get("allowedOrigins") ?? "");

    const origins = rawOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    const normalizedOrigins: string[] = [];

    for (const origin of origins) {
      try {
        const parsedOrigin = new URL(origin).origin;
        if (parsedOrigin === "null") {
          return fail(400, { error: `Invalid origin: ${origin}` });
        }
        normalizedOrigins.push(parsedOrigin);
      } catch {
        return fail(400, { error: `Invalid origin: ${origin}` });
      }
    }

    await setConfig("allowed_origins", JSON.stringify(normalizedOrigins));

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
    const defaultGroupId = String(formData.get("defaultGroupId") ?? "").trim();
    const defaultProfileId = String(formData.get("defaultProfileId") ?? "").trim();
    const syncInterval = String(formData.get("syncInterval") ?? "").trim();
    const defaultProvisioningMode = String(formData.get("defaultProvisioningMode") ?? "").trim();

    const syncMinutes = Number(syncInterval);
    if (!Number.isFinite(syncMinutes) || syncMinutes < 1 || syncMinutes > 1440) {
      return fail(400, {
        error: "Sync interval must be a number between 1 and 1440",
        field: "syncInterval",
      });
    }

    if (defaultProvisioningMode !== "automatic" && defaultProvisioningMode !== "self_managed") {
      return fail(400, {
        error: "Provisioning mode must be 'automatic' or 'self_managed'",
        field: "defaultProvisioningMode",
      });
    }

    await Promise.all([
      setConfig("default_group_id", defaultGroupId),
      setConfig("default_profile_id", defaultProfileId),
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
