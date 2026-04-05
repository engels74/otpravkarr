import { getConfig } from "$lib/db/repositories/config";
import { getAccount } from "$lib/plex/client";
import { fetchFriends, getCachedFriends } from "$lib/plex/friends";
import { requireAdminApi } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  await requireAdminApi(event);

  const cached = getCachedFriends();
  if (cached) {
    return Response.json({ ok: true, friends: cached }, { status: 200 });
  }

  const token = await getConfig("plex_admin_token");
  if (!token) {
    return Response.json({ ok: false, error: "missing_config" }, { status: 503 });
  }

  try {
    const account = await getAccount(token);
    const friends = await fetchFriends(account);
    return Response.json({ ok: true, friends }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: "plex_error", message }, { status: 502 });
  }
};
