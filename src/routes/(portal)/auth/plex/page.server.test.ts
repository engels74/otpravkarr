// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccount, UserMapping } from "$lib/db/types";

const state = vi.hoisted(() => ({
  oauthCookie: "oauth-pin-id" as string | undefined,
  onboardingCookie: undefined as string | undefined,
  priorSessionCookie: undefined as string | undefined,
  configValues: {} as Record<string, string | null>,
  existingMappingByPlexId: null as UserMapping | null,
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
  // Identity returned for both completeOAuth and the sealed onboarding cookie.
  identity: {
    id: 12345,
    uuid: "abc-uuid",
    username: "testuser",
    email: "test@example.com",
    thumb: "https://plex.tv/thumb",
  },
  // getAccount returns the SERVER OWNER's account. Default differs from the
  // friend identity (12345) so the default path is "non-owner friend".
  accountId: 99999,
  channelGroups: [
    { id: 1, name: "Sports", channel_count: 3 },
    { id: 2, name: "News", channel_count: 2 },
  ] as Array<{ id: number; name: string; channel_count: number }>,
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
      dispatcharr_group_ids: "[1,2]",
      dispatcharr_profile_id: 2,
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
  completeOAuth: vi.fn(async (_id: string) => ({ ...state.identity, authenticationToken: "tok" })),
  removePendingOAuth: vi.fn((_id: string) => {}),
  getAccount: vi.fn(async (_token: string) => ({ id: state.accountId })),
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
  sealOnboardingIdentity: vi.fn(async (_identity: unknown) => "sealed-onboarding"),
  openOnboardingIdentity: vi.fn(async (_sealed: string) =>
    state.onboardingCookie ? state.identity : null,
  ),
  listChannelGroups: vi.fn(async () => ({ ok: true as const, data: [...state.channelGroups] })),
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

vi.mock("$lib/plex/client", () => ({ getAccount: mocks.getAccount }));
vi.mock("$lib/plex/friends", () => ({ fetchFriends: mocks.fetchFriends }));
vi.mock("$lib/bridge/provisioner", () => ({ provisionUser: mocks.provisionUser }));
vi.mock("$lib/db/repositories/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("$lib/db/repositories/sessions", () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
}));
vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingByPlexId: mocks.getUserMappingByPlexId,
  updateLastAccessed: mocks.updateLastAccessed,
}));
vi.mock("$lib/dispatcharr/client", () => ({ DispatcharrClient: mocks.DispatcharrClient }));
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
  ADMIN_OAUTH_COOKIE_OPTIONS: {
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 3600,
  },
  ADMIN_SESSION_TTL: 3600,
  getConfiguredAdminAccount: mocks.getConfiguredAdminAccount,
  SESSION_COOKIE_NAME: "otpravkarr_session",
  USER_COOKIE_OPTIONS: { path: "/", httpOnly: true, secure: false, sameSite: "lax", maxAge: 14400 },
  USER_SESSION_TTL: 14400,
  isSecure: false,
}));

vi.mock("$lib/server/initial-password-flash", () => ({
  INITIAL_PASSWORD_COOKIE_NAME: "otpravkarr_initial_password",
  INITIAL_PASSWORD_COOKIE_MAX_AGE: 120,
  sealInitialPasswordFlash: mocks.sealInitialPasswordFlash,
}));

vi.mock("$lib/server/onboarding-flash", () => ({
  ONBOARDING_COOKIE_NAME: "otpravkarr_onboarding",
  ONBOARDING_COOKIE_MAX_AGE: 600,
  sealOnboardingIdentity: mocks.sealOnboardingIdentity,
  openOnboardingIdentity: mocks.openOnboardingIdentity,
}));

function createCookies() {
  const set = vi.fn();
  const deleteFn = vi.fn();
  const get = vi.fn((name: string) => {
    if (name === "otpravkarr_oauth_id") return state.oauthCookie;
    if (name === "otpravkarr_onboarding") return state.onboardingCookie;
    if (name === "otpravkarr_session") return state.priorSessionCookie;
    return undefined;
  });
  return { cookies: { get, set, delete: deleteFn }, set, deleteFn, get };
}

function loadEvent() {
  const c = createCookies();
  return {
    event: { cookies: c.cookies, getClientAddress: () => "127.0.0.1" } as unknown as Parameters<
      Awaited<ReturnType<typeof importServer>>["load"]
    >[0],
    ...c,
  };
}

function confirmEvent(groupIds: unknown = [1]) {
  const c = createCookies();
  const body = new FormData();
  body.set("group_ids", JSON.stringify(groupIds));
  return {
    event: {
      cookies: c.cookies,
      request: { formData: async () => body },
      getClientAddress: () => "127.0.0.1",
    } as never,
    ...c,
  };
}

async function importServer() {
  return import("./+page.server");
}

