import { error, fail, redirect } from "@sveltejs/kit";
import { provisionUser } from "$lib/bridge/provisioner";
import { getConfig } from "$lib/db/repositories/config";
import { createSession, deleteSession } from "$lib/db/repositories/sessions";
import { getUserMappingByPlexId, updateLastAccessed } from "$lib/db/repositories/users";
import type { ProvisioningMode } from "$lib/db/types";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { listChannelGroups } from "$lib/dispatcharr/endpoints/channel-groups";
import type { DispatcharrChannelGroup } from "$lib/dispatcharr/types";
import { getAccount } from "$lib/plex/client";
import { fetchFriends } from "$lib/plex/friends";
import { completeOAuth, removePendingOAuth } from "$lib/plex/oauth";
import { PlexAuthError, type PlexIdentity } from "$lib/plex/types";
import {
  ADMIN_COOKIE_OPTIONS,
  ADMIN_SESSION_TTL,
  getConfiguredAdminAccount,
  isSecure,
  SESSION_COOKIE_NAME,
  USER_COOKIE_OPTIONS,
  USER_SESSION_TTL,
} from "$lib/server/auth";
import {
  INITIAL_PASSWORD_COOKIE_MAX_AGE,
  INITIAL_PASSWORD_COOKIE_NAME,
  sealInitialPasswordFlash,
} from "$lib/server/initial-password-flash";
import {
  ONBOARDING_COOKIE_MAX_AGE,
  ONBOARDING_COOKIE_NAME,
  type OnboardingIdentity,
  openOnboardingIdentity,
  sealOnboardingIdentity,
} from "$lib/server/onboarding-flash";
import {
  computeOfferedGroups,
  defaultSelectedGroupIds,
  getSubscriptionDefaults,
} from "$lib/server/subscription-config";
import { isTransientResultError, retryResult } from "$lib/utils/retry";
import type { Actions, PageServerLoad } from "./$types";

const OAUTH_COOKIE_NAME = "otpravkarr_oauth_id";
const OAUTH_COOKIE_DELETE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
};
const INITIAL_PASSWORD_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  maxAge: INITIAL_PASSWORD_COOKIE_MAX_AGE,
};
const ONBOARDING_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  maxAge: ONBOARDING_COOKIE_MAX_AGE,
};

interface OfferedGroup {
  id: number;
  name: string;
  channelCount: number | null;
}

interface PickerData {
  picker: true;
  plexUsername: string;
  offered: OfferedGroup[];
  selected: number[];
}

function toOfferedGroup(g: DispatcharrChannelGroup): OfferedGroup {
  return { id: g.id, name: g.name, channelCount: g.channel_count ?? null };
}

/** Build a Dispatcharr client from config, or throw a 500 (load context). */
async function buildDispatcharrClient(): Promise<DispatcharrClient> {
  const [url, key] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
  ]);
  if (!url || !key) {
    throw error(500, "Server configuration incomplete: missing Dispatcharr settings");
  }
  return new DispatcharrClient(url, key);
}

async function resolveProvisioningMode(): Promise<ProvisioningMode> {
  const mode = await getConfig("default_provisioning_mode");
  return mode === "self_managed" ? "self_managed" : "automatic";
}

/**
 * Fetch the offered (non-quarantine, admin-permitted) groups for onboarding.
 * Fails closed: a transient Dispatcharr error throws 502 rather than provisioning
 * against an empty offered set.
 */
async function fetchOfferedGroups(
  client: DispatcharrClient,
): Promise<{ groups: DispatcharrChannelGroup[]; allowSelfSelect: boolean }> {
  const defaults = await getSubscriptionDefaults();
  const groupsResult = await retryResult(() => listChannelGroups(client), isTransientResultError);
  if (!groupsResult.ok) {
    console.error("[auth/plex] Failed to list channel groups:", groupsResult.error);
    throw error(502, "Unable to set up your account. Please contact the administrator.");
  }
  return {
    groups: computeOfferedGroups(groupsResult.data, defaults),
    allowSelfSelect: defaults.allowSelfSelect,
  };
}

/**
 * Provision (or reactivate / no-op) the user, establish their session, stash the
 * one-time initial password for the landing page, and redirect to the portal.
 * Always throws (redirect on success, HttpError on failure).
 */
