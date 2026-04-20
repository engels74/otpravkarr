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
      signal: expect.any(AbortSignal),
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

  it("does not re-hit GitHub on subsequent calls after a cold-start failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await getFredTvAssets();
    await getFredTvAssets();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-hit GitHub on subsequent calls after a stale-cache failure", async () => {
    vi.useFakeTimers();
    try {
      const primeMock = mockFetchOnce({
        ok: true,
        json: () => ({
          assets: [{ name: "release.msi", browser_download_url: "https://example.com/fred.msi" }],
        }),
      });
      await getFredTvAssets();
      expect(primeMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(3_700_000);
      const failMock = vi.fn().mockRejectedValue(new Error("outage"));
      vi.stubGlobal("fetch", failMock);

      const first = await getFredTvAssets();
      const second = await getFredTvAssets();

      expect(failMock).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
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

  it("dedupes concurrent callers — fetch called only once when cache is cold", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    // Fire two concurrent calls before the first fetch resolves
    const p1 = getFredTvAssets();
    const p2 = getFredTvAssets();

    // Resolve the single in-flight fetch
    resolveFetch({
      ok: true,
      json: async () => ({
        assets: [
          {
            name: "Fred.TV_1.9.1_x64_en-US.msi",
            browser_download_url: "https://example.com/fred.msi",
          },
        ],
      }),
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1.msi).toBe("https://example.com/fred.msi");
  });

  it("resolves assets with uppercase extensions (case-insensitive matching)", async () => {
    mockFetchOnce({
      ok: true,
      json: () => ({
        assets: [
          { name: "Fred.TV_1.9.1.MSI", browser_download_url: "https://example.com/fred.msi" },
          { name: "fred-tv_1.9.1_amd64.DEB", browser_download_url: "https://example.com/fred.deb" },
          {
            name: "fred-tv-1.9.1.x86_64.RPM",
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
  });
});