function resetAll() {
  state.oauthCookie = "oauth-pin-id";
  state.onboardingCookie = undefined;
  state.priorSessionCookie = undefined;
  state.configValues = {
    plex_admin_token: "admin-plex-token",
    dispatcharr_url: "http://dispatcharr.local",
    dispatcharr_api_key: "api-key-123",
    default_provisioning_mode: "automatic",
  };
  state.existingMappingByPlexId = null;
  state.configuredAdmin = {
    id: 1,
    username: "admin",
    password_hash: "hashed-password",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
  };
  state.friends = [{ id: 12345, email: "test@example.com", status: "accepted" }];
  state.accountId = 99999;
  state.channelGroups = [
    { id: 1, name: "Sports", channel_count: 3 },
    { id: 2, name: "News", channel_count: 2 },
  ];
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
      dispatcharr_group_ids: "[1,2]",
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

  // mockClear preserves implementations, but tests that override with persistent
  // mockResolvedValue would otherwise leak. Restore the state-reading defaults.
  mocks.listChannelGroups.mockImplementation(async () => ({
    ok: true as const,
    data: [...state.channelGroups],
  }));
  mocks.openOnboardingIdentity.mockImplementation(async (_sealed: string) =>
    state.onboardingCookie ? state.identity : null,
  );
}

function activeMapping(): UserMapping {
  return { ...(state.provisionResult.mapping as UserMapping), is_active: 1 };
}

describe("plex OAuth callback — load", () => {
  beforeEach(resetAll);

  it("throws 400 when neither OAuth nor onboarding cookie is present", async () => {
    state.oauthCookie = undefined;
    state.onboardingCookie = undefined;
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 400 });
  });

  it("deletes the OAuth cookie on a fresh handoff", async () => {
    const { load } = await importServer();
    const { event, deleteFn } = loadEvent();
    await load(event); // new user → picker (returns data, no throw)
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_oauth_id",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("throws 400 when completeOAuth fails with PlexAuthError", async () => {
    const { PlexAuthError } = await import("$lib/plex/types");
    mocks.completeOAuth.mockRejectedValueOnce(new PlexAuthError("OAuth expired"));
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 400 });
  });

  it("re-throws unknown errors from completeOAuth", async () => {
    mocks.completeOAuth.mockRejectedValueOnce(new Error("network failure"));
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toThrow("network failure");
  });

  it("throws 500 when plex_admin_token is missing", async () => {
    state.configValues.plex_admin_token = null;
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 500 });
  });

  it("logs the owner in as admin and redirects to /dashboard", async () => {
    state.accountId = 12345; // owner == identity
    const { load } = await importServer();
    const { event, set } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/dashboard" });
    expect(mocks.createSession).toHaveBeenCalledWith("admin", "admin", 3600);
    expect(mocks.provisionUser).not.toHaveBeenCalled();
    // ISSUE-001: the owner-OAuth admin cookie must be SameSite=Lax so it survives
    // the cross-site redirect to /dashboard. Strict would be withheld → /login.
    expect(set).toHaveBeenCalledWith(
      "otpravkarr_session",
      "session-id",
      expect.objectContaining({ sameSite: "lax" }),
    );
  });

  it("issues the owner-OAuth admin cookie as SameSite=Lax, not Strict", async () => {
    state.accountId = 12345; // owner == identity
    const { load } = await importServer();
    const { event, set } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/dashboard" });
    const sessionSet = set.mock.calls.find((call: unknown[]) => call[0] === "otpravkarr_session");
    expect(sessionSet).toBeDefined();
    const options = sessionSet?.[2] as { sameSite?: string } | undefined;
    expect(options?.sameSite).toBe("lax");
    expect(options?.sameSite).not.toBe("strict");
  });

  it("throws 403 when the Plex account is not an accepted friend", async () => {
    state.friends = [{ id: 12345, email: "test@example.com", status: "pending" }];
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 403 });
  });

  it("throws 403 when an existing mapping is revoked (inactive)", async () => {
    state.existingMappingByPlexId = { ...activeMapping(), is_active: 0 };
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 403 });
  });

  it("shows the mandatory picker for a new friend and does NOT provision yet", async () => {
    const { load } = await importServer();
    const { event, set } = loadEvent();
    const data = await load(event);

    expect(data).toMatchObject({
      picker: true,
      plexUsername: "testuser",
      offered: [
        { id: 1, name: "Sports", channelCount: 3 },
        { id: 2, name: "News", channelCount: 2 },
      ],
      selected: [1, 2],
    });
    // Verified identity sealed into the onboarding cookie; no provisioning.
    expect(mocks.sealOnboardingIdentity).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      "sealed-onboarding",
      expect.objectContaining({ maxAge: 600 }),
    );
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("skips the picker and provisions immediately when self-select is disabled", async () => {
    state.configValues.allow_user_self_select = "false";
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/" });
    expect(mocks.sealOnboardingIdentity).not.toHaveBeenCalled();
    expect(mocks.provisionUser).toHaveBeenCalledTimes(1);
    const [, request] = mocks.provisionUser.mock.calls[0] as unknown as [
      unknown,
      { groupIds: number[] },
    ];
    expect(request.groupIds).toEqual([1, 2]); // all offered by default
  });

  it("skips the picker when there are no offered groups", async () => {
    state.channelGroups = [];
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/" });
    expect(mocks.sealOnboardingIdentity).not.toHaveBeenCalled();
    expect(mocks.provisionUser).toHaveBeenCalledTimes(1);
  });

  it("skips the picker for a returning (already active) user", async () => {
    state.existingMappingByPlexId = activeMapping();
    state.provisionResult = { status: "already_exists", mapping: activeMapping() };
    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/" });
    expect(mocks.sealOnboardingIdentity).not.toHaveBeenCalled();
    expect(mocks.provisionUser).toHaveBeenCalledTimes(1);
  });

  it("throws 502 when the channel-group list is unavailable", async () => {
    mocks.listChannelGroups.mockResolvedValueOnce({
      ok: false,
      error: "auth_failure",
      message: "boom",
    } as never);

    const { load } = await importServer();
    const { event } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 502 });
  });

  it("re-renders the picker on refresh from the onboarding cookie (no OAuth)", async () => {
    state.oauthCookie = undefined;
    state.onboardingCookie = "sealed-onboarding";
    const { load } = await importServer();
    const { event } = loadEvent();
    const data = await load(event);
    expect(data).toMatchObject({ picker: true, plexUsername: "testuser" });
    expect(mocks.completeOAuth).not.toHaveBeenCalled();
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("on refresh, throws 400 and clears the cookie when self-select was disabled", async () => {
    state.oauthCookie = undefined;
    state.onboardingCookie = "sealed-onboarding";
    state.configValues.allow_user_self_select = "false";
    const { load } = await importServer();
    const { event, deleteFn } = loadEvent();
    await expect(load(event)).rejects.toMatchObject({ status: 400 });
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });
});

