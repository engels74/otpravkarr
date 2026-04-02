import { describe, expect, it } from "vitest";

import { buildLiveStreamUrl, buildPlayerApiUrl, buildXcUrl, DEFAULT_XC_TEMPLATE } from "../xc";

// ---------------------------------------------------------------------------
// buildXcUrl
// ---------------------------------------------------------------------------

describe("buildXcUrl", () => {
  it("builds a URL using the default template and http protocol", () => {
    const url = buildXcUrl({
      host: "iptv.example.com",
      username: "alice",
      password: "s3cret",
    });

    expect(url).toBe(
      "http://iptv.example.com/get.php?username=alice&password=s3cret&type=m3u_plus",
    );
  });

  it("uses https when protocol is overridden", () => {
    const url = buildXcUrl({
      host: "iptv.example.com",
      username: "bob",
      password: "hunter2",
      protocol: "https",
    });

    expect(url).toBe(
      "https://iptv.example.com/get.php?username=bob&password=hunter2&type=m3u_plus",
    );
  });

  it("substitutes a custom template", () => {
    const url = buildXcUrl({
      host: "my.server.tv",
      username: "user1",
      password: "pass1",
      template: "{protocol}://{host}/custom?u={username}&p={password}",
    });

    expect(url).toBe("http://my.server.tv/custom?u=user1&p=pass1");
  });

  it("inserts realistic alphanumeric credentials as-is", () => {
    const url = buildXcUrl({
      host: "iptv.example.com",
      username: "alice",
      password: "a1B2c3D4e5F6g7H8",
    });

    // generateXcPassword() produces alphanumeric-only strings;
    // buildXcUrl inserts them raw — no encoding applied.
    expect(url).toBe(
      "http://iptv.example.com/get.php?username=alice&password=a1B2c3D4e5F6g7H8&type=m3u_plus",
    );
  });

  it("replaces multiple occurrences of the same placeholder", () => {
    const url = buildXcUrl({
      host: "h",
      username: "u",
      password: "p",
      template: "{username}:{password}@{host} ({username})",
    });

    expect(url).toBe("u:p@h (u)");
  });

  it("exports DEFAULT_XC_TEMPLATE matching the spec", () => {
    expect(DEFAULT_XC_TEMPLATE).toBe(
      "{protocol}://{host}/get.php?username={username}&password={password}&type=m3u_plus",
    );
  });
});

// ---------------------------------------------------------------------------
// buildPlayerApiUrl
// ---------------------------------------------------------------------------

describe("buildPlayerApiUrl", () => {
  it("builds a player_api.php URL with default http protocol", () => {
    const url = buildPlayerApiUrl({
      host: "iptv.example.com",
      username: "alice",
      password: "s3cret",
    });

    expect(url).toBe("http://iptv.example.com/player_api.php?username=alice&password=s3cret");
  });

  it("uses https when protocol is overridden", () => {
    const url = buildPlayerApiUrl({
      host: "iptv.example.com",
      username: "alice",
      password: "s3cret",
      protocol: "https",
    });

    expect(url).toBe("https://iptv.example.com/player_api.php?username=alice&password=s3cret");
  });
});

// ---------------------------------------------------------------------------
// buildLiveStreamUrl
// ---------------------------------------------------------------------------

describe("buildLiveStreamUrl", () => {
  it("builds a live stream URL with default http protocol", () => {
    const url = buildLiveStreamUrl(
      { host: "iptv.example.com", username: "alice", password: "s3cret" },
      42,
    );

    expect(url).toBe("http://iptv.example.com/live/alice/s3cret/42.ts");
  });

  it("uses https when protocol is overridden", () => {
    const url = buildLiveStreamUrl(
      { host: "iptv.example.com", username: "alice", password: "s3cret", protocol: "https" },
      7,
    );

    expect(url).toBe("https://iptv.example.com/live/alice/s3cret/7.ts");
  });

  it("handles large channel IDs", () => {
    const url = buildLiveStreamUrl({ host: "tv.example.com", username: "u", password: "p" }, 99999);

    expect(url).toBe("http://tv.example.com/live/u/p/99999.ts");
  });
});
