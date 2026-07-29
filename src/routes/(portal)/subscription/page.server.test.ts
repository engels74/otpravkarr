// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";

type LoadResult = {
  policy: "fixed" | "core_bundles" | "approved_selection";
  bundles: { id: string; displayName: string; groupIds: number[] }[];
  selectedBundleIds: string[];
  offered: { id: number; name: string; channelCount: number | null }[];
  selected: number[];
  assignedGroups: { id: number; name: string; channelCount: number | null }[];
  locked: boolean;
  saved: boolean;
};

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getConfig: vi.fn(async (_key: string) => null as string | null),
  getUserMappingById: vi.fn(),
  listChannelGroups: vi.fn(async () => ({ ok: true as const, data: [] as unknown[] })),
  enforceLineupPolicySubscription: vi.fn(async () => ({
    ok: true as const,
    data: { profileIds: [10], groupIds: [1] },
  })),
  getLineupPolicySettings: vi.fn(),
  getLineupBundleCatalog: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("$lib/db/repositories/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("$lib/db/repositories/users", () => ({ getUserMappingById: mocks.getUserMappingById }));
vi.mock("$lib/dispatcharr/client", () => ({ DispatcharrClient: class DispatcharrClient {} }));
vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: mocks.listChannelGroups,
}));
vi.mock("$lib/bridge/subscriptions", () => ({
  enforceLineupPolicySubscription: mocks.enforceLineupPolicySubscription,
}));
vi.mock("$lib/server/subscription-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/server/subscription-config")>();
  return {
    ...actual,
    getLineupPolicySettings: mocks.getLineupPolicySettings,
    getLineupBundleCatalog: mocks.getLineupBundleCatalog,
  };
});

function makeMapping(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 1,
    plex_account_id: 12345,
    plex_uuid: "uuid",
    plex_username: "alice",
    plex_email: null,
    plex_thumb: null,
    dispatcharr_user_id: 42,
    dispatcharr_username: "alice",
    dispatcharr_xc_password_enc: "enc",
    // Materialized access is deliberately unrelated to retained lineup intent.
    dispatcharr_group_ids: "[99]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
    group_selection_locked: 0,
    is_owner: 0,
    lineup_policy_override: null,
    selected_bundle_ids: '["news"]',
    selected_approved_group_ids: "[2]",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

function loadEvent(search = "") {
  return {
    url: new URL(`http://localhost/subscription${search}`),
    getClientAddress: () => "127.0.0.1",
  };
}

function actionEvent(groupIds: unknown, bundleIds: unknown = []) {
  const body = new FormData();
  body.set("group_ids", JSON.stringify(groupIds));
  body.set("bundle_ids", JSON.stringify(bundleIds));
  return {
    request: new Request("http://localhost/subscription", { method: "POST", body }),
    url: new URL("http://localhost/subscription"),
    getClientAddress: () => "127.0.0.1",
  };
}

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(makeMapping());
  mocks.getConfig.mockReset().mockImplementation(async (key: string) => {
    if (key === "dispatcharr_url") return "https://d.example";
    if (key === "dispatcharr_api_key") return "key";
    if (key === "default_selectable_groups") return "[1,2]";
    return null;
  });
  mocks.getUserMappingById.mockReset().mockReturnValue(makeMapping());
  mocks.listChannelGroups.mockReset().mockResolvedValue({
    ok: true,
    data: [
      { id: 1, name: "Sports", channel_count: 3 },
      { id: 2, name: "News", channel_count: 2 },
      { id: 3, name: "Graveyard", channel_count: 9 },
      { id: 4, name: "Movies", channel_count: 4 },
    ],
  });
  mocks.enforceLineupPolicySubscription
    .mockReset()
    .mockResolvedValue({ ok: true, data: { profileIds: [10], groupIds: [1] } });
  mocks.getLineupPolicySettings.mockReset().mockResolvedValue({
    defaultPolicy: "core_bundles",
    fixedGroupIds: [],
    coreGroupIds: [1],
    approvedGroupIds: [1, 2],
    bundleCatalogVersion: 1,
  });
  mocks.getLineupBundleCatalog.mockReset().mockResolvedValue({
    version: 1,
    bundles: [{ id: "news", slug: "news", displayName: "News", enabled: true, groupIds: [2] }],
  });
});

