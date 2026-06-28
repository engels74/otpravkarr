import type { DispatcharrClient } from "../client";
import {
  DispatcharrPluginSettingsResponseSchema,
  DispatcharrPluginsResponseSchema,
} from "../schemas";
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

/**
 * Replace a plugin's persisted settings (`POST /api/plugins/plugins/<key>/settings/`).
 *
 * IMPORTANT: Dispatcharr REPLACES the whole settings object server-side
 * (`PluginConfig.settings = settings`), it does NOT merge. Callers MUST pass the
 * full desired settings object (read-modify-write) or unrelated keys are wiped.
 *
 * Returns the persisted settings on success. The two failure shapes surface
 * differently: a 400 maps to error code `validation_error`, but its body's
 * `error` string is only logged server-side (redacted) — the result `message`
 * carries the HTTP status line, not the body error. A 200 body with
 * `success: false` is also treated as a failure, and there its `error` string
 * IS surfaced as the result `message`.
 */
export async function updatePluginSettings(
  client: DispatcharrClient,
  key: string,
  settings: Record<string, unknown>,
): Promise<DispatcharrResult<Record<string, unknown>>> {
  const result = await client.request(
    "POST",
    `/api/plugins/plugins/${encodeURIComponent(key)}/settings/`,
    { body: { settings }, schema: DispatcharrPluginSettingsResponseSchema },
  );
  if (!result.ok) return result;
  if (!result.data.success) {
    return {
      ok: false,
      error: "validation_error",
      message: result.data.error ?? "Plugin settings update rejected by Dispatcharr",
    };
  }
  return { ok: true, data: result.data.settings ?? {} };
}