describe("plex onboarding — confirm action", () => {
  beforeEach(() => {
    resetAll();
    state.onboardingCookie = "sealed-onboarding";
  });

  it("fails 400 when the onboarding cookie is missing/expired", async () => {
    state.onboardingCookie = undefined;
    const { actions } = await importServer();
    const { event } = confirmEvent([1]);
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 400 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("fails 400 on a malformed selection", async () => {
    const { actions } = await importServer();
    const c = createCookies();
    const body = new FormData();
    body.set("group_ids", "{not json");
    const event = {
      cookies: c.cookies,
      request: { formData: async () => body },
      getClientAddress: () => "127.0.0.1",
    } as never;
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 400 });
  });

  it("fails 400 on a non-positive-integer selection", async () => {
    const { actions } = await importServer();
    const { event } = confirmEvent([0, -1]);
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 400 });
  });

  it("fails 400 when a selected group is outside the offered set", async () => {
    const { actions } = await importServer();
    const { event } = confirmEvent([1, 999]); // 999 not offered
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 400 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("fails 400 and clears the cookie when self-select was disabled after issue", async () => {
    state.configValues.allow_user_self_select = "false";
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([1]);
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 400 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("preserves the submitted selection when Plex re-verification is temporarily unavailable", async () => {
    mocks.getAccount.mockRejectedValueOnce(new Error("Plex timeout"));
    const { actions } = await importServer();
    const { event } = confirmEvent([2]);
    const res = await actions.confirm?.(event);

    expect(res).toMatchObject({
      status: 502,
      data: { error: "Couldn't reach Plex. Please try again.", selected: [2] },
    });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("fails 403 and clears the cookie when friend status no longer checks out", async () => {
    state.friends = [{ id: 12345, email: "test@example.com", status: "pending" }];
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([1]);
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 403 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("fails 403 and clears the cookie when the existing mapping is revoked", async () => {
    state.existingMappingByPlexId = { ...activeMapping(), is_active: 0 };
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([1]);
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 403 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("fails 502 without clearing onboarding or creating a session when provisioning fails", async () => {
    state.provisionResult = { status: "failed", error: "Dispatcharr unavailable" };
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([2, 1]);
    const res = await actions.confirm?.(event);

    expect(res).toMatchObject({
      status: 502,
      data: {
        error: "Unable to set up your account. Please try again.",
        selected: [2, 1],
      },
    });
    expect(mocks.provisionUser).toHaveBeenCalledTimes(1);
    expect(deleteFn).not.toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("provisions with the chosen groups, clears onboarding, creates a session, and redirects", async () => {
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([1]);
    await expect(actions.confirm?.(event)).rejects.toMatchObject({ status: 303, location: "/" });
    expect(mocks.provisionUser).toHaveBeenCalledTimes(1);
    const [, request] = mocks.provisionUser.mock.calls[0] as unknown as [
      unknown,
      { groupIds: number[] },
    ];
    expect(request.groupIds).toEqual([1]);
    expect(mocks.createSession).toHaveBeenCalledWith("1", "user", 14400);
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("fails 400 if the server owner reaches confirm", async () => {
    state.accountId = 12345; // owner == identity
    const { actions } = await importServer();
    const { event } = confirmEvent([1]);
    const res = await actions.confirm?.(event);
    expect(res).toMatchObject({ status: 400 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });
});