describe("subscription load", () => {
  it("derives core and bundle intent from the resolver, not materialized IDs", async () => {
    const { load } = await import("./+page.server");
    const result = (await load(
      loadEvent() as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;

    expect(result.policy).toBe("core_bundles");
    expect(result.offered).toEqual([]);
    expect(result.selected).toEqual([]);
    expect(result.selectedBundleIds).toEqual(["news"]);
    expect(result.assignedGroups.map((group) => group.id)).toEqual([1, 2]);
    expect(result.assignedGroups.map((group) => group.id)).not.toContain(99);
    expect(mocks.getLineupPolicySettings).toHaveBeenCalled();
    expect(mocks.getLineupBundleCatalog).toHaveBeenCalled();
  });

  it("uses core_bundles as the resolver default when no explicit policy is configured", async () => {
    mocks.getLineupPolicySettings.mockResolvedValueOnce({
      defaultPolicy: "not-a-policy",
      fixedGroupIds: [2],
      coreGroupIds: [1],
      approvedGroupIds: [1, 2],
      bundleCatalogVersion: 1,
    });
    mocks.requireUser.mockResolvedValue(makeMapping({ selected_bundle_ids: "[]" }));
    const { load } = await import("./+page.server");

    const result = (await load(
      loadEvent() as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;

    expect(result.selected).toEqual([]);
    expect(result.assignedGroups.map((group) => group.id)).toEqual([1]);
  });

  it("marks the picker locked when self-select is disabled", async () => {
    mocks.getConfig.mockImplementation(async (key: string) => {
      if (key === "allow_user_self_select") return "false";
      if (key === "dispatcharr_url") return "https://d.example";
      if (key === "dispatcharr_api_key") return "key";
      if (key === "default_selectable_groups") return "[1,2]";
      return null;
    });
    const { load } = await import("./+page.server");
    const result = (await load(
      loadEvent("?saved=1") as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;

    expect(result.locked).toBe(true);
    expect(result.saved).toBe(true);
  });
});

describe("subscription save action", () => {
  it("persists approved-selection intent through the shared policy enforcement bridge", async () => {
    mocks.getLineupPolicySettings.mockResolvedValueOnce({
      defaultPolicy: "approved_selection",
      fixedGroupIds: [],
      coreGroupIds: [],
      approvedGroupIds: [1, 2],
      bundleCatalogVersion: 1,
    });
    const { actions } = await import("./+page.server");

    await expect(
      actions.save?.(actionEvent([2]) as unknown as Parameters<typeof actions.save>[0]),
    ).rejects.toMatchObject({ status: 303, location: "/subscription?saved=1" });

    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      { selectedApprovedGroupIds: [2] },
      { actor: "alice", ipAddress: "127.0.0.1" },
    );
  });

  it("fails closed for zero selections when no approved groups are configured", async () => {
    mocks.getLineupPolicySettings.mockResolvedValueOnce({
      defaultPolicy: "approved_selection",
      fixedGroupIds: [],
      coreGroupIds: [],
      approvedGroupIds: null,
      bundleCatalogVersion: 1,
    });
    const { actions } = await import("./+page.server");

    await expect(
      actions.save?.(actionEvent([]) as unknown as Parameters<typeof actions.save>[0]),
    ).rejects.toMatchObject({ status: 303 });

    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      { selectedApprovedGroupIds: [] },
      expect.anything(),
    );
  });

  it("persists enabled bundle IDs in core-plus-bundles mode", async () => {
    const { actions } = await import("./+page.server");

    await expect(
      actions.save?.(actionEvent([], ["news"]) as unknown as Parameters<typeof actions.save>[0]),
    ).rejects.toMatchObject({ status: 303, location: "/subscription?saved=1" });

    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      { selectedBundleIds: ["news"] },
      { actor: "alice", ipAddress: "127.0.0.1" },
    );
  });

  it("rejects unknown bundle IDs before policy enforcement", async () => {
    const { actions } = await import("./+page.server");

    const result = await actions.save?.(
      actionEvent([], ["unknown"]) as unknown as Parameters<typeof actions.save>[0],
    );

    expect(result).toMatchObject({ status: 400 });
    expect(mocks.enforceLineupPolicySubscription).not.toHaveBeenCalled();
  });

  it("rejects invalid and out-of-approved selections before policy enforcement", async () => {
    const { actions } = await import("./+page.server");

    const invalid = await actions.save?.(
      actionEvent([0]) as unknown as Parameters<typeof actions.save>[0],
    );
    const outsideApproved = await actions.save?.(
      actionEvent([4]) as unknown as Parameters<typeof actions.save>[0],
    );

    expect(invalid).toMatchObject({ status: 400 });
    expect(outsideApproved).toMatchObject({ status: 400 });
    expect(mocks.enforceLineupPolicySubscription).not.toHaveBeenCalled();
  });

  it("rejects saves for a locked user without enforcing a policy", async () => {
    mocks.requireUser.mockResolvedValue(makeMapping({ group_selection_locked: 1 }));
    const { actions } = await import("./+page.server");

    const result = await actions.save?.(
      actionEvent([1]) as unknown as Parameters<typeof actions.save>[0],
    );

    expect(result).toMatchObject({ status: 403 });
    expect(mocks.enforceLineupPolicySubscription).not.toHaveBeenCalled();
  });
});
