// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccount, UserMapping } from "$lib/db/types";

const state = vi.hoisted(() => ({
  oauthCookie: "oauth-pin-id" as string | undefined,
  priorSessionCookie: undefined as string | undefined,
  configValues: {} as Record<string, string | null>,
  existingMappingByPlexId: null as UserMapping | null,
  cachedFriends: null as null | Array<{ id: number; email: string; status: string }>,
  configuredAdmin: {
    id: 1,
    username: "admin",
    password_hash: "hashed-password",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
  } as AdminAccount | null,
  friends: [{ id: 12345, email: "test@example.com", status: "accepted" }] as Array<{
    id: number;
    email: string;
    status: string;
  }>,
  provisionResult: {
    status: "provisioned",
    mapping: {
      id: 1,
      plex_account_id: 12345,
      plex_uuid: "abc-uuid",
      plex_username: "testuser",
      plex_email: "test@example.com",
      plex_thumb: null,
      dispatcharr_user_id: 10,
      dispatcharr_username: "testuser",
      dispatcharr_xc_password_enc: "enc-pw",
      dispatcharr_group_ids: "[]",
      dispatcharr_profile_id: null,
      provisioning_mode: "automatic" as const,
      is_active: 1,
      group_selection_locked: 0,
      is_owner: 0,
      created_at: "2024-01-01 00:00:00",
      updated_at: "2024-01-01 00:00:00",
      last_synced_at: null,
      last_accessed_at: null,
    } satisfies UserMapping,
  } as { status: string; mapping?: UserMapping; error?: string; initialPassword?: string },
}));

const mocks = vi.hoisted(() => ({
  completeOAuth: vi.fn(async (_id: string) => ({
    id: 12345,
    uuid: "abc-uuid",
    username: "testuser",
    email: "test@example.com",
    thumb: "https://plex.tv/thumb",
    authenticationToken: "plex-token",
  })),
  removePendingOAuth: vi.fn((_id: string) => {}),
  getAccount: vi.fn(async (_token: string) => ({
    id: 99999,
    uuid: "admin-uuid",
    username: "admin",
    email: "admin@example.com",
    thumb: "",
    authenticationToken: "admin-token",
  })),
  getCachedFriends: vi.fn(() => state.cachedFriends),
  fetchFriends: vi.fn(async () => [...state.friends]),
  provisionUser: vi.fn(async () => state.provisionResult),
  getConfig: vi.fn(async (key: string) => state.configValues[key] ?? null),
  getUserMappingByPlexId: vi.fn((_plexAccountId: number) => state.existingMappingByPlexId),
  createSession: vi.fn((_ref: string, _type: string, _ttl: number) => "session-id"),
  deleteSession: vi.fn((_id: string) => {}),
  updateLastAccessed: vi.fn((_id: number) => {}),
  getConfiguredAdminAccount: vi.fn(async () => state.configuredAdmin),
  DispatcharrClient: vi.fn(),
  sealInitialPasswordFlash: vi.fn(async (_password: string) => "sealed-initial-password"),
  listChannelGroups: vi.fn(async () => ({
    ok: true as const,
    data: [
      { id: 1, name: "Sports", channel_count: 3 },
      { id: 2, name: "News", channel_count: 2 },
    ],
  })),
}));

vi.mock("$lib/plex/oauth", () => ({
  completeOAuth: mocks.completeOAuth,
  removePendingOAuth: mocks.removePendingOAuth,
}));

vi.mock("$lib/plex/types", async () => {
  class PlexAuthError extends Error {
    override readonly name = "PlexAuthError" as const;
  }
  return { PlexAuthError };
});

vi.mock("$lib/plex/client", () => ({
  getAccount: mocks.getAccount,
}));

vi.mock("$lib/plex/friends", () => ({
  getCachedFriends: mocks.getCachedFriends,
  fetchFriends: mocks.fetchFriends,
}));

vi.mock("$lib/bridge/provisioner", () => ({
  provisionUser: mocks.provisionUser,
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("$lib/db/repositories/sessions", () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingByPlexId: mocks.getUserMappingByPlexId,
  updateLastAccessed: mocks.updateLastAccessed,
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: mocks.DispatcharrClient,
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: mocks.listChannelGroups,
}));

vi.mock("$lib/server/auth", () => ({
  ADMIN_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    maxAge: 3600,
  },
  ADMIN_SESSION_TTL: 3600,
  getConfiguredAdminAccount: mocks.getConfiguredAdminAccount,
  SESSION_COOKIE_NAME: "otpravkarr_session",
  USER_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 14400,
  },
  USER_SESSION_TTL: 14400,
  isSecure: false,
}));

