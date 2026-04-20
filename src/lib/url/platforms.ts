// ---------------------------------------------------------------------------
// Platform-specific URL variants — pure functions, no side effects
// ---------------------------------------------------------------------------

import { buildXcUrl, type XcUrlParams } from "./xc";

/** Supported IPTV player platforms. */
export type Platform = "fredtv" | "iina" | "vlc" | "generic";

export type PlatformTier = "recommended" | "legacy";

export type SupportedOS = "windows" | "linux" | "macos";

/** Metadata describing a supported platform. */
export interface PlatformInfo {
  id: Platform;
  name: string;
  description: string;
  tier: PlatformTier;
  supportedOS: SupportedOS[];
  homepageUrl: string;
  setupInstructions: string;
}

/** Resolved URL for a supported platform (all variants currently produce a URL). */
export type PlatformUrlResult = { type: "url"; url: string };

/** A single installation option surfaced in the setup guide. */
export interface InstallMethod {
  label: string;
  type: "link" | "command";
  value: string;
}

/** Direct-download URLs for FredTV's latest release, resolved at runtime. */
export interface FredTvAssets {
  msi: string | null;
  deb: string | null;
  rpm: string | null;
}

const FREDTV_RELEASES_PAGE = "https://github.com/Fredolx/open-tv/releases/latest";

const PLATFORM_INFO: PlatformInfo[] = [
  {
    id: "fredtv",
    name: "FredTV",
    description: "Modern IPTV player for Windows and Linux with EPG and channel grid.",
    tier: "recommended",
    supportedOS: ["windows", "linux"],
    homepageUrl: "https://github.com/Fredolx/open-tv",
    setupInstructions:
      "Install FredTV, open it, then paste the M3U playlist URL into its playlist settings.",
  },
  {
    id: "iina",
    name: "IINA",
    description: "The modern media player for macOS. Plays M3U playlists natively.",
    tier: "recommended",
    supportedOS: ["macos"],
    homepageUrl: "https://iina.io",
    setupInstructions:
      "Install IINA, then open the M3U URL via File → Open URL (or drag it onto the IINA window).",
  },
  {
    id: "vlc",
    name: "VLC",
    description: "Cross-platform fallback. No EPG or channel grid, but plays M3U streams anywhere.",
    tier: "legacy",
    supportedOS: ["windows", "linux", "macos"],
    homepageUrl: "https://www.videolan.org/vlc/",
    setupInstructions: "Open VLC, go to Media → Open Network Stream, and paste the URL below.",
  },
  {
    id: "generic",
    name: "Generic",
    description: "Raw M3U URL for any other IPTV-compatible player.",
    tier: "legacy",
    supportedOS: ["windows", "linux", "macos"],
    homepageUrl: "",
    setupInstructions:
      "Copy the M3U playlist URL and paste it into your IPTV player's playlist settings.",
  },
];

/**
 * Build a platform-specific URL from XC parameters.
 *
 * All supported platforms currently emit the same XC playlist URL; the
 * discriminated return type is kept for callers that pattern-match on it.
 */
export function buildPlatformUrl(platform: Platform, params: XcUrlParams): PlatformUrlResult {
  switch (platform) {
    case "fredtv":
    case "iina":
    case "vlc":
    case "generic":
      return { type: "url", url: buildXcUrl(params) };
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unsupported platform: ${_exhaustive}`);
    }
  }
}

/**
 * Return the install methods a user can follow for the given platform.
 *
 * FredTV resolves to direct asset URLs from the latest GitHub release; when any
 * asset is unavailable (API failure or filename change), the button falls back
 * to the public releases page so users still have a working path.
 */
export function resolveInstallMethods(platform: Platform, assets: FredTvAssets): InstallMethod[] {
  switch (platform) {
    case "fredtv":
      return [
        {
          label: "Windows installer (.msi)",
          type: "link",
          value: assets.msi ?? FREDTV_RELEASES_PAGE,
        },
        {
          label: "Debian/Ubuntu (.deb)",
          type: "link",
          value: assets.deb ?? FREDTV_RELEASES_PAGE,
        },
        {
          label: "Fedora/RHEL (.rpm)",
          type: "link",
          value: assets.rpm ?? FREDTV_RELEASES_PAGE,
        },
      ];
    case "iina":
      return [
        { label: "Homebrew", type: "command", value: "brew install --cask iina" },
        { label: "Download from iina.io", type: "link", value: "https://iina.io" },
      ];
    case "vlc":
      return [
        {
          label: "Download from videolan.org",
          type: "link",
          value: "https://www.videolan.org/vlc/",
        },
      ];
    case "generic":
      return [];
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unsupported platform: ${_exhaustive}`);
    }
  }
}

/** Returns metadata for all supported platforms. */
export function getSupportedPlatforms(): PlatformInfo[] {
  return [...PLATFORM_INFO];
}
