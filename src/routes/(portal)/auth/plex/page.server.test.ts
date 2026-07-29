// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccount, UserMapping } from "$lib/db/types";

const state = vi.hoisted(() => ({
  oauthCookie: "oauth-pin-id" as string | undefined,
  onboardingCookie: undefined as string | undefined,
  configValues: {} as Record<string, string | null>,
  existingMappingByPlexId: null as UserMapping | null,
  configuredAdmin: {
    id: 1,
    username: "admin",
    password_hash: "hashed-password",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
  } as AdminAccount | null,
  friends: [{ id: 12345, email: "test@example.com", status: "accepted" }],
  identity: {
    id: 12345,
    uuid: "abc-uuid",
    username: "testuser",
    email: "test@example.com",
    thumb: "https://plex.tv/thumb",
  },
  accountId: 99999,
  channelGroups: [
    { id: 1, name: "Sports", channel_count: 3 },
    { id: 2, name: "News", channel_count: 2 },
    { id: 3, name: "Graveyard", channel_count: 9 },
    { id: 4, name: "Movies", channel_count: 4 },
  ],
  provisionResult: null as {
    status: string;
    mapping?: UserMapping;
    error?: string;
    initialPassword?: string;
  } | null,
}));

const mocks = vi.hoisted(() => ({
  completeOAuth: vi.fn(),
  removePendingOAuth: vi.fn(),
  getAccount: vi.fn(),
  fetchFriends: vi.fn(),
  provisionUser: vi.fn(),
  enforceLineupPolicySubscription: vi.fn(),
  getConfig: vi.fn(),
  getUserMappingByPlexId: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  updateLastAccessed: vi.fn(),
  getConfiguredAdminAccount: vi.fn(),
  DispatcharrClient: vi.fn(),
  sealInitialPasswordFlash: vi.fn(),
  sealOnboardingIdentity: vi.fn(),
  openOnboardingIdentity: vi.fn(),
  listChannelGroups: vi.fn(),
  getLineupPolicySettings: vi.fn(),
  getLineupBundleCatalog: vi.fn(),
  appendAuditLog: vi.fn(),
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
vi.mock("$lib/bridge/subscriptions", () => ({
  enforceLineupPolicySubscription: mocks.enforceLineupPolicySubscription,
}));
vi.mock("$lib/db/repositories/config", () => ({ getConfig: mocks.getConfig }));
vi.mock("$lib/db/repositories/sessions", () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
}));
vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingByPlexId: mocks.getUserMappingByPlexId,
  updateLastAccessed: mocks.updateLastAccessed,
}));
// Keep Node Vitest on mocked repository boundaries; no Bun SQLite module may load.
vi.mock("$lib/db/repositories/audit", () => ({ appendAuditLog: mocks.appendAuditLog }));
vi.mock("$lib/dispatcharr/client", () => ({ DispatcharrClient: mocks.DispatcharrClient }));
vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: mocks.listChannelGroups,
}));
vi.mock("$lib/server/subscription-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/server/subscription-config")>();
  return {
    ...actual,
    getLineupPolicySettings: mocks.getLineupPolicySettings,
    getLineupBundleCatalog: mocks.getLineupBundleCatalog,
  };
});
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

function mapping(): UserMapping {
  return {
    id: 1,
    plex_account_id: 12345,
    plex_uuid: "abc-uuid",
    plex_username: "testuser",
    plex_email: "test@example.com",
    plex_thumb: null,
    dispatcharr_user_id: 10,
    dispatcharr_username: "testuser",
    dispatcharr_xc_password_enc: "enc-pw",
    dispatcharr_group_ids: "[99]",
    dispatcharr_profile_id: 2,
    provisioning_mode: "automatic",
    is_active: 1,
    group_selection_locked: 0,
    is_owner: 0,
    lineup_policy_override: null,
    selected_bundle_ids: "[]",
    selected_approved_group_ids: "[]",
    created_at: "2024-01-01 00:00:00",
    updated_at: "2024-01-01 00:00:00",
    last_synced_at: null,
    last_accessed_at: null,
  };
}

function createCookies() {
  const set = vi.fn();
  const deleteFn = vi.fn();
  const get = vi.fn((name: string) => {
    if (name === "otpravkarr_oauth_id") return state.oauthCookie;
    if (name === "otpravkarr_onboarding") return state.onboardingCookie;
    return undefined;
  });
  return { cookies: { get, set, delete: deleteFn }, set, deleteFn };
}