vi.mock("$lib/server/initial-password-flash", () => ({
  INITIAL_PASSWORD_COOKIE_NAME: "otpravkarr_initial_password",
  INITIAL_PASSWORD_COOKIE_MAX_AGE: 120,
  sealInitialPasswordFlash: mocks.sealInitialPasswordFlash,
}));

function createCookies() {
  const set = vi.fn();
  const deleteFn = vi.fn();
  const get = vi.fn((name: string) => {
    if (name === "otpravkarr_oauth_id") return state.oauthCookie;
    if (name === "otpravkarr_session") return state.priorSessionCookie;
    return undefined;
  });
  return {
    cookies: { get, set, delete: deleteFn },
    set,
    deleteFn,
  };
}

function resetAll() {
  state.oauthCookie = "oauth-pin-id";
  state.priorSessionCookie = undefined;
  state.configValues = {
    plex_admin_token: "admin-plex-token",
    dispatcharr_url: "http://dispatcharr.local",
    dispatcharr_api_key: "api-key-123",
    default_group_id: "1",
    default_profile_id: "2",
    default_provisioning_mode: "automatic",
  };
  state.existingMappingByPlexId = null;
  state.cachedFriends = null;
  state.configuredAdmin = {
    id: 1,
    username: "admin",
    password_hash: "hashed-password",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
  };
  state.friends = [{ id: 12345, email: "test@example.com", status: "accepted" }];
  state.provisionResult = {
    status: "provisioned",
    mapping: {
      id: 1,
      plex_account_id: 12345,
      plex_uuid: "abc-uuid",
      plex_username: "testuser",
      plex_email: "test@example.com",
      plex_thumb: null,
      dispatcharr_user_id: 10,
      dispatcharr_username: "testuser",
      dispatcharr_xc_password_enc: "enc-pw",
      dispatcharr_group_ids: "[1]",
      dispatcharr_profile_id: 2,
      provisioning_mode: "automatic",
      is_active: 1,
      group_selection_locked: 0,
      is_owner: 0,
      created_at: "2024-01-01 00:00:00",
      updated_at: "2024-01-01 00:00:00",
      last_synced_at: null,
      last_accessed_at: null,
    },
  };

  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockClear" in fn) {
      (fn as ReturnType<typeof vi.fn>).mockClear();
    }
  }
}

