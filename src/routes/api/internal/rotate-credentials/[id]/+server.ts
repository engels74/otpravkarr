import { rotateCredentialsForMappingId } from "$lib/bridge/lifecycle";
import { getConfig } from "$lib/db/repositories/config";
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

  const dispatcharrUrl = await getConfig("dispatcharr_url");
  const dispatcharrApiKey = await getConfig("dispatcharr_api_key");
  if (!dispatcharrUrl || !dispatcharrApiKey) {
    return Response.json({ ok: false, error: "missing_config" }, { status: 503 });
  }

  try {
    const client = new DispatcharrClient(dispatcharrUrl, dispatcharrApiKey);
    await rotateCredentialsForMappingId(client, id, {
      actor: admin.username,
      ipAddress: event.getClientAddress(),
    });
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("user mapping not found")) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return Response.json(
      {
        ok: false,
        error: "rotation_failed",
        message,
      },
      { status: 500 },
    );
  }
};
