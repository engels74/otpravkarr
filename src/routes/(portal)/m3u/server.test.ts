// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, UserMapping } from "$lib/db/types";
import type { DispatcharrChannel, DispatcharrResult } from "$lib/dispatcharr/types";
import type { M3UParams } from "$lib/url/m3u";

// Real generateM3U, pulled in once so individual cases can opt out of the mock
// and assert the literal scoped playlist body (kills the vacuous-pass risk).
const actualM3U = await vi.importActual<typeof import("$lib/url/m3u")>("$lib/url/m3u");

// Group ids used across the scoping fixtures.
const GROUP_A = 10;
const GROUP_B = 20;
const GROUP_C = 30; // never selected

const state = vi.hoisted(() => ({
  configValues: {} as Record<string, string | null>,
  session: null as Session | null,
  user: null as UserMapping | null,
}));

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(async (_enc: string, _purpose: string) => "decrypted-password"),
  getConfig: vi.fn(async (key: string) => state.configValues[key] ?? null),
  getDispatcharrPublicUrl: vi.fn(async () => state.configValues.dispatcharr_url ?? null),
  DispatcharrClient: vi.fn(),
  getSession: vi.fn((_id: string) => state.session),
  getUserMappingById: vi.fn((_id: number) => state.user),
  getAllChannels: vi.fn(),
  createChannelEndpoints: vi.fn(),
  generateM3U: vi.fn(
    (_params: M3UParams) => "#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://host/live/u/p/1.ts\n",
  ),
}));

vi.mock("$lib/crypto/encryption", () => ({
  decrypt: mocks.decrypt,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  getSession: mocks.getSession,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: mocks.getUserMappingById,
}));

vi.mock("$lib/db/repositories/admin", () => ({
  getAdminByUsername: vi.fn(() => null),
}));

// Cut the transitive db chain: the handler imports `buildGroupChannelMap` from
// `$lib/bridge/group-profiles`, which imports this repo, which imports the
// `db`/`bun:sqlite` singleton. `buildGroupChannelMap` itself is pure and does
// not touch the repo, so stubbing it keeps the node-env test import-safe.
vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getGroupProfile: vi.fn(),
  upsertGroupProfile: vi.fn(),
}));

vi.mock("$app/environment", () => ({
  dev: false,
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: mocks.DispatcharrClient,
}));

vi.mock("$lib/dispatcharr/endpoints/channels", () => ({
  createChannelEndpoints: mocks.createChannelEndpoints,
}));

vi.mock("$lib/url/m3u", () => ({
  generateM3U: mocks.generateM3U,
}));

vi.mock("$lib/url/resolve.server", () => ({
  getDispatcharrPublicUrl: mocks.getDispatcharrPublicUrl,
}));

const userSession: Session = {
  id: "sess-user-1",
  user_ref: "7",
  session_type: "user",
  expires_at: "2099-01-01 00:00:00",
  created_at: "2024-01-01 00:00:00",
};

/**
 * Channel fixture spanning every scoping case:
 * - 1 (A) / 2 (B): plain in-scope channels via raw group id
 * - 3 (C): in a non-selected group → excluded
 * - 4: raw group C (excluded) but effective group A (selected) → INCLUDED
 * - 5: raw group A (selected) but effective group C (excluded) → EXCLUDED
 * - 6: no group at all → never subscribable, excluded
 */
function fixtureChannels(): DispatcharrChannel[] {
  return [
    { id: 1, name: "Alpha", channel_number: 1, channel_group_id: GROUP_A },
    { id: 2, name: "Bravo", channel_number: 2, channel_group_id: GROUP_B },
    { id: 3, name: "Charlie", channel_number: 3, channel_group_id: GROUP_C },
    {
      id: 4,
      name: "DeltaOverrideIn",
      channel_number: 4,
      channel_group_id: GROUP_C,
      effective_channel_group_id: GROUP_A,
    },
    {
      id: 5,
      name: "EchoOverrideOut",
      channel_number: 5,
      channel_group_id: GROUP_A,
      effective_channel_group_id: GROUP_C,
    },
    { id: 6, name: "FoxtrotNoGroup", channel_number: 6 },
  ];
}

function channelsOk(channels: DispatcharrChannel[]): DispatcharrResult<DispatcharrChannel[]> {
  return { ok: true as const, data: channels };
}

