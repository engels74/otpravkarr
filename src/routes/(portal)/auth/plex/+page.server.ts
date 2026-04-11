import { error, redirect } from "@sveltejs/kit";
import { provisionUser } from "$lib/bridge/provisioner";
import { getConfig } from "$lib/db/repositories/config";
import { createSession } from "$lib/db/repositories/sessions";
import { getUserMappingByPlexId, updateLastAccessed } from "$lib/db/repositories/users";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { getAccount } from "$lib/plex/client";
import { fetchFriends } from "$lib/plex/friends";
import { completeOAuth } from "$lib/plex/oauth";
import { PlexAuthError, type PlexIdentity } from "$lib/plex/types";
import {
  isSecure,
  SESSION_COOKIE_NAME,
  USER_COOKIE_OPTIONS,
  USER_SESSION_TTL,
} from "$lib/server/auth";
import type { PageServerLoad } from "./$types";

const OAUTH_COOKIE_NAME = "otpravkarr_oauth_id";
const INITIAL_PASSWORD_COOKIE_NAME = "otpravkarr_initial_password";
const INITIAL_PASSWORD_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  maxAge: 120,
};

export const load: PageServerLoad = async ({ cookies }) => {
  // 1. Read OAuth ID from cookie, then delete it
  const oauthId = cookies.get(OAUTH_COOKIE_NAME);
  cookies.delete(OAUTH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
  });

  if (!oauthId) {
    throw error(400, "Missing OAuth session. Please try signing in again.");
  }

  // 2. Complete OAuth — get PlexIdentity
  let identity: PlexIdentity;
  try {
    identity = await completeOAuth(oauthId);
  } catch (err: unknown) {
    if (err instanceof PlexAuthError) {
      throw error(400, "Plex sign-in failed. Please try again.");
    }
    throw err;
  }

  // 3. Verify friend status
  const plexAdminToken = await getConfig("plex_admin_token");
  if (!plexAdminToken) {
    throw error(500, "Server configuration incomplete: missing Plex admin token");
  }

  const account = await getAccount(plexAdminToken);
  const isServerOwner = account.id === identity.id;

  if (!isServerOwner) {
    const friends = await fetchFriends(account);

    const hasAcceptedAccess = friends.some(
      (friend) => friend.id === identity.id && friend.status.trim().toLowerCase() === "accepted",
    );

    if (!hasAcceptedAccess) {
      throw error(403, "Your Plex account does not have access to this server");
    }
  }

  const existingMapping = getUserMappingByPlexId(identity.id);
  if (existingMapping?.is_active === 0) {
    throw error(403, "Your access to this server has been revoked");
  }

  // 4. Provision user
  const [
    dispatcharrUrl,
    dispatcharrApiKey,
    defaultGroupId,
    defaultProfileId,
    defaultProvisioningMode,
  ] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
    getConfig("default_group_id"),
    getConfig("default_profile_id"),
    getConfig("default_provisioning_mode"),
  ]);

  if (!dispatcharrUrl || !dispatcharrApiKey) {
    throw error(500, "Server configuration incomplete: missing Dispatcharr settings");
  }

  const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
  const mode = defaultProvisioningMode === "self_managed" ? "self_managed" : "automatic";
  const groupIds = defaultGroupId ? [Number(defaultGroupId)] : [];
  const profileId = defaultProfileId ? Number(defaultProfileId) : undefined;

  const result = await provisionUser(client, {
    plexIdentity: identity,
    mode,
    groupIds,
    profileId,
  });

  if (result.status === "failed") {
    console.error("[auth/plex] Provisioning failed for Plex user:", result.error);
    throw error(502, "Unable to set up your account. Please contact the administrator.");
  }

  // 5. Create session
  const mapping = result.mapping;
  const sessionId = createSession(String(mapping.id), "user", USER_SESSION_TTL);
  cookies.set(SESSION_COOKIE_NAME, sessionId, USER_COOKIE_OPTIONS);

  if (result.status === "provisioned" && result.initialPassword) {
    cookies.set(
      INITIAL_PASSWORD_COOKIE_NAME,
      result.initialPassword,
      INITIAL_PASSWORD_COOKIE_OPTIONS,
    );
  }

  // Update last accessed timestamp
  updateLastAccessed(mapping.id);

  // 6. Redirect — server owner goes to /welcome, regular users to /
  throw redirect(303, isServerOwner ? "/welcome" : "/");
};
