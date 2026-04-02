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

function buildUrl(host: string, path: string, params: Record<string, string>): string {
  const base = host.replace(/\/+$/, "");
  const query = new URLSearchParams(params).toString();
  return `${base}/${path}?${query}`;
}

function looksLikeM3U(text: string): boolean {
  return text.trimStart().startsWith("#EXTM3U");
}

function looksLikePlayerApiJson(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return "user_info" in obj || "server_info" in obj;
}

function looksLikeJsonArray(data: unknown): boolean {
  return Array.isArray(data);
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
      const base = host.replace(/\/+$/, "");
      return {
        ok: true,
        url,
        template: `${base}/get.php?username={username}&password={password}&type=m3u_plus`,
      };
    }

    // Non-error 200 with content is still a positive signal
    if (typeof response === "string" && response.length > 0) {
      const base = host.replace(/\/+$/, "");
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
      const base = host.replace(/\/+$/, "");
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

    if (looksLikeJsonArray(response)) {
      const base = host.replace(/\/+$/, "");
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
    probedPaths.push(result.url);

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
