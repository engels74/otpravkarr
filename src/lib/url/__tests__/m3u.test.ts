import { describe, expect, it } from "vitest";
import type { DispatcharrChannel } from "../../dispatcharr/types";
import { generateM3U } from "../m3u";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ch(id: number, name: string, number: number, enabled = true): DispatcharrChannel {
  return { id, name, number, enabled };
}

// ---------------------------------------------------------------------------
// generateM3U
// ---------------------------------------------------------------------------

describe("generateM3U", () => {
  const base = { host: "iptv.example.com", username: "alice", password: "s3cret" };

  it("generates a valid M3U with 2 enabled channels", () => {
    const result = generateM3U({
      ...base,
      channels: [ch(10, "BBC One", 1), ch(20, "BBC Two", 2)],
    });

    expect(result).toBe(
      [
        "#EXTM3U",
        '#EXTINF:-1 tvg-name="BBC One" tvg-chno="1",BBC One',
        "http://iptv.example.com/live/alice/s3cret/10.ts",
        '#EXTINF:-1 tvg-name="BBC Two" tvg-chno="2",BBC Two',
        "http://iptv.example.com/live/alice/s3cret/20.ts",
        "",
      ].join("\n"),
    );
  });

  it("returns just the header for an empty channel list", () => {
    const result = generateM3U({ ...base, channels: [] });
    expect(result).toBe("#EXTM3U\n");
  });

  it("filters out disabled channels", () => {
    const result = generateM3U({
      ...base,
      channels: [
        ch(1, "Enabled", 1, true),
        ch(2, "Disabled", 2, false),
        ch(3, "Also Enabled", 3, true),
      ],
    });

    expect(result).toContain("Enabled");
    expect(result).toContain("Also Enabled");
    expect(result).not.toContain("Disabled");
  });

  it("sorts channels by number ascending", () => {
    const result = generateM3U({
      ...base,
      channels: [ch(1, "Third", 30), ch(2, "First", 10), ch(3, "Second", 20)],
    });

    const lines = result.split("\n");
    const extinfs = lines.filter((l) => l.startsWith("#EXTINF"));

    expect(extinfs[0]).toContain("First");
    expect(extinfs[1]).toContain("Second");
    expect(extinfs[2]).toContain("Third");
  });

  it("preserves special characters in channel names (no encoding)", () => {
    const result = generateM3U({
      ...base,
      channels: [ch(5, "Héllo & Wörld <3>", 1)],
    });

    expect(result).toContain('tvg-name="Héllo & Wörld <3>"');
    expect(result).toContain(",Héllo & Wörld <3>");
  });

  it("replaces double quotes with single quotes in channel names", () => {
    const result = generateM3U({
      ...base,
      channels: [ch(7, 'He said "hello"', 1)],
    });

    expect(result).toContain("tvg-name=\"He said 'hello'\"");
    expect(result).toContain(",He said 'hello'");
  });

  it("strips newlines from channel names", () => {
    const result = generateM3U({
      ...base,
      channels: [ch(8, "Line1\nLine2\rLine3", 1)],
    });

    expect(result).toContain('tvg-name="Line1Line2Line3"');
    expect(result).toContain(",Line1Line2Line3");
  });

  it("uses https when protocol is overridden", () => {
    const result = generateM3U({
      ...base,
      protocol: "https",
      channels: [ch(42, "Secure Channel", 1)],
    });

    expect(result).toContain("https://iptv.example.com/live/alice/s3cret/42.ts");
  });

  it("returns only header when all channels are disabled", () => {
    const result = generateM3U({
      ...base,
      channels: [ch(1, "Off", 1, false), ch(2, "Also Off", 2, false)],
    });

    expect(result).toBe("#EXTM3U\n");
  });
});
