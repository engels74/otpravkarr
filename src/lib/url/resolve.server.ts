// ---------------------------------------------------------------------------
// Dispatcharr URL resolution — external vs internal URL fallback
// ---------------------------------------------------------------------------

import { getConfig } from "$lib/db/repositories/config";

/**
 * Returns the public-facing Dispatcharr URL for user-facing resources (M3U, XC URLs, etc.).
 *
 * Prefers `dispatcharr_external_url` when set and non-empty,
 * otherwise falls back to `dispatcharr_url` (the internal/API URL).
 */
export async function getDispatcharrPublicUrl(): Promise<string | null> {
  const externalUrl = await getConfig("dispatcharr_external_url");
  if (externalUrl) return externalUrl;
  return getConfig("dispatcharr_url");
}
