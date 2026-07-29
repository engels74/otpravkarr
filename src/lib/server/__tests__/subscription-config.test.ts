// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatcharrChannelGroup } from "$lib/dispatcharr/types";

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: vi.fn(),
}));

const { getConfig } = await import("$lib/db/repositories/config");
const {
  getSubscriptionDefaults,
  computeOfferedGroups,
  defaultSelectedGroupIds,
  isQuarantineGroup,
  getQuarantineGroupState,
  getQuarantineGroupNames,
  setQuarantineGroupNames,
  applyPersistedQuarantineGroupState,
  getLineupPolicySettings,
  resolveLineupPolicy,
} = await import("../subscription-config");

function group(id: number, name: string): DispatcharrChannelGroup {
  return { id, name };
}

beforeEach(() => {
  vi.mocked(getConfig).mockReset().mockResolvedValue(null);
});

describe("isQuarantineGroup", () => {
  it("matches Graveyard/Slow/Black Screens case-insensitively", () => {
    expect(isQuarantineGroup("Graveyard")).toBe(true);
    expect(isQuarantineGroup("slow")).toBe(true);
    expect(isQuarantineGroup("  Black Screens ")).toBe(true);
    expect(isQuarantineGroup("Sports")).toBe(false);
  });
});

describe("setQuarantineGroupNames / getQuarantineGroupNames", () => {
  afterEach(() => {
    // Reset to built-in defaults only (the union always re-adds them).
    setQuarantineGroupNames([]);
  });

  it("merges plugin-resolved names on top of the built-in defaults", () => {
    setQuarantineGroupNames(["Dead Channels", "Frozen"]);
    // Renamed plugin groups are now matched...
    expect(isQuarantineGroup("Dead Channels")).toBe(true);
    expect(isQuarantineGroup("frozen")).toBe(true);
    // ...without dropping the built-in defaults (defense in depth).
    expect(isQuarantineGroup("Graveyard")).toBe(true);
    expect(isQuarantineGroup("Slow")).toBe(true);
  });

  it("never narrows below the defaults even when given an empty list", () => {
    setQuarantineGroupNames([]);
    expect(isQuarantineGroup("Graveyard")).toBe(true);
    expect(isQuarantineGroup("Black Screens")).toBe(true);
    expect(getQuarantineGroupNames()).toEqual(["Graveyard", "Slow", "Black Screens"]);
  });

  it("trims, drops blanks, and dedupes case-insensitively", () => {
    setQuarantineGroupNames(["  Dead  ", "", "dead", "GRAVEYARD"]);
    const names = getQuarantineGroupNames();
    // "Dead" added once; "GRAVEYARD" folds into the existing "Graveyard".
    expect(names).toEqual(["Graveyard", "Slow", "Black Screens", "Dead"]);
  });

  it("exposes source-aware quarantine state for diagnostics", () => {
    const initial = getQuarantineGroupState();
    expect(initial).toMatchObject({
      version: 1,
      defaultNames: ["Graveyard", "Slow", "Black Screens"],
      pluginNames: [],
      resolvedNames: ["Graveyard", "Slow", "Black Screens"],
      source: "defaults",
      refreshedAt: null,
    });

    setQuarantineGroupNames(["Dead Channels"], {
      source: "plugin",
      refreshedAt: "2026-06-28T13:20:00.000Z",
    });

    expect(getQuarantineGroupState()).toMatchObject({
      version: 1,
      pluginNames: ["Dead Channels"],
      resolvedNames: ["Graveyard", "Slow", "Black Screens", "Dead Channels"],
      source: "plugin",
      refreshedAt: "2026-06-28T13:20:00.000Z",
    });
  });
});

