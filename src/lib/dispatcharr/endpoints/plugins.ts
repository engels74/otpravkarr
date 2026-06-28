import type { DispatcharrClient } from "../client";
import { DispatcharrPluginsResponseSchema } from "../schemas";
import type { DispatcharrPlugin, DispatcharrResult } from "../types";

/**
 * List installed Dispatcharr plugins (`GET /api/plugins/plugins/`).
 *
 * The endpoint is untyped in the OpenAPI spec ("No response body"), so the
 * response is parsed defensively and normalized to a flat array, tolerating
 * both the `{ plugins: [...] }` envelope and a bare array.
 */
export async function listPlugins(
  client: DispatcharrClient,
): Promise<DispatcharrResult<DispatcharrPlugin[]>> {
  const result = await client.request("GET", "/api/plugins/plugins/", {
    schema: DispatcharrPluginsResponseSchema,
  });
  if (!result.ok) return result;
  const data = Array.isArray(result.data) ? result.data : result.data.plugins;
  return { ok: true, data };
}