function createUser(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 7,
    plex_account_id: 100,
    plex_uuid: "uuid",
    plex_username: "alice",
    plex_email: "alice@example.com",
    plex_thumb: null,
    dispatcharr_user_id: 42,
    dispatcharr_username: "alice_xc",
    dispatcharr_xc_password_enc: "encrypted-pw",
    // Real, non-empty selection so the success path is genuinely scoped.
    dispatcharr_group_ids: JSON.stringify([GROUP_A, GROUP_B]),
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

function createEvent(sessionId: string | undefined = "sess-user-1") {
  return {
    cookies: {
      get: (name: string) => (name === "otpravkarr_session" ? sessionId : undefined),
      delete: vi.fn(),
    },
  } as unknown as Parameters<typeof import("./+server").GET>[0];
}

/** Extract the `channels` arg the handler passed to generateM3U. */
function passedChannelIds(): number[] {
  const call = mocks.generateM3U.mock.calls[0]?.[0] as { channels: DispatcharrChannel[] };
  return call.channels.map((c) => c.id).sort((a, b) => a - b);
}

describe("portal /m3u GET endpoint", () => {
  beforeEach(() => {
    state.configValues = {
      dispatcharr_url: "https://dispatcharr.example",
      dispatcharr_api_key: "key",
    };
    state.session = { ...userSession };
    state.user = createUser();
    mocks.decrypt.mockClear();
    mocks.getConfig.mockClear();
    mocks.getDispatcharrPublicUrl.mockClear();
    mocks.generateM3U.mockClear();
    mocks.getSession.mockClear();
    mocks.getUserMappingById.mockClear();
    mocks.getAllChannels.mockReset();
    mocks.getAllChannels.mockResolvedValue(channelsOk(fixtureChannels()));
    mocks.createChannelEndpoints.mockReset();
    mocks.createChannelEndpoints.mockReturnValue({ getAllChannels: mocks.getAllChannels });
  });

  it("redirects unauthenticated requests to /", async () => {
    state.session = null;
    const { GET } = await import("./+server");

    await expect(
      GET({
        cookies: { get: () => undefined, delete: vi.fn() },
      } as unknown as Parameters<typeof GET>[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/",
    });
  });

  it("redirects inactive users to /", async () => {
    state.user = createUser({ is_active: 0 });
    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 303, location: "/" });
  });

  it("403s for non-automatic mode", async () => {
    state.user = createUser({ provisioning_mode: "self_managed" });
    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 403 });
  });

  it("400s when no credentials are provisioned", async () => {
    state.user = createUser({ dispatcharr_xc_password_enc: null });
    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 400 });
  });

  it("500s when Dispatcharr config is missing", async () => {
    state.configValues = {};
    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 500 });
  });

  it("500s when no safe public URL is available without fetching channels or decrypting", async () => {
    mocks.getDispatcharrPublicUrl.mockResolvedValueOnce(null);
    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 500 });
    expect(mocks.generateM3U).not.toHaveBeenCalled();
    expect(mocks.createChannelEndpoints).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("502s when channel fetch fails", async () => {
    mocks.getAllChannels.mockResolvedValueOnce({
      ok: false as const,
      error: "server_error",
      message: "API error",
    });

    const { GET } = await import("./+server");

    await expect(GET(createEvent())).rejects.toMatchObject({ status: 502 });
  });

  it("returns the M3U body with attachment headers on success", async () => {
    const { GET } = await import("./+server");

    const response = (await GET(createEvent())) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpegurl; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="alice_xc.m3u"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const body = await response.text();
    expect(body).toContain("#EXTM3U");

    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-pw", "credential-encryption");
    expect(mocks.generateM3U).toHaveBeenCalled();
  });

  it("sanitizes a hostile username for the filename", async () => {
    state.user = createUser({ dispatcharr_username: 'a"; rm -rf /; "' });
    const { GET } = await import("./+server");

    const response = (await GET(createEvent())) as Response;

    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition.startsWith('attachment; filename="')).toBe(true);
    expect(disposition).not.toContain('"; rm');
    expect(disposition).not.toContain("/");
  });

  it("passes only the selected groups' channels to generateM3U (effective group wins)", async () => {
    state.user = createUser({ dispatcharr_group_ids: JSON.stringify([GROUP_A, GROUP_B]) });
    const { GET } = await import("./+server");

    await GET(createEvent());

    // 1 (A) + 2 (B) + 4 (effective A); excludes 3 (C), 5 (effective C), 6 (no group).
    expect(passedChannelIds()).toEqual([1, 2, 4]);
  });

  it("emits exactly the scoped channels in the real playlist body (un-mocked generateM3U)", async () => {
    mocks.generateM3U.mockImplementationOnce(actualM3U.generateM3U);
    state.user = createUser({ dispatcharr_group_ids: JSON.stringify([GROUP_A, GROUP_B]) });
    const { GET } = await import("./+server");

    const response = (await GET(createEvent())) as Response;
    const body = await response.text();

    // Included channels (by name and by /{id}.ts stream URL).
    for (const name of ["Alpha", "Bravo", "DeltaOverrideIn"]) {
      expect(body).toContain(name);
    }
    expect(body).toContain("/1.ts");
    expect(body).toContain("/2.ts");
    expect(body).toContain("/4.ts");

    // Out-of-scope channels must be absent.
    for (const name of ["Charlie", "EchoOverrideOut", "FoxtrotNoGroup"]) {
      expect(body).not.toContain(name);
    }
    expect(body).not.toContain("/3.ts");
    expect(body).not.toContain("/5.ts");
    expect(body).not.toContain("/6.ts");
  });

  it("returns only the EXTM3U header for an empty group selection", async () => {
    mocks.generateM3U.mockImplementationOnce(actualM3U.generateM3U);
    state.user = createUser({ dispatcharr_group_ids: "[]" });
    const { GET } = await import("./+server");

    const response = (await GET(createEvent())) as Response;
    const body = await response.text();

    expect(body).toBe("#EXTM3U\n");
    expect(body).not.toContain("#EXTINF");
  });

  it("treats malformed dispatcharr_group_ids as an empty selection", async () => {
    mocks.generateM3U.mockImplementationOnce(actualM3U.generateM3U);
    state.user = createUser({ dispatcharr_group_ids: "not-json" });
    const { GET } = await import("./+server");

    const response = (await GET(createEvent())) as Response;
    const body = await response.text();

    expect(body).toBe("#EXTM3U\n");
  });

  it("scopes to a single selected group", async () => {
    state.user = createUser({ dispatcharr_group_ids: JSON.stringify([GROUP_B]) });
    const { GET } = await import("./+server");

    await GET(createEvent());

    expect(passedChannelIds()).toEqual([2]);
  });
});