describe("applyPersistedQuarantineGroupState", () => {
  afterEach(() => {
    setQuarantineGroupNames([]);
  });

  it("hydrates from valid pluginNames even when resolvedNames is missing", () => {
    // `resolvedNames` is rebuilt from `pluginNames`, so a partial payload that
    // omits it must still restore the matcher rather than silently fall back.
    const ok = applyPersistedQuarantineGroupState({
      version: 1,
      pluginNames: ["Dead Channels"],
      source: "plugin",
      refreshedAt: "2026-06-28T13:20:00.000Z",
    });
    expect(ok).toBe(true);
    expect(isQuarantineGroup("Dead Channels")).toBe(true);
    expect(getQuarantineGroupState()).toMatchObject({
      pluginNames: ["Dead Channels"],
      resolvedNames: ["Graveyard", "Slow", "Black Screens", "Dead Channels"],
      source: "plugin",
    });
  });

  it("rejects a v1 payload whose pluginNames is malformed", () => {
    expect(applyPersistedQuarantineGroupState({ version: 1, pluginNames: [1, 2] })).toBe(false);
  });
});

describe("getSubscriptionDefaults", () => {
  it("fails closed to no offered groups when the approved set is unset", async () => {
    const defaults = await getSubscriptionDefaults();
    expect(defaults.allowSelfSelect).toBe(true);
    expect(defaults.selectableGroupIds).toEqual([]);
  });

  it("parses configured group ids and a disabled self-select flag", async () => {
    vi.mocked(getConfig).mockImplementation(async (key: string) => {
      if (key === "default_selectable_groups") return "[3, 1, 1]";
      if (key === "allow_user_self_select") return "false";
      return null;
    });
    const defaults = await getSubscriptionDefaults();
    expect(defaults.allowSelfSelect).toBe(false);
    expect(defaults.selectableGroupIds).toEqual([1, 3]);
  });

  it.each([
    ["explicitly empty", "[]"],
    ["malformed JSON", "not-json"],
    ["wrong shape", "{}"],
    ["mixed-type", '[1,"2"]'],
    ["zero ID", "[0]"],
    ["negative ID", "[-1]"],
    ["fractional ID", "[1.5]"],
    ["NaN token", "[NaN]"],
    ["infinity token", "[Infinity]"],
    ["unsafe ID", "[9007199254740992]"],
  ])("fails closed for an %s selectable list", async (_kind, raw) => {
    vi.mocked(getConfig).mockImplementation(async (key: string) =>
      key === "default_selectable_groups" ? raw : null,
    );
    const defaults = await getSubscriptionDefaults();
    expect(defaults.selectableGroupIds).toEqual([]);
  });
});

