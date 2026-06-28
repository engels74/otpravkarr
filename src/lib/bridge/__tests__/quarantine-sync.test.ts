// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatcharrClient } from "$lib/dispatcharr/client";

const mocks = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(async () => {}),
}));

vi.mock("$lib/dispatcharr/endpoints/plugins", () => ({
  listPlugins: mocks.listPlugins,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

const { reconcileQuarantineGroups, hydrateQuarantineGroupsFromConfig, QUARANTINE_GROUP_NAMES_KEY } =
  await import("../quarantine-sync");
const { isQuarantineGroup, getQuarantineGroupNames, setQuarantineGroupNames } = await import(
  "$lib/server/subscription-config"
);

const client = {} as DispatcharrClient;

function pluginsOk(plugins: unknown[]) {
  return { ok: true as const, data: plugins };
}

beforeEach(() => {
  mocks.listPlugins.mockReset();
  mocks.getConfig.mockReset().mockResolvedValue(null);
  mocks.setConfig.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  // Restore built-in defaults so module state doesn't leak between tests.
  setQuarantineGroupNames([]);
});

describe("reconcileQuarantineGroups", () => {
  it("tracks renamed quarantine groups from the live IPTV Checker settings", async () => {
    mocks.listPlugins.mockResolvedValue(
      pluginsOk([
        {
          key: "iptv_checker",
          name: "IPTV Checker",
          enabled: true,
          settings: {
            move_to_group_name: "Dead Channels",
            move_black_screen_group: "Blank",
            move_low_framerate_group: "Laggy",
          },
        },
      ]),
    );

    const result = await reconcileQuarantineGroups(client);

    expect(result.source).toBe("plugin");
    // Renamed groups are now hidden...
    expect(isQuarantineGroup("Dead Channels")).toBe(true);
    expect(isQuarantineGroup("blank")).toBe(true);
    expect(isQuarantineGroup("Laggy")).toBe(true);
    // ...and the built-in defaults remain a permanent floor.
    expect(isQuarantineGroup("Graveyard")).toBe(true);
    // Persisted for restart hydration.
    expect(mocks.setConfig).toHaveBeenCalledWith(
      QUARANTINE_GROUP_NAMES_KEY,
      JSON.stringify(result.names),
    );
  });

  it("falls back to defaults when IPTV Checker is absent", async () => {
    mocks.listPlugins.mockResolvedValue(pluginsOk([{ key: "lineuparr", name: "Lineuparr" }]));

    const result = await reconcileQuarantineGroups(client);

    expect(result.source).toBe("plugin_absent");
    expect(result.names).toEqual(["Graveyard", "Slow", "Black Screens"]);
    expect(isQuarantineGroup("Graveyard")).toBe(true);
  });

  it("never narrows the policy when the plugin is absent after a prior rename", async () => {
    // Seed a prior rename so we can prove it survives the plugin going absent.
    setQuarantineGroupNames(["Dead Channels"]);
    mocks.listPlugins.mockResolvedValue(pluginsOk([{ key: "lineuparr", name: "Lineuparr" }]));

    const result = await reconcileQuarantineGroups(client);

    expect(result.source).toBe("plugin_absent");
    // Existing matcher untouched; no destructive persist.
    expect(isQuarantineGroup("Dead Channels")).toBe(true);
    expect(isQuarantineGroup("Graveyard")).toBe(true);
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });

  it("ignores blank/missing plugin name fields", async () => {
    mocks.listPlugins.mockResolvedValue(
      pluginsOk([
        {
          key: "iptv_checker",
          name: "IPTV Checker",
          enabled: true,
          settings: { move_to_group_name: "  ", move_low_framerate_group: "Crawl" },
        },
      ]),
    );

    const result = await reconcileQuarantineGroups(client);
    expect(result.names).toEqual(["Graveyard", "Slow", "Black Screens", "Crawl"]);
  });

  it("never narrows the policy on a plugin list failure", async () => {
    // Seed a prior rename so we can prove it is preserved on error.
    setQuarantineGroupNames(["Dead Channels"]);
    mocks.listPlugins.mockResolvedValue({
      ok: false,
      error: "auth_failure",
      message: "401",
    });

    const result = await reconcileQuarantineGroups(client);

    expect(result.source).toBe("error");
    expect(result.error).toBe("401");
    // Existing matcher untouched; no destructive persist.
    expect(isQuarantineGroup("Dead Channels")).toBe(true);
    expect(isQuarantineGroup("Graveyard")).toBe(true);
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });
});

describe("hydrateQuarantineGroupsFromConfig", () => {
  it("restores persisted names so renames survive a restart", async () => {
    mocks.getConfig.mockResolvedValue(JSON.stringify(["Dead Channels"]));

    await hydrateQuarantineGroupsFromConfig();

    expect(isQuarantineGroup("Dead Channels")).toBe(true);
    expect(isQuarantineGroup("Graveyard")).toBe(true); // defaults always present
  });

  it("keeps defaults when nothing is persisted", async () => {
    mocks.getConfig.mockResolvedValue(null);
    await hydrateQuarantineGroupsFromConfig();
    expect(getQuarantineGroupNames()).toEqual(["Graveyard", "Slow", "Black Screens"]);
  });

  it("tolerates malformed persisted JSON", async () => {
    mocks.getConfig.mockResolvedValue("{not json");
    await expect(hydrateQuarantineGroupsFromConfig()).resolves.toBeUndefined();
    expect(isQuarantineGroup("Graveyard")).toBe(true);
  });
});
