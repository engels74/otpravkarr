import { ofetch } from "ofetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeResult {
  found: boolean;
  template?: string;
  probedPaths: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensures the host string has an `http(s)://` scheme prefix. Defaults to `http://` for bare hosts. */
function ensureScheme(host: string): string {
  const trimmed = host.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function buildUrl(host: string, path: string, params: Record<string, string>): string {
  const base = ensureScheme(host).replace(/\/+$/, "");
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}/${path}?${query}`;
}

function redactUrl(url: string, username: string, password: string): string {
  try {
    const parsed = new URL(url);
    for (const [key, value] of parsed.searchParams) {
      if (value === username || value === password) {
        parsed.searchParams.set(key, "***");
      }
    }
    return parsed.toString();
  } catch {
    // Fallback for malformed URLs: use substring replacement
    let result = url;
    if (username) {
      result = result.replaceAll(encodeURIComponent(username), "***").replaceAll(username, "***");
    }
    if (password) {
      result = result.replaceAll(encodeURIComponent(password), "***").replaceAll(password, "***");
    }
    return result;
  }
}

function looksLikeM3U(text: string): boolean {
  return text.trimStart().startsWith("#EXTM3U");
}

function looksLikePlayerApiJson(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return "user_info" in obj || "server_info" in obj;
}

function looksLikeXcCategories(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0] as Record<string, unknown>;
  return typeof first === "object" && first !== null && "category_id" in first;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

async function probeGetPhp(
  host: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; url: string; template?: string }> {
  const url = buildUrl(host, "get.php", {
    username,
    password,
    type: "m3u_plus",
  });

  try {
    const response = await ofetch(url, {
      timeout: PROBE_TIMEOUT_MS,
      responseType: "text",
    });

    if (looksLikeM3U(response)) {
      const base = ensureScheme(host).replace(/\/+$/, "");
      return {
        ok: true,
        url,
        template: `${base}/get.php?username={username}&password={password}&type=m3u_plus`,
      };
    }
  } catch {
    // Probe failed — not fatal
  }

  return { ok: false, url };
}

async function probePlayerApi(
  host: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; url: string; template?: string }> {
  const url = buildUrl(host, "player_api.php", { username, password });

  try {
    const response: unknown = await ofetch(url, {
      timeout: PROBE_TIMEOUT_MS,
    });

    if (looksLikePlayerApiJson(response)) {
      const base = ensureScheme(host).replace(/\/+$/, "");
      return {
        ok: true,
        url,
        template: `${base}/player_api.php?username={username}&password={password}`,
      };
    }
  } catch {
    // Probe failed — not fatal
  }

  return { ok: false, url };
}

async function probeLiveCategories(
  host: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; url: string; template?: string }> {
  const url = buildUrl(host, "player_api.php", {
    username,
    password,
    action: "get_live_categories",
  });

  try {
    const response: unknown = await ofetch(url, {
      timeout: PROBE_TIMEOUT_MS,
    });

    if (looksLikeXcCategories(response)) {
      const base = ensureScheme(host).replace(/\/+$/, "");
      return {
        ok: true,
        url,
        template: `${base}/player_api.php?username={username}&password={password}`,
      };
    }
  } catch {
    // Probe failed — not fatal
  }

  return { ok: false, url };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Probe an XC-compatible server to detect supported API surfaces.
 *
 * @param host - Server host with optional scheme (e.g. `http://iptv.example.com`).
 *   Bare hostnames default to `http://` via {@link ensureScheme}. Pass an explicit
 *   `https://` prefix for HTTPS-only servers.
 * @param username - XC username.
 * @param password - XC password.
 */
export async function probeXcSurface(
  host: string,
  username: string,
  password: string,
): Promise<ProbeResult> {
  const probedPaths: string[] = [];

  const probes = [
    () => probeGetPhp(host, username, password),
    () => probePlayerApi(host, username, password),
    () => probeLiveCategories(host, username, password),
  ];

  for (const probe of probes) {
    const result = await probe();
    probedPaths.push(redactUrl(result.url, username, password));

    if (result.ok && result.template !== undefined) {
      return {
        found: true,
        template: result.template,
        probedPaths,
      };
    }
  }

  return { found: false, probedPaths };
}