describe("computeOfferedGroups", () => {
  const live = [group(1, "Sports"), group(2, "News"), group(3, "Graveyard"), group(4, "Movies")];

  it("offers no groups when no approved set is configured", () => {
    const offered = computeOfferedGroups(live, { selectableGroupIds: [], allowSelfSelect: true });
    expect(offered).toEqual([]);
  });

  it("restricts to the configured set, still excluding quarantine groups", () => {
    const offered = computeOfferedGroups(live, {
      selectableGroupIds: [1, 3, 4],
      allowSelfSelect: true,
    });
    expect(offered.map((g) => g.id)).toEqual([1, 4]); // 3 (Graveyard) dropped
  });

  it("defaultSelectedGroupIds returns every explicitly offered group id", () => {
    const offered = computeOfferedGroups(live, {
      selectableGroupIds: [1, 2, 4],
      allowSelfSelect: true,
    });
    expect(defaultSelectedGroupIds(offered)).toEqual([1, 2, 4]);
  });
});
describe("resolveLineupPolicy", () => {
  const live = [
    group(1, "Sports"),
    group(2, "News"),
    group(3, "Graveyard"),
    group(4, "Movies"),
    group(5, "Restored"),
  ];
  const catalog = {
    bundles: [
      { id: "sports", slug: "sports", displayName: "Sports", enabled: true, groupIds: [2, 1, 1] },
      { id: "disabled", slug: "disabled", displayName: "Disabled", enabled: false, groupIds: [4] },
    ],
  };
  const settings = {
    defaultPolicy: "core_bundles" as const,
    fixedGroupIds: [4, 3, 4],
    coreGroupIds: [1, 3],
    approvedGroupIds: [1, 2, 3, 4],
  };

  it("uses a valid user override and applies every least-privilege intersection", () => {
    const resolved = resolveLineupPolicy({
      user: {
        lineup_policy_override: "fixed",
        selected_bundle_ids: '["sports"]',
        selected_approved_group_ids: "[5, 999]",
      },
      settings,
      catalog,
      liveGroups: live,
    });

    expect(resolved.policy).toBe("fixed");
    expect(resolved.effectiveGroupIds).toEqual([4]);
    expect(resolved.selectedBundleIds).toEqual(["sports"]);
    expect(resolved.selectedApprovedGroupIds).toEqual([5, 999]);
  });

  it("unions core and enabled selected bundles, then sorts and deduplicates", () => {
    const resolved = resolveLineupPolicy({
      user: {
        lineup_policy_override: null,
        selected_bundle_ids: '["sports", "disabled", "orphan"]',
        selected_approved_group_ids: "[]",
      },
      settings,
      catalog,
      liveGroups: live,
    });

    expect(resolved.policy).toBe("core_bundles");
    expect(resolved.effectiveGroupIds).toEqual([1, 2]);
    expect(resolved.selectedBundleIds).toEqual(["sports", "disabled", "orphan"]);
  });

  it("supports an empty approved selection without widening access", () => {
    expect(
      resolveLineupPolicy({
        user: {
          lineup_policy_override: "approved_selection",
          selected_bundle_ids: "[]",
          selected_approved_group_ids: "[]",
        },
        settings,
        catalog,
        liveGroups: live,
      }).effectiveGroupIds,
    ).toEqual([]);
  });

  it("retains orphan intent and restores it when live and approved state returns", () => {
    const input = {
      user: {
        lineup_policy_override: "approved_selection" as const,
        selected_bundle_ids: '["orphan"]',
        selected_approved_group_ids: "[5, 999]",
      },
      settings,
      catalog,
      liveGroups: live,
    };
    const initially = resolveLineupPolicy(input);
    expect(initially.effectiveGroupIds).toEqual([]);
    expect(initially.selectedApprovedGroupIds).toEqual([5, 999]);

    const restored = resolveLineupPolicy({
      ...input,
      settings: { ...settings, approvedGroupIds: [1, 2, 3, 4, 5] },
    });
    expect(restored.effectiveGroupIds).toEqual([5]);
    expect(
      resolveLineupPolicy({
        ...input,
        settings: { ...settings, approvedGroupIds: [1, 2, 3, 4, 5] },
      }),
    ).toEqual(restored);
  });

  it("fails closed for an unset approved set and malformed intent", () => {
    const resolved = resolveLineupPolicy({
      user: {
        lineup_policy_override: "approved_selection",
        selected_bundle_ids: "not json",
        selected_approved_group_ids: '[1, "2"]',
      },
      settings: { ...settings, approvedGroupIds: null },
      catalog,
      liveGroups: live,
    });
    expect(resolved.effectiveGroupIds).toEqual([]);
    expect(resolved.selectedBundleIds).toEqual([]);
    expect(resolved.selectedApprovedGroupIds).toEqual([]);
  });
});

describe("getLineupPolicySettings", () => {
  it("uses safe defaults for malformed instance policy configuration", async () => {
    vi.mocked(getConfig).mockImplementation(async (key: string) => {
      if (key === "lineup_policy_default") return "all_groups";
      if (key === "lineup_fixed_group_ids") return '[1, "2"]';
      if (key === "lineup_core_group_ids") return "[2, 1, 2]";
      if (key === "default_selectable_groups") return "[]";
      if (key === "lineup_bundle_catalog_version") return "zero";
      return null;
    });

    await expect(getLineupPolicySettings()).resolves.toEqual({
      defaultPolicy: "core_bundles",
      fixedGroupIds: [],
      coreGroupIds: [1, 2],
      approvedGroupIds: [],
      bundleCatalogVersion: null,
    });
  });
});
