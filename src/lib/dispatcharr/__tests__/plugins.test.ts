import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOfetch = vi.fn();
vi.mock("ofetch", () => ({ ofetch: (...args: unknown[]) => mockOfetch(...args) }));

const { DispatcharrClient } = await import("../client");
const { listPlugins } = await import("../endpoints/plugins");

function createClient() {
  return new DispatcharrClient("https://dispatch.example.com", "test-key");
}

beforeEach(() => mockOfetch.mockReset());

describe("listPlugins", () => {
  it("normalizes the { plugins: [...] } envelope to a flat array", async () => {
    mockOfetch.mockResolvedValueOnce({
      plugins: [
        {
          key: "event_channel_managarr",
          name: "ECM",
          version: "1.2.0",
          enabled: true,
          settings: {},
        },
        { key: "iptv_checker", name: "IPTV Checker", enabled: false },
      ],
    });

    const result = await listPlugins(createClient());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.key).toBe("event_channel_managarr");
      expect(result.data[1]?.enabled).toBe(false);
    }
  });

  it("tolerates a bare array response", async () => {
    mockOfetch.mockResolvedValueOnce([{ key: "lineuparr", name: "Lineuparr", enabled: true }]);
    const result = await listPlugins(createClient());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.key).toBe("lineuparr");
  });

  it("defaults enabled to false when omitted", async () => {
    mockOfetch.mockResolvedValueOnce({ plugins: [{ key: "epg_janitor", name: "EPG Janitor" }] });
    const result = await listPlugins(createClient());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.enabled).toBe(false);
  });

  it("surfaces auth failures", async () => {
    const err = new Error("Unauthorized") as Error & { statusCode: number; statusMessage: string };
    err.statusCode = 401;
    err.statusMessage = "Unauthorized";
    mockOfetch.mockRejectedValueOnce(err);
    const result = await listPlugins(createClient());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("auth_failure");
  });
});
