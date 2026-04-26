import { rotateCredentials } from "$lib/bridge/lifecycle";
import { getConfig } from "$lib/db/repositories/config";
import { getUserMappingById } from "$lib/db/repositories/users";
import { DispatcharrClient } from "$lib/dispatcharr/client";
import { requireAdminApi } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const rawId = event.params.id;
  const id = Number(rawId);
  if (!rawId || !Number.isInteger(id) || id <= 0) {
    return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const admin = await requireAdminApi(event);

  const mapping = getUserMappingById(id);
  if (!mapping) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const dispatcharrUrl = await getConfig("dispatcharr_url");
  const dispatcharrApiKey = await getConfig("dispatcharr_api_key");
  if (!dispatcharrUrl || !dispatcharrApiKey) {
    return Response.json({ ok: false, error: "missing_config" }, { status: 503 });
  }

  try {
    const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
    await rotateCredentials(client, mapping, {
      actor: admin.username,
      ipAddress: event.getClientAddress(),
    });
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "rotation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