async function provisionAndRedirect(
  cookies: Parameters<PageServerLoad>[0]["cookies"],
  client: DispatcharrClient,
  identity: PlexIdentity,
  mode: ProvisioningMode,
  groupIds: number[],
  clientAddress: string,
): Promise<never> {
  const result = await provisionUser(
    client,
    { plexIdentity: identity, mode, groupIds },
    { actor: identity.username, ipAddress: clientAddress },
  );

  if (result.status === "failed") {
    console.error("[auth/plex] Provisioning failed for Plex user:", result.error);
    throw error(502, "Unable to set up your account. Please contact the administrator.");
  }

  const mapping = result.mapping;
  const priorSessionId = cookies.get(SESSION_COOKIE_NAME);
  if (priorSessionId) {
    deleteSession(priorSessionId);
  }
  const sessionId = createSession(String(mapping.id), "user", USER_SESSION_TTL);
  cookies.set(SESSION_COOKIE_NAME, sessionId, USER_COOKIE_OPTIONS);

  const initialPassword = result.status === "provisioned" ? result.initialPassword : undefined;
  if (initialPassword) {
    cookies.set(
      INITIAL_PASSWORD_COOKIE_NAME,
      await sealInitialPasswordFlash(initialPassword),
      INITIAL_PASSWORD_COOKIE_OPTIONS,
    );
  }

  updateLastAccessed(mapping.id);
  throw redirect(303, "/");
}

export const load: PageServerLoad = async ({ cookies, getClientAddress }) => {
  const oauthId = cookies.get(OAUTH_COOKIE_NAME);

  // Refresh-safe picker re-render. The OAuth handoff is single-use (the pending
  // store + cookie are consumed on first load), so on a page refresh there is no
  // oauth_id. If the verified-identity onboarding cookie is still valid, re-render
  // the picker from it instead of erroring. This is display-only; the confirm
  // action re-verifies friend status before provisioning.
  if (!oauthId) {
    const onboardingCookie = cookies.get(ONBOARDING_COOKIE_NAME);
    if (onboardingCookie) {
      const identity = await openOnboardingIdentity(onboardingCookie);
      if (identity) {
        const client = await buildDispatcharrClient();
        const { groups } = await fetchOfferedGroups(client);
        return {
          picker: true,
          plexUsername: identity.username,
          offered: groups.map(toOfferedGroup),
          selected: defaultSelectedGroupIds(groups),
        } satisfies PickerData;
      }
      // Stale/tampered onboarding cookie: clear it so the user isn't stuck on a
      // 400 until it naturally expires; a fresh sign-in then starts clean.
      cookies.delete(ONBOARDING_COOKIE_NAME, OAUTH_COOKIE_DELETE_OPTIONS);
    }
    throw error(400, "Missing OAuth session. Please try signing in again.");
  }

  // Fresh OAuth handoff — consume the cookie immediately.
  cookies.delete(OAUTH_COOKIE_NAME, OAUTH_COOKIE_DELETE_OPTIONS);

  let identity: PlexIdentity;
  try {
    identity = await completeOAuth(oauthId);
  } catch (err: unknown) {
    if (err instanceof PlexAuthError) {
      throw error(400, "Plex sign-in failed. Please try again.");
    }
    throw err;
  }
  // Evict server-side cache immediately after resolving identity so the same
  // oauth_id cannot be replayed even if a later step fails.
  removePendingOAuth(oauthId);

  const plexAdminToken = await getConfig("plex_admin_token");
  if (!plexAdminToken) {
    throw error(500, "Server configuration incomplete: missing Plex admin token");
  }

  const account = await getAccount(plexAdminToken);
  const isServerOwner = account.id === identity.id;

  if (isServerOwner) {
    const admin = await getConfiguredAdminAccount();
    if (!admin) {
      throw error(500, "Server configuration incomplete: missing admin account");
    }

    const priorSessionId = cookies.get(SESSION_COOKIE_NAME);
    if (priorSessionId) {
      deleteSession(priorSessionId);
    }
    const sessionId = createSession(admin.username, "admin", ADMIN_SESSION_TTL);
    cookies.set(SESSION_COOKIE_NAME, sessionId, ADMIN_COOKIE_OPTIONS);

    throw redirect(303, "/dashboard");
  }

  const friends = await fetchFriends(account);
  const hasAcceptedAccess = friends.some(
    (friend) => friend.id === identity.id && friend.status.trim().toLowerCase() === "accepted",
  );
  if (!hasAcceptedAccess) {
    throw error(403, "Your Plex account does not have access to this server");
  }

  const existingMapping = getUserMappingByPlexId(identity.id);
  if (existingMapping?.is_active === 0) {
    throw error(403, "Your access to this server has been revoked");
  }

  const client = await buildDispatcharrClient();
  const { groups: offeredGroups, allowSelfSelect } = await fetchOfferedGroups(client);
  const defaultGroupIds = defaultSelectedGroupIds(offeredGroups);

  // Mandatory pre-credential group picker for brand-new friends who are allowed
  // to self-select and have something to choose from. Seal the verified identity
  // and hand off to the picker; provisioning + credentials happen on confirm.
  const isNewUser = existingMapping == null;
  if (isNewUser && allowSelfSelect && offeredGroups.length > 0) {
    cookies.set(ONBOARDING_COOKIE_NAME, await sealOnboardingIdentity(identity), {
      ...ONBOARDING_COOKIE_OPTIONS,
    });
    return {
      picker: true,
      plexUsername: identity.username,
      offered: offeredGroups.map(toOfferedGroup),
      selected: defaultGroupIds,
    } satisfies PickerData;
  }

  // No picker (returning user re-login, self-select disabled, or nothing to
  // offer): provision immediately with the admin defaults and reveal credentials.
  cookies.delete(ONBOARDING_COOKIE_NAME, OAUTH_COOKIE_DELETE_OPTIONS);
  const mode = await resolveProvisioningMode();
  return provisionAndRedirect(cookies, client, identity, mode, defaultGroupIds, getClientAddress());
};

