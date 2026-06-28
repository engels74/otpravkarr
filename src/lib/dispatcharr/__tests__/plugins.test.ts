import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOfetch = vi.fn();
vi.mock("ofetch", () => ({ ofetch: (...args: unknown[]) => mockOfetch(...args) }));

const { DispatcharrClient } = await import("../client");
const { listPlugins, updatePluginSettings } = await import("../endpoints/plugins");

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

describe("updatePluginSettings", () => {
  it("POSTs the full settings object and returns the persisted settings", async () => {
    mockOfetch.mockResolvedValueOnce({
      success: true,
      settings: { channel_profile_name: "otpravkarr:g1:Sports", other: 1 },
    });

    const result = await updatePluginSettings(createClient(), "event_channel_managarr", {
      channel_profile_name: "otpravkarr:g1:Sports",
      other: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ channel_profile_name: "otpravkarr:g1:Sports", other: 1 });
    }
    const [url, options] = mockOfetch.mock.calls[0] as [string, { method: string; body: unknown }];
    expect(url).toBe(
      "https://dispatch.example.com/api/plugins/plugins/event_channel_managarr/settings/",
    );
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({
      settings: { channel_profile_name: "otpravkarr:g1:Sports", other: 1 },
    });
  });

  it("treats a 200 body with success:false as a validation failure", async () => {
    mockOfetch.mockResolvedValueOnce({ success: false, error: "bad field" });
    const result = await updatePluginSettings(createClient(), "event_channel_managarr", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation_error");
      expect(result.message).toBe("bad field");
    }
  });

  it("surfaces a 400 rejection from the API", async () => {
    const err = new Error("Bad Request") as Error & { statusCode: number; statusMessage: string };
    err.statusCode = 400;
    err.statusMessage = "Bad Request";
    mockOfetch.mockRejectedValueOnce(err);
    const result = await updatePluginSettings(createClient(), "event_channel_managarr", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation_error");
  });
});
