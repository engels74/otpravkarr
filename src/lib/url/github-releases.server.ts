// ---------------------------------------------------------------------------
// FredTV release asset resolver — hits the GitHub REST API with a 1 h cache.
// ---------------------------------------------------------------------------

import type { FredTvAssets } from "./platforms";

const RELEASES_API_URL = "https://api.github.com/repos/Fredolx/open-tv/releases/latest";
const CACHE_TTL_MS = 3_600_000;

interface CacheEntry {
  data: FredTvAssets;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<FredTvAssets> | null = null;

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  assets?: GitHubAsset[];
}

function findAsset(assets: GitHubAsset[], ext: ".msi" | ".deb" | ".rpm"): string | null {
  const match = assets.find(
    (a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(ext),
  );
  return match ? match.browser_download_url : null;
}

/**
 * Resolve the latest FredTV release's installer asset URLs.
 *
 * One network call per TTL window. Falls back to the last cached value on
 * failure, or null URLs if the cache is empty; callers are expected to link
 * users to the releases page when a URL is null.
 */
export async function getFredTvAssets(): Promise<FredTvAssets> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = _doFetch(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function _doFetch(now: number): Promise<FredTvAssets> {
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "otpravkarr",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`);
    }
    const release = (await res.json()) as GitHubRelease;
    const assets = release.assets ?? [];
    const data: FredTvAssets = {
      msi: findAsset(assets, ".msi"),
      deb: findAsset(assets, ".deb"),
      rpm: findAsset(assets, ".rpm"),
    };
    cache = { data, fetchedAt: now };
    return data;
  } catch {
    if (cache) {
      cache = { data: cache.data, fetchedAt: now };
      return cache.data;
    }
    const fallback: FredTvAssets = { msi: null, deb: null, rpm: null };
    cache = { data: fallback, fetchedAt: now };
    return fallback;
  }
}

/** Test-only: clear the module-level cache between runs. */
export function _resetCacheForTesting(): void {
  cache = null;
  inFlight = null;
}
