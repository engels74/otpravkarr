// ---------------------------------------------------------------------------
// XC-format URL generation — pure functions, no side effects
// ---------------------------------------------------------------------------

/**
 * Default XC (Xtream Codes) playlist URL template.
 * Placeholders: {protocol}, {host}, {username}, {password}
 */
export const DEFAULT_XC_TEMPLATE =
  "{protocol}://{host}/get.php?username={username}&password={password}&type=m3u_plus";

/**
 * Parameters accepted by `buildXcUrl`.
 */
export interface XcUrlParams {
  host: string;
  username: string;
  password: string;
  /** @default 'http' */
  protocol?: "http" | "https";
  /** Override the URL template. Uses `DEFAULT_XC_TEMPLATE` when omitted. */
  template?: string;
}

/** Strip scheme prefix and trailing slashes from a host string. */
export function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Build an XC-format playlist URL by substituting template placeholders.
 *
 * Credentials are inserted **as-is** (no URL-encoding) because XC players
 * expect raw credentials in the query string.
 */
export function buildXcUrl(params: XcUrlParams): string {
  const { host, username, password, protocol = "http", template = DEFAULT_XC_TEMPLATE } = params;
  const normalizedHost = normalizeHost(host);

  return template
    .replaceAll("{protocol}", protocol)
    .replaceAll("{host}", normalizedHost)
    .replaceAll("{username}", username)
    .replaceAll("{password}", password);
}

/**
 * Build the XC `player_api.php` URL used to query server info, live categories,
 * VOD categories, etc.
 */
export function buildPlayerApiUrl(params: {
  host: string;
  username: string;
  password: string;
  protocol?: "http" | "https";
}): string {
  const { host, username, password, protocol = "http" } = params;
  const normalizedHost = normalizeHost(host);
  return `${protocol}://${normalizedHost}/player_api.php?username=${username}&password=${password}`;
}

/**
 * Build an XC live-stream URL for a specific channel.
 *
 * Format: `{protocol}://{host}/live/{username}/{password}/{channelId}.ts`
 */
export function buildLiveStreamUrl(
  params: {
    host: string;
    username: string;
    password: string;
    protocol?: "http" | "https";
  },
  channelId: number,
): string {
  const { host, username, password, protocol = "http" } = params;
  const normalizedHost = normalizeHost(host);
  return `${protocol}://${normalizedHost}/live/${username}/${password}/${channelId}.ts`;
}
