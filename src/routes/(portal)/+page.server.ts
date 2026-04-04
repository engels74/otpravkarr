import type { Actions, RequestEvent } from "@sveltejs/kit";
import { fail, redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { rotateCredentials } from "$lib/bridge/lifecycle";
import { decrypt } from "$lib/crypto/encryption";
import { getConfig } from "$lib/db/repositories/config";
import { updateLastAccessed } from "$lib/db/repositories/users";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { createChannelEndpoints } from "$lib/dispatcharr/endpoints/channels";
import { initiateOAuth } from "$lib/plex/oauth";
import { PlexAuthError } from "$lib/plex/types";
import { isSecure } from "$lib/server/auth";
import { oauthLimiter } from "$lib/server/ratelimit";
import { generateM3U } from "$lib/url/m3u";
import {
  buildPlatformUrl,
  getSupportedPlatforms,
  type PlatformUrlResult,
} from "$lib/url/platforms";
import { buildPlayerApiUrl, buildXcUrl } from "$lib/url/xc";
import { generateQRCodeDataUri } from "$lib/utils/qrcode";

const OAUTH_COOKIE_NAME = "otpravkarr_oauth_id";
const OAUTH_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  maxAge: 600,
};

interface PlatformEntry {
  id: string;
  name: string;
  description: string;
  result: PlatformUrlResult;
}

export const load = async ({ locals }: RequestEvent) => {
  if (!locals.user) {
    return { authenticated: false as const };
  }

  const user = locals.user;

  // Revoked users see a different view
  if (user.is_active === 0) {
    return { authenticated: true as const, revoked: true as const };
  }

  updateLastAccessed(user.id);

  // Self-managed / staff users see Dispatcharr info only
  if (user.provisioning_mode !== "automatic") {
    const dispatcharrUrl = await getConfig("dispatcharr_url");
    return {
      authenticated: true as const,
      mode: user.provisioning_mode as "self_managed" | "staff",
      dispatcharrUsername: user.dispatcharr_username,
      dispatcharrUrl,
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
  const host = (await getConfig("dispatcharr_url")) ?? "";
  const username = user.dispatcharr_username ?? "";

  const xcParams = { host, username, password };
  const xcUrl = buildXcUrl(xcParams);
  const playerApiUrl = buildPlayerApiUrl(xcParams);
  const qrCodeDataUri = await generateQRCodeDataUri(xcUrl);

  const platforms = getSupportedPlatforms();
  const platformUrls: PlatformEntry[] = platforms.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
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
      const configuredOrigin = env.ORIGIN?.trim();
      const forwardOrigin =
        configuredOrigin && configuredOrigin.length > 0 ? configuredOrigin : url.origin;
      const forwardUrl = `${forwardOrigin.replace(/\/$/, "")}/auth/plex`;

      const result = await initiateOAuth(forwardUrl);

      cookies.set(OAUTH_COOKIE_NAME, result.id, OAUTH_COOKIE_OPTIONS);

      throw redirect(303, result.uri);
    } catch (err: unknown) {
      if (err instanceof PlexAuthError) {
        return fail(502, { error: "plex_error", message: err.message });
      }
      throw err;
    }
  },

  refreshCredentials: async ({ locals }) => {
    if (!locals.user) {
      return fail(401, { error: "not_authenticated" });
    }

    if (locals.user.is_active !== 1) {
      return fail(400, { error: "not_allowed" });
    }

    if (locals.user.provisioning_mode !== "automatic") {
      return fail(400, { error: "not_automatic_mode" });
    }

    try {
      const dispatcharrUrl = await getConfig("dispatcharr_url");
      const dispatcharrApiKey = await getConfig("dispatcharr_api_key");

      if (!dispatcharrUrl || !dispatcharrApiKey) {
        return fail(500, { error: "config_missing" });
      }

      const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
      await rotateCredentials(client, locals.user);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to refresh credentials";
      return fail(500, { error: "refresh_failed", message });
    }

    throw redirect(303, "/");
  },

  downloadM3U: async ({ locals }) => {
    if (!locals.user) {
      return fail(401, { error: "not_authenticated" });
    }

    if (locals.user.provisioning_mode !== "automatic" || locals.user.is_active !== 1) {
      return fail(400, { error: "not_allowed" });
    }

    if (!locals.user.dispatcharr_xc_password_enc) {
      return fail(400, { error: "no_credentials" });
    }

    try {
      const dispatcharrUrl = await getConfig("dispatcharr_url");
      const dispatcharrApiKey = await getConfig("dispatcharr_api_key");

      if (!dispatcharrUrl || !dispatcharrApiKey) {
        return fail(500, { error: "config_missing" });
      }

      const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
      const channelsResult = await createChannelEndpoints(client).getAllChannels();

      if (!channelsResult.ok) {
        return fail(500, { error: "channels_failed", message: channelsResult.message });
      }

      const password = await decrypt(
        locals.user.dispatcharr_xc_password_enc,
        "credential-encryption",
      );
      const username = locals.user.dispatcharr_username ?? "";

      const m3uContent = generateM3U({
        channels: channelsResult.data,
        host: dispatcharrUrl,
        username,
        password,
      });

      return { m3uContent };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to generate M3U";
      return fail(500, { error: "m3u_failed", message });
    }
  },
};
