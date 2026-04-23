// ---------------------------------------------------------------------------
// Dispatcharr URL resolution — external vs internal URL fallback
// ---------------------------------------------------------------------------

import { getConfig } from "$lib/db/repositories/config";
import { isSafeHttpSecretUrl } from "$lib/server/validation";

/**
 * Returns the public-facing Dispatcharr URL for user-facing resources (M3U, XC URLs, etc.).
 *
 * Prefers `dispatcharr_external_url` when set and non-empty,
 * otherwise falls back to `dispatcharr_url` (the internal/API URL).
 */
export async function getDispatcharrPublicUrl(): Promise<string | null> {
  const externalUrl = await getConfig("dispatcharr_external_url");
  if (externalUrl) {
    return isSafeHttpSecretUrl(externalUrl) ? externalUrl : null;
  }

  const internalUrl = await getConfig("dispatcharr_url");
  if (!internalUrl) return null;
  return isSafeHttpSecretUrl(internalUrl) ? internalUrl : null;
}
