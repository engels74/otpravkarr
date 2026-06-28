// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";

type LoadResult = {
  offered: { id: number; name: string; channelCount: number | null }[];
  selected: number[];
  locked: boolean;
  saved: boolean;
};

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getConfig: vi.fn(async (_key: string) => null as string | null),
  getUserMappingById: vi.fn(),
  listChannelGroups: vi.fn(async () => ({ ok: true as const, data: [] as unknown[] })),
  applyGroupSubscription: vi.fn(async () => ({
    ok: true as const,
    data: { profileIds: [10], groupIds: [1] },
  })),
}));

vi.mock("$lib/server/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("$lib/db/repositories/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("$lib/db/repositories/users", () => ({ getUserMappingById: mocks.getUserMappingById }));
vi.mock("$lib/dispatcharr/client", () => ({ DispatcharrClient: class DispatcharrClient {} }));
vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: mocks.listChannelGroups,
}));
vi.mock("$lib/bridge/subscriptions", () => ({
  applyGroupSubscription: mocks.applyGroupSubscription,
}));

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
    dispatcharr_group_ids: "[1,2]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
    group_selection_locked: 0,
    is_owner: 0,
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

function actionEvent(body: FormData) {
  return {
    request: new Request("http://localhost/subscription", { method: "POST", body }),
    url: new URL("http://localhost/subscription"),
    getClientAddress: () => "127.0.0.1",
  };
}

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(makeMapping());
  mocks.getConfig
    .mockReset()
    .mockImplementation(async (key: string) =>
      key === "dispatcharr_url"
        ? "https://d.example"
        : key === "dispatcharr_api_key"
          ? "key"
          : null,
    );
  mocks.getUserMappingById.mockReset().mockReturnValue(makeMapping());
  mocks.listChannelGroups.mockReset().mockResolvedValue({
    ok: true,
    data: [
      { id: 1, name: "Sports", channel_count: 3 },
      { id: 2, name: "News", channel_count: 2 },
      { id: 3, name: "Graveyard", channel_count: 9 },
    ],
  });
  mocks.applyGroupSubscription
    .mockReset()
    .mockResolvedValue({ ok: true, data: { profileIds: [10], groupIds: [1] } });
});

describe("subscription load", () => {
  it("offers non-quarantine groups and intersects the saved selection", async () => {
    const { load } = await import("./+page.server");
    const result = (await load(
      loadEvent() as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;

    expect(result.offered.map((g) => g.id)).toEqual([1, 2]); // Graveyard excluded
    expect(result.selected).toEqual([1, 2]);
    expect(result.locked).toBe(false);
  });

  it("marks the picker locked when the user is individually locked", async () => {
    mocks.requireUser.mockResolvedValue(makeMapping({ group_selection_locked: 1 }));
    const { load } = await import("./+page.server");
    const result = (await load(
      loadEvent() as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;
    expect(result.locked).toBe(true);
  });

  it("marks the picker locked when self-select is globally disabled", async () => {
    mocks.getConfig.mockImplementation(async (key: string) => {
      if (key === "allow_user_self_select") return "false";
      if (key === "dispatcharr_url") return "https://d.example";
      if (key === "dispatcharr_api_key") return "key";
      return null;
    });
    const { load } = await import("./+page.server");
    const result = (await load(
      loadEvent() as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;
    expect(result.locked).toBe(true);
  });

  it("exposes the saved flag from the query string", async () => {
    const { load } = await import("./+page.server");
    const result = (await load(
      loadEvent("?saved=1") as unknown as Parameters<typeof load>[0],
    )) as unknown as LoadResult;
    expect(result.saved).toBe(true);
  });
});

describe("subscription save action", () => {
  it("enforces the selection through applyGroupSubscription and redirects", async () => {
    const { actions } = await import("./+page.server");
    const body = new FormData();
    body.set("group_ids", JSON.stringify([1, 2]));

    let redirected: { status: number; location: string } | null = null;
    try {
      await actions.save?.(actionEvent(body) as unknown as Parameters<typeof actions.save>[0]);
    } catch (e) {
      redirected = e as { status: number; location: string };
    }

    expect(mocks.applyGroupSubscription).toHaveBeenCalledWith(expect.anything(), 1, [1, 2], {
      actor: "alice",
      ipAddress: "127.0.0.1",
    });
    expect(redirected?.status).toBe(303);
    expect(redirected?.location).toBe("/subscription?saved=1");
  });

  it("refuses to save when the user is locked", async () => {
    mocks.requireUser.mockResolvedValue(makeMapping({ group_selection_locked: 1 }));
    const { actions } = await import("./+page.server");
    const body = new FormData();
    body.set("group_ids", JSON.stringify([1]));

    const result = await actions.save?.(
      actionEvent(body) as unknown as Parameters<typeof actions.save>[0],
    );

    expect(result).toMatchObject({ status: 403 });
    expect(mocks.applyGroupSubscription).not.toHaveBeenCalled();
  });

  it("rejects a malformed selection", async () => {
    const { actions } = await import("./+page.server");
    const body = new FormData();
    body.set("group_ids", "not json");

    const result = await actions.save?.(
      actionEvent(body) as unknown as Parameters<typeof actions.save>[0],
    );

    expect(result).toMatchObject({ status: 400 });
    expect(mocks.applyGroupSubscription).not.toHaveBeenCalled();
  });
});
