import { describe, expect, it } from "vitest";
import {
  buildPlatformUrl,
  type FredTvAssets,
  getSupportedPlatforms,
  resolveInstallMethods,
} from "../platforms";
import type { XcUrlParams } from "../xc";

const BASE_PARAMS: XcUrlParams = {
  host: "example.com",
  username: "user1",
  password: "pass1",
};

const STANDARD_XC_URL = "http://example.com/get.php?username=user1&password=pass1&type=m3u_plus";

describe("buildPlatformUrl", () => {
  it("fredtv returns standard XC URL", () => {
    const result = buildPlatformUrl("fredtv", BASE_PARAMS);
    expect(result).toEqual({ type: "url", url: STANDARD_XC_URL });
  });

  it("iina returns standard XC URL", () => {
    const result = buildPlatformUrl("iina", BASE_PARAMS);
    expect(result).toEqual({ type: "url", url: STANDARD_XC_URL });
  });

  it("vlc returns standard XC URL", () => {
    const result = buildPlatformUrl("vlc", BASE_PARAMS);
    expect(result).toEqual({ type: "url", url: STANDARD_XC_URL });
  });

  it("generic returns standard XC URL", () => {
    const result = buildPlatformUrl("generic", BASE_PARAMS);
    expect(result).toEqual({ type: "url", url: STANDARD_XC_URL });
  });

  it("respects https protocol", () => {
    const result = buildPlatformUrl("fredtv", { ...BASE_PARAMS, protocol: "https" });
    expect(result.type).toBe("url");
    expect(result.url).toMatch(/^https:\/\//);
  });
});

describe("getSupportedPlatforms", () => {
  it("returns all 4 platforms", () => {
    const platforms = getSupportedPlatforms();
    expect(platforms).toHaveLength(4);
  });

  it("includes all expected platform ids in order", () => {
    const platforms = getSupportedPlatforms();
    const ids = platforms.map((p) => p.id);
    expect(ids).toEqual(["fredtv", "iina", "vlc", "generic"]);
  });

  it("each platform has required metadata fields", () => {
    const platforms = getSupportedPlatforms();
    for (const p of platforms) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.tier === "recommended" || p.tier === "legacy").toBe(true);
      expect(Array.isArray(p.supportedOS)).toBe(true);
      expect(p.supportedOS.length).toBeGreaterThan(0);
      expect(typeof p.homepageUrl).toBe("string");
      expect(p.setupInstructions).toBeTruthy();
    }
  });

  it("assigns the recommended tier to fredtv and iina", () => {
    const byId = Object.fromEntries(getSupportedPlatforms().map((p) => [p.id, p]));
    expect(byId.fredtv?.tier).toBe("recommended");
    expect(byId.iina?.tier).toBe("recommended");
    expect(byId.vlc?.tier).toBe("legacy");
    expect(byId.generic?.tier).toBe("legacy");
  });

  it("returns a new array each call (not a reference to internal data)", () => {
    const a = getSupportedPlatforms();
    const b = getSupportedPlatforms();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("resolveInstallMethods", () => {
  const ASSETS_PRESENT: FredTvAssets = {
    msi: "https://example.com/Fred.TV_1.9.1_x64_en-US.msi",
    deb: "https://example.com/fred-tv_1.9.1_amd64.deb",
    rpm: "https://example.com/fred-tv-1.9.1.x86_64.rpm",
  };
  const ASSETS_MISSING: FredTvAssets = { msi: null, deb: null, rpm: null };
  const RELEASES_PAGE = "https://github.com/Fredolx/open-tv/releases/latest";

  it("fredtv returns direct asset URLs when assets are available", () => {
    const methods = resolveInstallMethods("fredtv", ASSETS_PRESENT);
    expect(methods).toEqual([
      { label: "Windows installer (.msi)", type: "link", value: ASSETS_PRESENT.msi },
      { label: "Debian/Ubuntu (.deb)", type: "link", value: ASSETS_PRESENT.deb },
      { label: "Fedora/RHEL (.rpm)", type: "link", value: ASSETS_PRESENT.rpm },
    ]);
  });

  it("fredtv falls back to releases page when assets are null", () => {
    const methods = resolveInstallMethods("fredtv", ASSETS_MISSING);
    for (const m of methods) {
      expect(m.type).toBe("link");
      expect(m.value).toBe(RELEASES_PAGE);
    }
    expect(methods.map((m) => m.label)).toEqual([
      "Windows installer (.msi)",
      "Debian/Ubuntu (.deb)",
      "Fedora/RHEL (.rpm)",
    ]);
  });

  it("iina returns a brew command and homepage link", () => {
    const methods = resolveInstallMethods("iina", ASSETS_MISSING);
    expect(methods).toEqual([
      { label: "Homebrew", type: "command", value: "brew install --cask iina" },
      { label: "Download from iina.io", type: "link", value: "https://iina.io" },
    ]);
  });

  it("vlc returns a single homepage link", () => {
    const methods = resolveInstallMethods("vlc", ASSETS_MISSING);
    expect(methods).toEqual([
      {
        label: "Download from videolan.org",
        type: "link",
        value: "https://www.videolan.org/vlc/",
      },
    ]);
  });

  it("generic returns no install methods", () => {
    expect(resolveInstallMethods("generic", ASSETS_MISSING)).toEqual([]);
  });
});
