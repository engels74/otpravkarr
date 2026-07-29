// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 1, username: "admin" })),
  getConfig: vi.fn(async (_key: string) => null as string | null),
  getAllGroupProfiles: vi.fn(() => [] as { group_id: number; profile_name: string }[]),
  listPlugins: vi.fn(async () => ({ ok: true as const, data: [] as unknown[] })),
}));

vi.mock("$lib/server/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("$lib/db/repositories/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getAllGroupProfiles: mocks.getAllGroupProfiles,
}));
vi.mock("$lib/dispatcharr/client", () => {
  class DispatcharrClient {}
  return {
    DispatcharrClient,
    createInteractiveClient: () => new DispatcharrClient(),
    createRobustClient: () => new DispatcharrClient(),
  };
});
vi.mock("$lib/dispatcharr/endpoints/plugins", () => ({ listPlugins: mocks.listPlugins }));

const loadEvent = { url: new URL("http://localhost/plugins") };

beforeEach(() => {
  mocks.requireAdmin.mockReset().mockResolvedValue({ id: 1, username: "admin" });
  mocks.getConfig.mockReset().mockResolvedValue(null);
  mocks.getAllGroupProfiles.mockReset().mockReturnValue([]);
  mocks.listPlugins.mockReset().mockResolvedValue({ ok: true, data: [] });
});

describe("plugins panel load", () => {
  it("reports unconfigured when Dispatcharr settings are missing", async () => {
    const { load } = await import("./+page.server");
    const result = (await load(loadEvent as unknown as Parameters<typeof load>[0])) as unknown as {
      configured: boolean;
      plugins: unknown[];
    };
    expect(result.configured).toBe(false);
    expect(result.plugins).toEqual([]);
    expect(mocks.listPlugins).not.toHaveBeenCalled();
  });

  it("detects plugins and passes owned group-profile names for coverage checks", async () => {
    mocks.getConfig.mockResolvedValue("https://d.example");
    mocks.getAllGroupProfiles.mockReturnValue([
      { group_id: 1, profile_name: "otpravkarr:g1:Sports" },
      { group_id: 2, profile_name: "otpravkarr:g2:Danish — PPV/Events" },
      { group_id: -1, profile_name: "otpravkarr:empty" }, // sentinel excluded
    ]);
    mocks.listPlugins.mockResolvedValue({
      ok: true,
      data: [
        {
          key: "event_channel_managarr",
          name: "ECM",
          enabled: true,
          version: "1.0",
          settings: { channel_profile_name: "Streamers" },
        },
      ],
    });

    const { load } = await import("./+page.server");
    const result = (await load(loadEvent as unknown as Parameters<typeof load>[0])) as unknown as {
      configured: boolean;
      reachable: boolean;
      plugins: Array<{ key: string; advisories: Array<{ level: string; message: string }> }>;
    };

    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.plugins[0]?.key).toBe("event_channel_managarr");
    // Only event profiles belong in ECM scope; ordinary and sentinel profiles are excluded.
    const warning = result.plugins[0]?.advisories.find((a) => a.level === "warning");
    expect(warning?.message).toContain("otpravkarr:g2:Danish — PPV/Events");
    expect(warning?.message).not.toContain("otpravkarr:g1:Sports");
    expect(warning?.message).not.toContain("otpravkarr:empty");
  });
});
