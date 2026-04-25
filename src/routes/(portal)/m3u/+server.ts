import { error, redirect } from "@sveltejs/kit";
import { decrypt } from "$lib/crypto/encryption";
import { getConfig } from "$lib/db/repositories/config";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { createChannelEndpoints } from "$lib/dispatcharr/endpoints/channels";
import { generateM3U } from "$lib/url/m3u";
import { getDispatcharrPublicUrl } from "$lib/url/resolve.server";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, "/");
  }

  if (locals.user.provisioning_mode !== "automatic" || locals.user.is_active !== 1) {
    throw error(403, "Not allowed");
  }

  if (!locals.user.dispatcharr_xc_password_enc) {
    throw error(400, "No credentials provisioned");
  }

  const [dispatcharrUrl, dispatcharrApiKey, publicHost] = await Promise.all([
    getConfig("dispatcharr_url"),
    getConfig("dispatcharr_api_key"),
    getDispatcharrPublicUrl(),
  ]);
  if (!dispatcharrUrl || !dispatcharrApiKey) {
    throw error(500, "Dispatcharr is not configured");
  }
  if (!publicHost) {
    throw error(500, "A HTTPS Dispatcharr public URL is required to generate M3U credentials");
  }

  const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
  const channelsResult = await createChannelEndpoints(client).getAllChannels();
  if (!channelsResult.ok) {
    throw error(502, "Failed to fetch channel list");
  }

  const password = await decrypt(locals.user.dispatcharr_xc_password_enc, "credential-encryption");
  const username = locals.user.dispatcharr_username ?? "";

  const m3uContent = generateM3U({
    channels: channelsResult.data,
    host: publicHost,
    username,
    password,
  });

  const safeName = `${username || "playlist"}.m3u`.replace(/[^A-Za-z0-9._-]/g, "_");

  return new Response(m3uContent, {
    status: 200,
    headers: {
      "content-type": "audio/mpegurl; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "private, no-store",
    },
  });
};
