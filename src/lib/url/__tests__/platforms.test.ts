import { describe, expect, it } from "vitest";
import { buildPlatformUrl, getSupportedPlatforms } from "../platforms";
import type { XcUrlParams } from "../xc";

const BASE_PARAMS: XcUrlParams = {
  host: "example.com",
  username: "user1",
  password: "pass1",
};

describe("buildPlatformUrl", () => {
  it("generic returns standard XC URL", () => {
    const result = buildPlatformUrl("generic", BASE_PARAMS);
    expect(result.type).toBe("url");
    expect(result).toEqual({
      type: "url",
      url: "http://example.com/get.php?username=user1&password=pass1&type=m3u_plus",
    });
  });

  it("vlc returns standard XC URL", () => {
    const result = buildPlatformUrl("vlc", BASE_PARAMS);
    expect(result.type).toBe("url");
    expect(result).toEqual({
      type: "url",
      url: "http://example.com/get.php?username=user1&password=pass1&type=m3u_plus",
    });
  });

  it("tivimate appends output=ts", () => {
    const result = buildPlatformUrl("tivimate", BASE_PARAMS);
    expect(result.type).toBe("url");
    expect(result).toEqual({
      type: "url",
      url: "http://example.com/get.php?username=user1&password=pass1&type=m3u_plus&output=ts",
    });
  });

  it("tivimate does not duplicate output param when template already has it", () => {
    const params: XcUrlParams = {
      ...BASE_PARAMS,
      template: "{protocol}://{host}/get.php?username={username}&password={password}&output=hls",
    };
    const result = buildPlatformUrl("tivimate", params);
    expect(result.type).toBe("url");
    if (result.type === "url") {
      expect(result.url).not.toContain("output=ts");
      expect(result.url).toContain("output=hls");
    }
  });

  it("smarters returns fields instead of URL", () => {
    const result = buildPlatformUrl("smarters", BASE_PARAMS);
    expect(result.type).toBe("fields");
    expect(result).toEqual({
      type: "fields",
      fields: {
        host: "http://example.com",
        username: "user1",
        password: "pass1",
      },
    });
  });

  it("smarters respects protocol param", () => {
    const result = buildPlatformUrl("smarters", {
      ...BASE_PARAMS,
      protocol: "https",
    });
    expect(result).toEqual({
      type: "fields",
      fields: {
        host: "https://example.com",
        username: "user1",
        password: "pass1",
      },
    });
  });

  it("respects https protocol for URL platforms", () => {
    const result = buildPlatformUrl("generic", {
      ...BASE_PARAMS,
      protocol: "https",
    });
    expect(result.type).toBe("url");
    if (result.type === "url") {
      expect(result.url).toMatch(/^https:\/\//);
    }
  });
});

describe("getSupportedPlatforms", () => {
  it("returns all 4 platforms", () => {
    const platforms = getSupportedPlatforms();
    expect(platforms).toHaveLength(4);
  });

  it("includes all expected platform ids", () => {
    const platforms = getSupportedPlatforms();
    const ids = platforms.map((p) => p.id);
    expect(ids).toContain("generic");
    expect(ids).toContain("vlc");
    expect(ids).toContain("tivimate");
    expect(ids).toContain("smarters");
  });

  it("each platform has required metadata fields", () => {
    const platforms = getSupportedPlatforms();
    for (const p of platforms) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("returns a new array each call (not a reference to internal data)", () => {
    const a = getSupportedPlatforms();
    const b = getSupportedPlatforms();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