function loadEvent() {
  const cookies = createCookies();
  return {
    event: { cookies: cookies.cookies, getClientAddress: () => "127.0.0.1" } as never,
    ...cookies,
  };
}

function confirmEvent(groupIds: unknown) {
  const cookies = createCookies();
  const body = new FormData();
  body.set("group_ids", JSON.stringify(groupIds));
  return {
    event: {
      cookies: cookies.cookies,
      request: { formData: async () => body },
      getClientAddress: () => "127.0.0.1",
    } as never,
    ...cookies,
  };
}

async function importServer() {
  return import("./+page.server");
}

function resetAll() {
  state.oauthCookie = "oauth-pin-id";
  state.onboardingCookie = undefined;
  state.configValues = {
    plex_admin_token: "admin-plex-token",
    dispatcharr_url: "http://dispatcharr.local",
    dispatcharr_api_key: "api-key-123",
    default_provisioning_mode: "automatic",
    default_selectable_groups: "[1,2]",
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
    { id: 3, name: "Graveyard", channel_count: 9 },
    { id: 4, name: "Movies", channel_count: 4 },
  ];
  state.provisionResult = { status: "provisioned", mapping: mapping() };

  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockReset" in fn) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }

  mocks.completeOAuth.mockImplementation(async () => ({
    ...state.identity,
    authenticationToken: "tok",
  }));
  mocks.getAccount.mockImplementation(async () => ({ id: state.accountId }));
  mocks.fetchFriends.mockImplementation(async () => [...state.friends]);
  mocks.provisionUser.mockImplementation(async () => state.provisionResult);
  mocks.enforceLineupPolicySubscription.mockResolvedValue({
    ok: true,
    data: { profileIds: [2], groupIds: [1] },
  });
  mocks.getConfig.mockImplementation(async (key: string) => state.configValues[key] ?? null);
  mocks.getUserMappingByPlexId.mockImplementation(() => state.existingMappingByPlexId);
  mocks.createSession.mockReturnValue("session-id");
  mocks.getConfiguredAdminAccount.mockImplementation(async () => state.configuredAdmin);
  mocks.sealInitialPasswordFlash.mockResolvedValue("sealed-initial-password");
  mocks.sealOnboardingIdentity.mockResolvedValue("sealed-onboarding");
  mocks.openOnboardingIdentity.mockImplementation(async () =>
    state.onboardingCookie ? state.identity : null,
  );
  mocks.listChannelGroups.mockImplementation(async () => ({
    ok: true as const,
    data: [...state.channelGroups],
  }));
  mocks.getLineupPolicySettings.mockResolvedValue({
    defaultPolicy: "core_bundles",
    fixedGroupIds: [],
    coreGroupIds: [1],
    approvedGroupIds: [1, 2],
    bundleCatalogVersion: 1,
  });
  mocks.getLineupBundleCatalog.mockResolvedValue({
    version: 1,
    bundles: [{ id: "news", slug: "news", displayName: "News", enabled: true, groupIds: [2] }],
  });
}

function provisionedGroupIds(): number[] {
  const [, request] = mocks.provisionUser.mock.calls[0] as [unknown, { groupIds: number[] }];
  return request.groupIds;
}

