// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCacheForTesting, getFredTvAssets } from "../github-releases.server";

function mockFetchOnce(response: { ok: boolean; json?: () => unknown; status?: number }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => (response.json ? response.json() : {}),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("getFredTvAssets", () => {
  beforeEach(() => {
    _resetCacheForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses API response and returns asset URLs", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: () => ({
        assets: [
          {
            name: "Fred.TV_1.9.1_x64_en-US.msi",
            browser_download_url: "https://example.com/fred.msi",
          },
          {
            name: "fred-tv_1.9.1_amd64.deb",
            browser_download_url: "https://example.com/fred.deb",
          },
          {
            name: "fred-tv-1.9.1.x86_64.rpm",
            browser_download_url: "https://example.com/fred.rpm",
          },
        ],
      }),
    });

    const result = await getFredTvAssets();

    expect(result).toEqual({
      msi: "https://example.com/fred.msi",
      deb: "https://example.com/fred.deb",
      rpm: "https://example.com/fred.rpm",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/repos/Fredolx/open-tv/releases/latest");
    expect(init).toMatchObject({
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "otpravkarr",
      },
    });
  });

  it("caches subsequent calls within the TTL window", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: () => ({
        assets: [{ name: "release.msi", browser_download_url: "https://example.com/fred.msi" }],
      }),
    });

    const first = await getFredTvAssets();
    const second = await getFredTvAssets();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("returns null assets when fetch rejects and no cache exists", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getFredTvAssets();

    expect(result).toEqual({ msi: null, deb: null, rpm: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null assets when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 503, json: () => ({}) });
    const result = await getFredTvAssets();
    expect(result).toEqual({ msi: null, deb: null, rpm: null });
  });

  it("leaves an asset key null when the matching extension is missing", async () => {
    mockFetchOnce({
      ok: true,
      json: () => ({
        assets: [{ name: "release.msi", browser_download_url: "https://example.com/fred.msi" }],
      }),
    });

    const result = await getFredTvAssets();
    expect(result).toEqual({
      msi: "https://example.com/fred.msi",
      deb: null,
      rpm: null,
    });
  });
});
