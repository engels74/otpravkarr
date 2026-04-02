// ---------------------------------------------------------------------------
// Platform-specific URL variants — pure functions, no side effects
// ---------------------------------------------------------------------------

import { buildXcUrl, DEFAULT_XC_TEMPLATE, normalizeHost, type XcUrlParams } from "./xc";

/** Supported IPTV player platforms. */
export type Platform = "generic" | "vlc" | "tivimate" | "smarters";

/** Metadata describing a supported platform. */
export interface PlatformInfo {
  id: Platform;
  name: string;
  description: string;
}

/** Smarters-style credential fields (host + username + password separately). */
export interface SmartersFields {
  host: string;
  username: string;
  password: string;
}

/** Discriminated union for platform URL results. */
export type PlatformUrlResult =
  | { type: "url"; url: string }
  | { type: "fields"; fields: SmartersFields };

const PLATFORM_INFO: PlatformInfo[] = [
  { id: "generic", name: "Generic", description: "Standard M3U playlist URL" },
  { id: "vlc", name: "VLC", description: "VLC media player (standard XC format)" },
  {
    id: "tivimate",
    name: "TiviMate",
    description: "TiviMate IPTV player (appends output=ts)",
  },
  {
    id: "smarters",
    name: "IPTV Smarters",
    description: "IPTV Smarters Pro (separate host/user/pass fields)",
  },
];

/**
 * Build a platform-specific URL or credential set from XC parameters.
 *
 * - `generic` / `vlc`: standard XC URL
 * - `tivimate`: XC URL with `&output=ts` appended (if not already present)
 * - `smarters`: returns separate host/username/password fields
 */
export function buildPlatformUrl(platform: Platform, params: XcUrlParams): PlatformUrlResult {
  switch (platform) {
    case "generic":
    case "vlc":
      return { type: "url", url: buildXcUrl(params) };

    case "tivimate": {
      const url = buildXcUrl(params);
      // Only append output=ts if the template doesn't already contain it
      if ((params.template ?? DEFAULT_XC_TEMPLATE).includes("output=")) {
        return { type: "url", url };
      }
      const separator = (params.template ?? DEFAULT_XC_TEMPLATE).includes("?") ? "&" : "?";
      return { type: "url", url: `${url}${separator}output=ts` };
    }

    case "smarters": {
      const protocol = params.protocol ?? "http";
      return {
        type: "fields",
        fields: {
          host: `${protocol}://${normalizeHost(params.host)}`,
          username: params.username,
          password: params.password,
        },
      };
    }
  }
}

/** Returns metadata for all supported platforms. */
export function getSupportedPlatforms(): PlatformInfo[] {
  return [...PLATFORM_INFO];
}
