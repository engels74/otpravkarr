// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, UserMapping } from "$lib/db/types";
import type { DispatcharrChannel, DispatcharrResult } from "$lib/dispatcharr/types";

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
  createChannelEndpoints: vi.fn(() => ({
    getAllChannels: vi.fn(
      async (): Promise<DispatcharrResult<DispatcharrChannel[]>> => ({
        ok: true as const,
        data: [
          { id: 1, name: "Channel 1", channel_number: 1 },
          { id: 2, name: "Channel 2", channel_number: 2 },
        ],
      }),
    ),
  })),
  generateM3U: vi.fn(
    (_params: unknown) => "#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://host/live/u/p/1.ts\n",
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
    dispatcharr_group_ids: "[]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
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
    mocks.createChannelEndpoints.mockClear();
    mocks.generateM3U.mockClear();
    mocks.getSession.mockClear();
    mocks.getUserMappingById.mockClear();
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
    mocks.createChannelEndpoints.mockReturnValueOnce({
      getAllChannels: vi.fn(
        async (): Promise<DispatcharrResult<DispatcharrChannel[]>> => ({
          ok: false as const,
          error: "server_error",
          message: "API error",
        }),
      ),
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
});
