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
  getQuarantineGroupNames,
  setQuarantineGroupNames,
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
});

describe("getSubscriptionDefaults", () => {
  it("defaults to self-select allowed and 'offer all' when unset", async () => {
    const defaults = await getSubscriptionDefaults();
    expect(defaults.allowSelfSelect).toBe(true);
    expect(defaults.selectableGroupIds).toBeNull();
  });

  it("parses configured group ids and a disabled self-select flag", async () => {
    vi.mocked(getConfig).mockImplementation(async (key: string) => {
      if (key === "default_selectable_groups") return "[3, 1, 1]";
      if (key === "allow_user_self_select") return "false";
      return null;
    });
    const defaults = await getSubscriptionDefaults();
    expect(defaults.allowSelfSelect).toBe(false);
    expect(defaults.selectableGroupIds).toEqual([3, 1]);
  });

  it("normalizes an explicitly empty selectable list to null (offer all)", async () => {
    vi.mocked(getConfig).mockImplementation(async (key: string) =>
      key === "default_selectable_groups" ? "[]" : null,
    );
    const defaults = await getSubscriptionDefaults();
    expect(defaults.selectableGroupIds).toBeNull();
  });
});

describe("computeOfferedGroups", () => {
  const live = [group(1, "Sports"), group(2, "News"), group(3, "Graveyard"), group(4, "Movies")];

  it("offers all non-quarantine groups when no default set is configured", () => {
    const offered = computeOfferedGroups(live, { selectableGroupIds: null, allowSelfSelect: true });
    expect(offered.map((g) => g.id)).toEqual([1, 2, 4]); // Graveyard excluded
  });

  it("restricts to the configured set, still excluding quarantine groups", () => {
    const offered = computeOfferedGroups(live, {
      selectableGroupIds: [1, 3, 4],
      allowSelfSelect: true,
    });
    expect(offered.map((g) => g.id)).toEqual([1, 4]); // 3 (Graveyard) dropped
  });

  it("defaultSelectedGroupIds returns every offered group's id (opt-out)", () => {
    const offered = computeOfferedGroups(live, { selectableGroupIds: null, allowSelfSelect: true });
    expect(defaultSelectedGroupIds(offered)).toEqual([1, 2, 4]);
  });
});