describe("plex OAuth callback — resolver-backed onboarding", () => {
  beforeEach(resetAll);

  it("shows a picker with the server-derived offered state without provisioning", async () => {
    const { load } = await importServer();
    const { event, set } = loadEvent();
    mocks.getLineupPolicySettings.mockResolvedValue({
      defaultPolicy: "approved_selection",
      fixedGroupIds: [],
      coreGroupIds: [],
      approvedGroupIds: [1, 2],
      bundleCatalogVersion: 1,
    });

    const data = await load(event);

    expect(data).toMatchObject({
      picker: true,
      offered: [
        { id: 1, name: "Sports", channelCount: 3 },
        { id: 2, name: "News", channelCount: 2 },
      ],
      selected: [1, 2],
    });
    expect(set).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      "sealed-onboarding",
      expect.objectContaining({ maxAge: 600 }),
    );
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("first-provisions the core_bundles default through resolved access, not materialized IDs", async () => {
    state.configValues.allow_user_self_select = "false";
    const { load } = await importServer();
    const { event } = loadEvent();

    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/" });

    expect(provisionedGroupIds()).toEqual([1]);
    expect(provisionedGroupIds()).not.toContain(99);
    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      {},
      { actor: "testuser", ipAddress: "127.0.0.1" },
    );
    expect(mocks.createSession).toHaveBeenCalledWith("1", "user", 14400);
  });

  it("first-provisions fixed policy access when the picker is unavailable", async () => {
    state.configValues.allow_user_self_select = "false";
    mocks.getLineupPolicySettings.mockResolvedValue({
      defaultPolicy: "fixed",
      fixedGroupIds: [2],
      coreGroupIds: [1],
      approvedGroupIds: [1, 2],
      bundleCatalogVersion: 1,
    });
    const { load } = await importServer();
    const { event } = loadEvent();

    await expect(load(event)).rejects.toMatchObject({ status: 303, location: "/" });

    expect(provisionedGroupIds()).toEqual([2]);
    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      {},
      expect.anything(),
    );
  });

  it("fails closed to zero access when approved policy data is absent", async () => {
    state.configValues.allow_user_self_select = "false";
    mocks.getLineupPolicySettings.mockResolvedValue({
      defaultPolicy: "core_bundles",
      fixedGroupIds: [],
      coreGroupIds: [1],
      approvedGroupIds: null,
      bundleCatalogVersion: 1,
    });
    const { load } = await importServer();
    const { event } = loadEvent();

    await expect(load(event)).rejects.toMatchObject({ status: 303 });
    expect(provisionedGroupIds()).toEqual([]);
  });
});

describe("plex onboarding — confirm action", () => {
  beforeEach(() => {
    resetAll();
    state.onboardingCookie = "sealed-onboarding";
  });

  it("rejects malformed, zero, and out-of-offered submissions before provisioning", async () => {
    const { actions } = await importServer();

    const malformedCookies = createCookies();
    const malformedBody = new FormData();
    malformedBody.set("group_ids", "{bad");
    const malformed = await actions.confirm?.({
      cookies: malformedCookies.cookies,
      request: { formData: async () => malformedBody },
      getClientAddress: () => "127.0.0.1",
    } as never);
    const zero = await actions.confirm?.(confirmEvent([0]).event);
    const outsideApproved = await actions.confirm?.(confirmEvent([4]).event);

    expect(malformed).toMatchObject({ status: 400 });
    expect(zero).toMatchObject({ status: 400 });
    expect(outsideApproved).toMatchObject({ status: 400 });
    expect(mocks.provisionUser).not.toHaveBeenCalled();
  });

  it("retains the submitted intent and creates no session when remote policy enforcement fails", async () => {
    mocks.getLineupPolicySettings.mockResolvedValueOnce({
      defaultPolicy: "approved_selection",
      fixedGroupIds: [],
      coreGroupIds: [],
      approvedGroupIds: [1, 2],
      bundleCatalogVersion: 1,
    });
    mocks.enforceLineupPolicySubscription.mockResolvedValueOnce({
      ok: false,
      error: "remote_failure",
      message: "Dispatcharr unavailable",
    });
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([2]);

    const result = await actions.confirm?.(event);

    expect(result).toMatchObject({
      status: 502,
      data: { selected: [2] },
    });
    expect(provisionedGroupIds()).toEqual([2]);
    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      { selectedApprovedGroupIds: [2] },
      expect.anything(),
    );
    expect(deleteFn).not.toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("enforces approved-group intent before clearing onboarding and creating a session", async () => {
    mocks.getLineupPolicySettings.mockResolvedValueOnce({
      defaultPolicy: "approved_selection",
      fixedGroupIds: [],
      coreGroupIds: [],
      approvedGroupIds: [1, 2],
      bundleCatalogVersion: 1,
    });
    const { actions } = await importServer();
    const { event, deleteFn } = confirmEvent([1]);

    await expect(actions.confirm?.(event)).rejects.toMatchObject({ status: 303, location: "/" });

    expect(provisionedGroupIds()).toEqual([1]);
    expect(mocks.enforceLineupPolicySubscription).toHaveBeenCalledWith(
      expect.anything(),
      1,
      { selectedApprovedGroupIds: [1] },
      { actor: "testuser", ipAddress: "127.0.0.1" },
    );
    expect(deleteFn).toHaveBeenCalledWith(
      "otpravkarr_onboarding",
      expect.objectContaining({ path: "/" }),
    );
    expect(mocks.createSession).toHaveBeenCalledWith("1", "user", 14400);
  });
});
