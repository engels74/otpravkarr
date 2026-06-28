import { error } from "@sveltejs/kit";
import { buildGroupChannelMap } from "$lib/bridge/group-profiles";
import { decrypt } from "$lib/crypto/encryption";
import { getConfig } from "$lib/db/repositories/config";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { createChannelEndpoints } from "$lib/dispatcharr/endpoints/channels";
import { requireUser } from "$lib/server/auth";
import { generateM3U } from "$lib/url/m3u";
import { getDispatcharrPublicUrl } from "$lib/url/resolve.server";
import type { RequestHandler } from "./$types";

/**
 * Parse the user's stored `dispatcharr_group_ids` JSON into an integer array.
 * Mirrors `subscription/+page.server.ts`'s parser: never throws — malformed or
 * non-array JSON resolves to `[]` (an empty, fail-closed selection).
 */
function parseStoredGroupIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => Number.isInteger(v));
  } catch {
    return [];
  }
}

export const GET: RequestHandler = async (event) => {
  // requireUser redirects anon/non-user/inactive sessions to "/" (clearing the
  // cookie for bad sessions, but preserving it for inactive users) and
  // guarantees an active mapping for the credential-serving path below.
  const user = await requireUser(event);

  if (user.provisioning_mode !== "automatic") {
    throw error(403, "Not allowed");
  }

  if (!user.dispatcharr_xc_password_enc) {
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

  // Scope the playlist to the groups the user actually selected. This is
  // INFORMATION-EXPOSURE control over the generated playlist — it is NOT the
  // access boundary. The access boundary is Dispatcharr's per-user
  // `channel_profiles` + `user_level`, enforced at stream time. Do not remove
  // or "optimize away" this filter, and do not assume it prevents direct
  // `/live/{user}/{pass}/{channelId}.ts` access to non-selected channels.
  //
  // Derive scope with the SAME bucketing the provisioner uses
  // (buildGroupChannelMap honors effective_channel_group_id ?? channel_group_id)
  // so the playlist and the provisioned profile membership stay in lockstep.
  // Keep this logic pure (operate only on already-fetched channelsResult.data):
  // adding any db-touching call here would break the node-env test.
  const groupIds = parseStoredGroupIds(user.dispatcharr_group_ids);
  const groupChannelMap = buildGroupChannelMap(channelsResult.data);
  const allowedIds = new Set(groupIds.flatMap((id) => groupChannelMap.get(id) ?? []));
  const scopedChannels = channelsResult.data.filter((ch) => allowedIds.has(ch.id));

  const password = await decrypt(user.dispatcharr_xc_password_enc, "credential-encryption");
  const username = user.dispatcharr_username ?? "";

  const m3uContent = generateM3U({
    channels: scopedChannels,
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
