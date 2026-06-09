import type { Actions, RequestEvent } from "@sveltejs/kit";
import { fail, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { rotateCredentialsForMappingId } from "$lib/bridge/lifecycle";
import { decrypt } from "$lib/crypto/encryption";
import { getConfig } from "$lib/db/repositories/config";
import { updateLastAccessed } from "$lib/db/repositories/users";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { initiateOAuth } from "$lib/plex/oauth";
import { PlexAuthError } from "$lib/plex/types";
import { isSecure, requireUser } from "$lib/server/auth";
import {
  INITIAL_PASSWORD_COOKIE_NAME,
  openInitialPasswordFlash,
} from "$lib/server/initial-password-flash";
import { selectActivePublicOrigin } from "$lib/server/origins";
import { oauthLimiter } from "$lib/server/ratelimit";
import { getFredTvAssets } from "$lib/url/github-releases.server";
import {
  buildPlatformUrl,
  getSupportedPlatforms,
  type InstallMethod,
  type Platform,
  type PlatformInfo,
  type PlatformUrlResult,
  resolveInstallMethods,
} from "$lib/url/platforms";
import { getDispatcharrPublicUrl } from "$lib/url/resolve.server";
import { buildPlayerApiUrl, buildXcUrl } from "$lib/url/xc";
import { generateQRCodeDataUri } from "$lib/utils/qrcode";
import { isTransientPlexError, type RetryOptions, retryAsync } from "$lib/utils/retry";

const OAUTH_COOKIE_NAME = "otpravkarr_oauth_id";
const OAUTH_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  maxAge: 600,
};
const OAUTH_INITIATE_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  jitter: 0.5,
};

interface PlatformEntry {
  id: Platform;
  name: string;
  description: string;
  tier: PlatformInfo["tier"];
  supportedOS: PlatformInfo["supportedOS"];
  homepageUrl: string;
  setupInstructions: string;
  installMethods: InstallMethod[];
  result: PlatformUrlResult;
}

export const load = async ({ locals, cookies }: RequestEvent) => {
  // Revoked (inactive) users see a different view. sessionResolver routes
  // inactive mappings to locals.revokedUser, keeping locals.user active-only.
  if (locals.revokedUser) {
    return { authenticated: true as const, revoked: true as const };
  }

  if (!locals.user) {
    return { authenticated: false as const };
  }

  const user = locals.user;

  updateLastAccessed(user.id);

  // Self-managed / staff users see Dispatcharr info only
  if (user.provisioning_mode !== "automatic") {
    const initialPasswordCookie = cookies.get(INITIAL_PASSWORD_COOKIE_NAME);
    let initialPassword: string | null = null;
    if (initialPasswordCookie) {
      cookies.delete(INITIAL_PASSWORD_COOKIE_NAME, { path: "/" });
      initialPassword = await openInitialPasswordFlash(initialPasswordCookie);
    }

    const dispatcharrUrl = await getDispatcharrPublicUrl();
    return {
      authenticated: true as const,
      mode: user.provisioning_mode as "self_managed" | "staff",
      dispatcharrUsername: user.dispatcharr_username,
      dispatcharrUrl,
      initialPassword,
    };
  }

  // Automatic mode — build streaming URLs
  if (!user.dispatcharr_xc_password_enc) {
    return {
      authenticated: true as const,
      mode: "automatic" as const,
      error: "Credentials are not yet provisioned. Please contact the server admin.",
    };
  }

  const password = await decrypt(user.dispatcharr_xc_password_enc, "credential-encryption");
  const host = await getDispatcharrPublicUrl();
  if (!host) {
    return {
      authenticated: true as const,
      mode: "automatic" as const,
      error:
        "A HTTPS Dispatcharr public URL is required before streaming credentials can be generated.",
    };
  }
  const username = user.dispatcharr_username ?? "";

  const xcParams = { host, username, password };
  const xcUrl = buildXcUrl(xcParams);
  const playerApiUrl = buildPlayerApiUrl(xcParams);
  const qrCodeDataUri = await generateQRCodeDataUri(xcUrl);

  const fredTvAssets = await getFredTvAssets();
  const platforms = getSupportedPlatforms();
  const platformUrls: PlatformEntry[] = platforms.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    tier: p.tier,
    supportedOS: p.supportedOS,
    homepageUrl: p.homepageUrl,
    setupInstructions: p.setupInstructions,
    installMethods: resolveInstallMethods(p.id, fredTvAssets),
    result: buildPlatformUrl(p.id, xcParams),
  }));

  return {
    authenticated: true as const,
    mode: "automatic" as const,
    xcUrl,
    playerApiUrl,
    qrCodeDataUri,
    platformUrls,
    dispatcharrUsername: username,
  };
};

export const actions: Actions = {
  signInWithPlex: async ({ url, cookies, getClientAddress }) => {
    const clientAddress = getClientAddress();
    const limit = oauthLimiter.check(clientAddress);
    if (!limit.allowed) {
      return fail(429, { error: "rate_limited" });
    }

    try {
      const forwardOrigin = selectActivePublicOrigin(env.ORIGIN, url.origin);
      const forwardUrl = `${forwardOrigin}/auth/plex`;

      const result = await retryAsync(
        () => initiateOAuth(forwardUrl),
        isTransientPlexError,
        OAUTH_INITIATE_RETRY,
      );

      cookies.set(OAUTH_COOKIE_NAME, result.id, OAUTH_COOKIE_OPTIONS);

      throw redirect(303, result.uri);
    } catch (err: unknown) {
      if (err instanceof PlexAuthError) {
        if (isTransientPlexError(err)) {
          return fail(502, { error: "plex_unreachable" });
        }
        return fail(502, { error: "plex_error", message: err.message });
      }
      throw err;
    }
  },

  refreshCredentials: async (event) => {
    // requireUser handles anon/non-user/inactive (303 → "/" + cookie cleanup)
    // and guarantees an active mapping for the rotation below.
    const user = await requireUser(event);

    if (user.provisioning_mode !== "automatic") {
      return fail(400, { error: "not_automatic_mode" });
    }

    try {
      const dispatcharrUrl = await getConfig("dispatcharr_url");
      const dispatcharrApiKey = await getConfig("dispatcharr_api_key");

      if (!dispatcharrUrl || !dispatcharrApiKey) {
        return fail(500, { error: "config_missing" });
      }

      const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
      await rotateCredentialsForMappingId(client, user.id, {
        actor: user.plex_username,
        ipAddress: event.getClientAddress(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to refresh credentials";
      return fail(500, { error: "refresh_failed", message });
    }

    throw redirect(303, "/");
  },
};