export const actions: Actions = {
  // Finalize onboarding for a new friend: validate their group selection,
  // re-verify Plex friend status (the sealed cookie is a carrier, not a trust
  // root), then provision and reveal credentials.
  confirm: async ({ cookies, request, getClientAddress }) => {
    const onboardingCookie = cookies.get(ONBOARDING_COOKIE_NAME);
    const identity: OnboardingIdentity | null = onboardingCookie
      ? await openOnboardingIdentity(onboardingCookie)
      : null;
    if (!identity) {
      // Clear a stale/tampered cookie so the user isn't stuck re-submitting against it.
      if (onboardingCookie) {
        cookies.delete(ONBOARDING_COOKIE_NAME, OAUTH_COOKIE_DELETE_OPTIONS);
      }
      return fail(400, { error: "Your sign-in session expired. Please sign in again." });
    }

    // Parse + validate the submitted selection (positive integers only).
    const raw = String((await request.formData()).get("group_ids") ?? "[]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(400, { error: "Invalid selection." });
    }
    if (!Array.isArray(parsed) || !parsed.every((v): v is number => Number.isInteger(v) && v > 0)) {
      return fail(400, { error: "Invalid selection." });
    }
    const requestedIds = [...new Set(parsed as number[])];

    // Re-verify identity + friend status against Plex.
    const plexAdminToken = await getConfig("plex_admin_token");
    if (!plexAdminToken) {
      return fail(500, { error: "Server configuration incomplete. Contact the administrator." });
    }
    let account: Awaited<ReturnType<typeof getAccount>>;
    try {
      account = await getAccount(plexAdminToken);
    } catch {
      return fail(502, { error: "Couldn't reach Plex. Please try again." });
    }
    if (account.id === identity.id) {
      // The server owner is handled in load; they should never reach confirm.
      cookies.delete(ONBOARDING_COOKIE_NAME, OAUTH_COOKIE_DELETE_OPTIONS);
      return fail(400, { error: "Please sign in again." });
    }
    let friends: Awaited<ReturnType<typeof fetchFriends>>;
    try {
      friends = await fetchFriends(account);
    } catch {
      return fail(502, { error: "Couldn't reach Plex. Please try again." });
    }
    const hasAcceptedAccess = friends.some(
      (friend) => friend.id === identity.id && friend.status.trim().toLowerCase() === "accepted",
    );
    if (!hasAcceptedAccess) {
      return fail(403, { error: "Your Plex account does not have access to this server." });
    }
    const existingMapping = getUserMappingByPlexId(identity.id);
    if (existingMapping?.is_active === 0) {
      return fail(403, { error: "Your access to this server has been revoked." });
    }

    const [url, key] = await Promise.all([
      getConfig("dispatcharr_url"),
      getConfig("dispatcharr_api_key"),
    ]);
    if (!url || !key) {
      return fail(500, { error: "Server configuration incomplete. Contact the administrator." });
    }
    const client = new DispatcharrClient(url, key);

    // Re-derive the offered set server-side and reject anything outside it — the
    // client must not be trusted to post only offered IDs. Fail closed.
    const defaults = await getSubscriptionDefaults();
    const groupsResult = await retryResult(() => listChannelGroups(client), isTransientResultError);
    if (!groupsResult.ok) {
      return fail(502, { error: "Unable to set up your account. Please try again." });
    }
    const offeredIds = new Set(computeOfferedGroups(groupsResult.data, defaults).map((g) => g.id));
    if (!requestedIds.every((id) => offeredIds.has(id))) {
      return fail(400, { error: "Invalid selection." });
    }

    const mode = await resolveProvisioningMode();
    // Consume the onboarding cookie before provisioning so a refresh can't replay.
    cookies.delete(ONBOARDING_COOKIE_NAME, OAUTH_COOKIE_DELETE_OPTIONS);

    // provisionUser only reads identity id/uuid/username/email/thumb; the Plex
    // auth token is intentionally absent from the sealed cookie.
    const fullIdentity: PlexIdentity = { ...identity, authenticationToken: "" };
    return provisionAndRedirect(
      cookies,
      client,
      fullIdentity,
      mode,
      requestedIds,
      getClientAddress(),
    );
  },
};