describe("plex OAuth callback", () => {
  beforeEach(() => {
    resetAll();
  });

  it("throws 400 when OAuth cookie is missing", async () => {
    state.oauthCookie = undefined;
    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it("deletes OAuth cookie on load", async () => {
    const { load } = await import("./+page.server");
    const { cookies, deleteFn } = createCookies();

    try {
      await load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]);
    } catch {
      // redirect expected
    }

    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_oauth_id",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("throws 400 when completeOAuth fails with PlexAuthError", async () => {
    const { PlexAuthError } = await import("$lib/plex/types");
    mocks.completeOAuth.mockRejectedValueOnce(new PlexAuthError("OAuth expired"));

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it("re-throws unknown errors from completeOAuth", async () => {
    mocks.completeOAuth.mockRejectedValueOnce(new Error("network failure"));

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toThrow("network failure");
  });

  it("throws 500 when plex_admin_token is missing", async () => {
    state.configValues.plex_admin_token = null;

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 500,
    });
  });

  it("throws 403 when user is not in accepted friends list", async () => {
    state.friends = [{ id: 777, email: "other@example.com", status: "accepted" }];

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("throws 403 when matching invite is pending", async () => {
    state.friends = [{ id: 12345, email: "test@example.com", status: "pending" }];

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("throws 403 when matching mapping is inactive", async () => {
    state.existingMappingByPlexId = {
      id: 2,
      plex_account_id: 12345,
      plex_uuid: "inactive-uuid",
      plex_username: "inactive-user",
      plex_email: "inactive@example.com",
      plex_thumb: null,
      dispatcharr_user_id: 88,
      dispatcharr_username: "inactiveuser",
      dispatcharr_xc_password_enc: "enc-pw",
      dispatcharr_group_ids: "[1]",
      dispatcharr_profile_id: 2,
      provisioning_mode: "automatic",
      is_active: 0,
      group_selection_locked: 0,
      is_owner: 0,
      created_at: "2024-01-01 00:00:00",
      updated_at: "2024-01-01 00:00:00",
      last_synced_at: null,
      last_accessed_at: null,
    };

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(mocks.getUserMappingByPlexId).toHaveBeenCalledWith(12345);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("fetches fresh friends for authorization", async () => {
    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    try {
      await load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]);
    } catch {
      // redirect expected
    }

    expect(mocks.getAccount).toHaveBeenCalledWith("admin-plex-token");
    expect(mocks.fetchFriends).toHaveBeenCalled();
  });

  it("does not authorize from cached friends when fresh list denies access", async () => {
    state.cachedFriends = [{ id: 12345, email: "test@example.com", status: "accepted" }];
    state.friends = [{ id: 12345, email: "test@example.com", status: "pending" }];

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(mocks.fetchFriends).toHaveBeenCalled();
    expect(mocks.getCachedFriends).not.toHaveBeenCalled();
  });

  it("throws 500 when dispatcharr config is missing", async () => {
    state.configValues.dispatcharr_url = null;
    state.configValues.dispatcharr_api_key = null;

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 500,
    });
  });

  it("throws 502 with safe message when provisioning fails", async () => {
    state.provisionResult = { status: "failed", error: "DB error" };

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 502,
      body: { message: "Unable to set up your account. Please contact the administrator." },
    });
  });

  it("creates session, sets cookie, and redirects on success", async () => {
    const { load } = await import("./+page.server");
    const { cookies, set } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/",
    });

    expect(mocks.createSession).toHaveBeenCalledWith("1", "user", 14400);
    expect(set).toHaveBeenCalledWith(
      "otpravkarr_session",
      "session-id",
      expect.objectContaining({
        path: "/",
        httpOnly: true,
      }),
    );
    expect(mocks.updateLastAccessed).toHaveBeenCalledWith(1);
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("deletes prior session before creating a new one on re-auth", async () => {
    state.priorSessionCookie = "prior-session-id";
    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/",
    });

    expect(mocks.deleteSession).toHaveBeenCalledWith("prior-session-id");
    expect(mocks.createSession).toHaveBeenCalledWith("1", "user", 14400);
    const deleteOrder = mocks.deleteSession.mock.invocationCallOrder[0] ?? Infinity;
    const createOrder = mocks.createSession.mock.invocationCallOrder[0] ?? -Infinity;
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("stores encrypted one-time password flash in short-lived cookie for newly provisioned self-managed users", async () => {
    const mapping = state.provisionResult.mapping as UserMapping;
    state.provisionResult = {
      status: "provisioned",
      mapping: { ...mapping, provisioning_mode: "self_managed" },
      initialPassword: "TempPassword!23",
    };
    state.configValues.default_provisioning_mode = "self_managed";

    const { load } = await import("./+page.server");
    const { cookies, set } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/",
    });

    expect(set).toHaveBeenCalledWith(
      "otpravkarr_initial_password",
      "sealed-initial-password",
      expect.objectContaining({
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 120,
      }),
    );
    expect(mocks.sealInitialPasswordFlash).toHaveBeenCalledWith("TempPassword!23");
  });

  it("creates an admin session for the server owner and skips provisioning", async () => {
    mocks.completeOAuth.mockResolvedValueOnce({
      id: 99999,
      uuid: "admin-uuid",
      username: "admin",
      email: "admin@example.com",
      thumb: "",
      authenticationToken: "admin-token",
    });
    state.configValues.default_provisioning_mode = "self_managed";

    const { load } = await import("./+page.server");
    const { cookies, set } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/dashboard",
    });

    expect(mocks.getConfiguredAdminAccount).toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    expect(set).toHaveBeenCalledWith(
      "otpravkarr_session",
      "session-id",
      expect.objectContaining({
        path: "/",
        httpOnly: true,
        sameSite: "strict",
      }),
    );
    expect(mocks.fetchFriends).not.toHaveBeenCalled();
    expect(mocks.getUserMappingByPlexId).not.toHaveBeenCalled();
    expect(mocks.provisionUser).not.toHaveBeenCalled();
    expect(mocks.DispatcharrClient).not.toHaveBeenCalled();
    expect(mocks.sealInitialPasswordFlash).not.toHaveBeenCalled();
  });

  it("handles already_exists provisioning result", async () => {
    const mapping = state.provisionResult.mapping as UserMapping;
    state.provisionResult = {
      status: "already_exists",
      mapping,
    };

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/",
    });

    expect(mocks.createSession).toHaveBeenCalled();
  });

  it("passes correct provisioning parameters", async () => {
    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    try {
      await load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]);
    } catch {
      // redirect expected
    }

    expect(mocks.provisionUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        plexIdentity: expect.objectContaining({
          id: 12345,
          username: "testuser",
        }),
        mode: "automatic",
        groupIds: [1, 2],
      }),
      expect.objectContaining({
        actor: "testuser",
      }),
    );
  });

  it("deletes a prior session before creating an admin session for the server owner", async () => {
    mocks.completeOAuth.mockResolvedValueOnce({
      id: 99999,
      uuid: "admin-uuid",
      username: "admin",
      email: "admin@example.com",
      thumb: "",
      authenticationToken: "admin-token",
    });
    state.priorSessionCookie = "prior-session-id";

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/dashboard",
    });

    expect(mocks.deleteSession).toHaveBeenCalledWith("prior-session-id");
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    const deleteOrder = mocks.deleteSession.mock.invocationCallOrder[0] ?? Infinity;
    const createOrder = mocks.createSession.mock.invocationCallOrder[0] ?? -Infinity;
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("allows server owner through even when not in friends list", async () => {
    mocks.completeOAuth.mockResolvedValueOnce({
      id: 99999,
      uuid: "admin-uuid",
      username: "admin",
      email: "admin@example.com",
      thumb: "",
      authenticationToken: "admin-token",
    });
    state.friends = [];

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/dashboard",
    });

    expect(mocks.fetchFriends).not.toHaveBeenCalled();
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("ignores an inactive duplicate mapping for the server owner", async () => {
    mocks.completeOAuth.mockResolvedValueOnce({
      id: 99999,
      uuid: "admin-uuid",
      username: "admin",
      email: "admin@example.com",
      thumb: "",
      authenticationToken: "admin-token",
    });
    state.friends = [];
    state.existingMappingByPlexId = {
      id: 5,
      plex_account_id: 99999,
      plex_uuid: "admin-uuid",
      plex_username: "admin",
      plex_email: "admin@example.com",
      plex_thumb: null,
      dispatcharr_user_id: 50,
      dispatcharr_username: "admin",
      dispatcharr_xc_password_enc: "enc-pw",
      dispatcharr_group_ids: "[1]",
      dispatcharr_profile_id: 2,
      provisioning_mode: "automatic",
      is_active: 0,
      group_selection_locked: 0,
      is_owner: 0,
      created_at: "2024-01-01 00:00:00",
      updated_at: "2024-01-01 00:00:00",
      last_synced_at: null,
      last_accessed_at: null,
    };

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 303,
      location: "/dashboard",
    });

    expect(mocks.getUserMappingByPlexId).not.toHaveBeenCalled();
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("throws 500 when server owner cannot resolve a configured admin account", async () => {
    mocks.completeOAuth.mockResolvedValueOnce({
      id: 99999,
      uuid: "admin-uuid",
      username: "admin",
      email: "admin@example.com",
      thumb: "",
      authenticationToken: "admin-token",
    });
    state.configuredAdmin = null;

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({
      status: 500,
    });

    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("defaults to automatic mode when config says self_managed", async () => {
    state.configValues.default_provisioning_mode = "self_managed";

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    try {
      await load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]);
    } catch {
      // redirect expected
    }

    expect(mocks.provisionUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "self_managed",
      }),
      expect.objectContaining({
        actor: "testuser",
      }),
    );
  });

  it("calls removePendingOAuth immediately after completeOAuth succeeds", async () => {
    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    try {
      await load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]);
    } catch {
      // redirect expected
    }

    expect(mocks.removePendingOAuth).toHaveBeenCalledOnce();
    expect(mocks.removePendingOAuth).toHaveBeenCalledWith("oauth-pin-id");
    // Eviction must happen before provisioning (replay protection before side-effects).
    const evictOrder = mocks.removePendingOAuth.mock.invocationCallOrder[0] ?? Infinity;
    const provisionOrder = mocks.provisionUser.mock.invocationCallOrder[0] ?? -Infinity;
    expect(evictOrder).toBeLessThan(provisionOrder);
  });

  it("calls removePendingOAuth even when completeOAuth succeeds but provisioning fails", async () => {
    state.provisionResult = { status: "failed", error: "DB error" };

    const { load } = await import("./+page.server");
    const { cookies } = createCookies();

    await expect(
      load({ cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({ status: 502 });

    expect(mocks.removePendingOAuth).toHaveBeenCalledOnce();
    expect(mocks.removePendingOAuth).toHaveBeenCalledWith("oauth-pin-id");
  });

  it("replaying the same oauth_id after a successful flow hits the 400 error path", async () => {
    const { PlexAuthError } = await import("$lib/plex/types");

    // First call succeeds normally; second call simulates a consumed/evicted id.
    mocks.completeOAuth
      .mockResolvedValueOnce({
        id: 12345,
        uuid: "abc-uuid",
        username: "testuser",
        email: "test@example.com",
        thumb: "https://plex.tv/thumb",
        authenticationToken: "plex-token",
      })
      .mockRejectedValueOnce(new PlexAuthError("OAuth session not found or expired"));

    const { load } = await import("./+page.server");

    // First request — succeeds (redirect 303).
    const { cookies: cookies1 } = createCookies();
    await expect(
      load({ cookies: cookies1, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({ status: 303 });

    // Replay — same oauth_id but the server-side cache is now gone.
    const { cookies: cookies2 } = createCookies();
    await expect(
      load({ cookies: cookies2, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
        typeof load
      >[0]),
    ).rejects.toMatchObject({ status: 400 });
  });
});
