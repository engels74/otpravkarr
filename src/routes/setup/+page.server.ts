import { type Cookies, fail, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { clearBootstrapToken, validateBootstrapToken } from "$lib/crypto/bootstrap";
import { hashAdminPassword } from "$lib/crypto/passwords";
import { createAdmin as insertAdmin } from "$lib/db/repositories/admin";
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
} from "$lib/server/auth";
import { setupLimiter } from "$lib/server/ratelimit";
import { probeXcSurface } from "$lib/url/discover";
import type { Actions, PageServerLoad } from "./$types";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 12;
const SETUP_CLAIMED_CONFIG_KEY = "setup_claimed";
const SETUP_CLAIM_PROOF_CONFIG_KEY = "setup_claim_proof";
const SETUP_CLAIMED_VALUE = "true";
const SETUP_UNCLAIMED_VALUE = "false";
const SETUP_CLAIM_COOKIE_NAME = "otpravkarr_setup_claim";
const SETUP_CLAIM_TTL_SECONDS = 30 * 60;
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

async function hasActiveSetupClaim(cookies: Cookies): Promise<boolean> {
  if (!(await isSetupClaimed())) {
    return false;
  }

  const expectedProof = await getConfig(SETUP_CLAIM_PROOF_CONFIG_KEY);
  if (!expectedProof) {
    return false;
  }

  const claimProof = cookies.get(SETUP_CLAIM_COOKIE_NAME);
  return claimProof !== undefined && claimProof === expectedProof;
}

async function requireSetupClaimedAction(cookies: Cookies) {
  if (await hasActiveSetupClaim(cookies)) {
    return null;
  }

  return fail(403, { error: "setup_not_claimed" });
}

export const load: PageServerLoad = async ({ url, cookies }) => {
  requireSetupIncomplete();

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
      return { success: true };
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

    const formData = await request.formData();
    const defaultGroupId = String(formData.get("defaultGroupId") ?? "").trim();
    const defaultProfileId = String(formData.get("defaultProfileId") ?? "").trim();
    const syncInterval = String(formData.get("syncInterval") ?? "").trim();
    const defaultProvisioningMode = String(formData.get("defaultProvisioningMode") ?? "").trim();
    const adminUsername = String(formData.get("adminUsername") ?? "").trim();
    const adminPassword = String(formData.get("adminPassword") ?? "");

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

    if (!USERNAME_PATTERN.test(adminUsername)) {
      return fail(400, {
        error: "Username must be 3-32 characters (letters, numbers, underscore, dash)",
        field: "adminUsername",
      });
    }

    if (adminPassword.length < MIN_PASSWORD_LENGTH) {
      return fail(400, {
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        field: "adminPassword",
      });
    }

    await Promise.all([
      setConfig("default_group_id", defaultGroupId),
      setConfig("default_profile_id", defaultProfileId),
      setConfig("sync_interval_minutes", String(syncMinutes)),
      setConfig("default_provisioning_mode", defaultProvisioningMode),
    ]);

    const adminPasswordHash = await hashAdminPassword(adminPassword);
    try {
      insertAdmin(adminUsername, adminPasswordHash);
    } catch {
      return fail(400, {
        error: "Admin account could not be created",
        field: "adminUsername",
      });
    }

    await Promise.all([
      setConfig(SETUP_CLAIMED_CONFIG_KEY, SETUP_UNCLAIMED_VALUE),
      setConfig(SETUP_CLAIM_PROOF_CONFIG_KEY, "", true),
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

    redirect(303, "/dashboard");
  },
};
