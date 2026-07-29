// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import type {
  DispatcharrChannel,
  DispatcharrResult,
  DispatcharrUser,
} from "$lib/dispatcharr/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const pluginMutation = (endpoint: string) =>
    vi.fn(() => {
      throw new Error(`Subscription enforcement must not call ${endpoint}`);
    });

  return {
    configValues: new Map<string, string | null>(),
    prepare: vi.fn(),
    updatePluginSettings: pluginMutation("plugin settings"),
    runPlugin: pluginMutation("plugin run"),
    enablePlugin: pluginMutation("plugin enable"),
    disablePlugin: pluginMutation("plugin disable"),
  };
});

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: vi.fn(),
  updateUserMapping: vi.fn(),
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: vi.fn(),
}));
vi.mock("$lib/db/repositories/config", () => ({
  getConfig: vi.fn(async (key: string) => mocks.configValues.get(key) ?? null),
}));

// Keep subscription-config real while isolating its dynamic catalog query from
// bun:sqlite, which is unavailable in the node test environment.
vi.mock("$lib/db/connection", () => ({
  db: { prepare: mocks.prepare },
}));

// Mock the repo so importing the real group-profiles module does not pull in
// $lib/db/connection (bun:sqlite), which is unavailable in the node test env.
vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getGroupProfile: vi.fn(),
  getGroupProfilesByGroupIds: vi.fn(),
  upsertGroupProfile: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/channels", () => ({
  listAllChannels: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/users", () => ({
  findUserByUsername: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("$lib/dispatcharr/endpoints/plugins", () => ({
  updatePluginSettings: mocks.updatePluginSettings,
  runPlugin: mocks.runPlugin,
  enablePlugin: mocks.enablePlugin,
  disablePlugin: mocks.disablePlugin,
}));

// Keep buildGroupChannelMap real (pure), mock the profile-resolution helpers.
vi.mock("../group-profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../group-profiles")>();
  return {
    ...actual,
    reconcileGroupProfile: vi.fn(),
    ensureEmptyProfile: vi.fn(),
  };
});

// Instant retries.
vi.mock("$lib/utils/retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/utils/retry")>();
  return { ...actual, sleep: vi.fn(async () => {}) };
});

const { getUserMappingById, updateUserMapping } = await import("$lib/db/repositories/users");
const { appendAuditLog } = await import("$lib/db/repositories/audit");
const { getConfig } = await import("$lib/db/repositories/config");
const { getGroupProfile, getGroupProfilesByGroupIds } = await import(
  "$lib/db/repositories/channel-group-profiles"
);
const { listChannelGroups } = await import("$lib/dispatcharr/endpoints/channel-groups");
const { listAllChannels } = await import("$lib/dispatcharr/endpoints/channels");
const { findUserByUsername, getUser, updateUser } = await import(
  "$lib/dispatcharr/endpoints/users"
);
const { reconcileGroupProfile, ensureEmptyProfile } = await import("../group-profiles");
const { applyGroupSubscription, enforceLineupPolicySubscription } = await import(
  "../subscriptions"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const client = {} as import("$lib/dispatcharr/client").DispatcharrClient;
let currentMapping: UserMapping;

function makeMapping(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 1,
    plex_account_id: 12345,
    plex_uuid: "uuid",
    plex_username: "testuser",
    plex_email: null,
    plex_thumb: null,
    dispatcharr_user_id: 42,
    dispatcharr_username: "testuser",
    dispatcharr_xc_password_enc: "enc",
    dispatcharr_group_ids: "[]",
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

function makeUser(overrides: Partial<DispatcharrUser> = {}): DispatcharrUser {
  return {
    id: 42,
    username: "testuser",
    is_staff: false,
    is_superuser: false,
    user_level: 1,
    ...overrides,
  };
}

function ch(id: number, groupId: number | null): DispatcharrChannel {
  return { id, name: `ch${id}`, effective_channel_group_id: groupId };
}

function ok<T>(data: T): DispatcharrResult<T> {
  return { ok: true, data };
}
function setLineupPolicyConfig(values: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(values)) mocks.configValues.set(key, value);
}

function expectNoPluginMutation(): void {
  expect(mocks.updatePluginSettings).not.toHaveBeenCalled();
  expect(mocks.runPlugin).not.toHaveBeenCalled();
  expect(mocks.enablePlugin).not.toHaveBeenCalled();
  expect(mocks.disablePlugin).not.toHaveBeenCalled();
}

beforeEach(() => {
  currentMapping = makeMapping();
  vi.mocked(getUserMappingById)
    .mockReset()
    .mockImplementation(() => currentMapping);
  vi.mocked(updateUserMapping)
    .mockReset()
    .mockImplementation((_mappingId, updates) => Object.assign(currentMapping, updates));
  mocks.configValues.clear();
  mocks.prepare.mockReset().mockReturnValue({ all: () => [] });
  vi.mocked(getConfig).mockClear();
  mocks.updatePluginSettings.mockClear();
  mocks.runPlugin.mockClear();
  mocks.enablePlugin.mockClear();
  mocks.disablePlugin.mockClear();
  vi.mocked(appendAuditLog).mockReset();
  vi.mocked(getGroupProfile).mockReset().mockReturnValue(null);
  vi.mocked(getGroupProfilesByGroupIds).mockReset().mockReturnValue(new Map());
  vi.mocked(findUserByUsername).mockReset().mockResolvedValue(ok(makeUser()));
  vi.mocked(getUser).mockReset().mockResolvedValue(ok(makeUser()));
  vi.mocked(updateUser)
    .mockReset()
    .mockResolvedValue(ok(makeUser()) as DispatcharrResult<DispatcharrUser>);
  vi.mocked(listAllChannels)
    .mockReset()
    .mockResolvedValue(ok([ch(1, 1), ch(2, 1), ch(3, 2), ch(4, null)]));
  vi.mocked(listChannelGroups)
    .mockReset()
    .mockResolvedValue(
      ok([
        { id: 1, name: "Sports" },
        { id: 2, name: "News" },
      ]),
    );
  vi.mocked(reconcileGroupProfile)
    .mockReset()
    .mockImplementation(async (_client, groupId) => ok(100 + groupId));
  vi.mocked(ensureEmptyProfile).mockReset().mockResolvedValue(ok(999));
});

describe("enforceLineupPolicySubscription", () => {
  it("persists retained approved-selection intent before remotely enforcing it", async () => {
    setLineupPolicyConfig({
      lineup_policy_default: "approved_selection",
      default_selectable_groups: "[1,2]",
    });

    const result = await enforceLineupPolicySubscription(client, 1, {
      selectedApprovedGroupIds: [2],
    });

    expect(result).toMatchObject({ ok: true, data: { groupIds: [2], profileIds: [102] } });
    expect(updateUserMapping).toHaveBeenNthCalledWith(1, 1, {
      selected_approved_group_ids: "[2]",
    });
    expect(updateUserMapping.mock.invocationCallOrder[0]).toBeLessThan(
      updateUser.mock.invocationCallOrder[0],
    );
    expect(updateUserMapping).toHaveBeenLastCalledWith(1, {
      dispatcharr_group_ids: "[2]",
      dispatcharr_profile_id: null,
    });
    expectNoPluginMutation();
  });

  it("enforces only effective IDs, never the materialized access mirror", async () => {
    currentMapping = makeMapping({ dispatcharr_group_ids: "[1]" });
    setLineupPolicyConfig({
      lineup_policy_default: "fixed",
      lineup_fixed_group_ids: "[2]",
      default_selectable_groups: "[1,2]",
    });
    const result = await enforceLineupPolicySubscription(client, 1);

    expect(result).toMatchObject({ ok: true, data: { groupIds: [2], profileIds: [102] } });
    expect(reconcileGroupProfile).toHaveBeenCalledWith(client, 2, "News", new Set([3]));
    expect(updateUserMapping).toHaveBeenCalledOnce();
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[2]",
      dispatcharr_profile_id: null,
    });
  });

  it.each([
    ["unset", null],
    ["malformed", "not-json"],
  ])("fails closed through the empty-profile sentinel when approved policy is %s", async (_kind, approvedGroups) => {
    setLineupPolicyConfig({
      lineup_policy_default: "fixed",
      lineup_fixed_group_ids: "[1]",
      default_selectable_groups: approvedGroups,
    });

    const result = await enforceLineupPolicySubscription(client, 1);

    expect(result).toMatchObject({ ok: true, data: { groupIds: [], profileIds: [999] } });
    expect(ensureEmptyProfile).toHaveBeenCalledOnce();
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith(
      client,
      42,
      { channel_profiles: [999], user_level: 1 },
      8000,
    );
  });

  it("retains orphaned intent when remote enforcement fails", async () => {
    setLineupPolicyConfig({
      lineup_policy_default: "approved_selection",
      default_selectable_groups: "[1,2]",
    });
    vi.mocked(updateUser).mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "remote rejected profile assignment",
    });

    const result = await enforceLineupPolicySubscription(client, 1, {
      selectedApprovedGroupIds: [2],
    });

    expect(result).toMatchObject({ ok: false, error: "validation_error" });
    expect(updateUser).toHaveBeenCalledOnce();
    expect(currentMapping.selected_approved_group_ids).toBe("[2]");
    expect(updateUserMapping).toHaveBeenCalledOnce();
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      selected_approved_group_ids: "[2]",
    });
  });

  it("uses the low-level empty-profile sentinel when policy resolution has no effective groups", async () => {
    setLineupPolicyConfig({
      lineup_policy_default: "fixed",
      lineup_fixed_group_ids: "[1]",
      default_selectable_groups: "[2]",
    });

    const result = await enforceLineupPolicySubscription(client, 1);

    expect(result).toMatchObject({ ok: true, data: { groupIds: [], profileIds: [999] } });
    expect(ensureEmptyProfile).toHaveBeenCalledOnce();
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[]",
      dispatcharr_profile_id: 999,
    });
  });
});

describe("applyGroupSubscription", () => {
  it("scopes a single group: resolves its profile and assigns it with a non-admin user_level", async () => {
    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profileIds).toEqual([101]);
      expect(result.data.groupIds).toEqual([1]);
    }
    // Desired set passed to the resolver is exactly group 1's channels (by ID).
    expect(reconcileGroupProfile).toHaveBeenCalledWith(client, 1, "Sports", new Set([1, 2]));
    expect(updateUser).toHaveBeenCalledWith(
      client,
      42,
      {
        channel_profiles: [101],
        user_level: 1,
      },
      8000,
    );
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[1]",
      dispatcharr_profile_id: null,
    });
    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.group_changed" }),
    );
  });

  it("records the before/after group ids in the USER_GROUP_CHANGED audit entry", async () => {
    // ISSUE-002: the audit trail must surface what the assignment WAS so an admin
    // can see when a self-service save changed the pinned set.
    vi.mocked(getUserMappingById).mockReturnValue(makeMapping({ dispatcharr_group_ids: "[2]" }));

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(true);
    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.group_changed",
        detail: expect.objectContaining({ before_group_ids: [2], group_ids: [1] }),
      }),
    );
  });

  it("assigns the UNION of profiles for multiple groups", async () => {
    const result = await applyGroupSubscription(client, 1, [1, 2]);

    expect(result.ok).toBe(true);
    expect(reconcileGroupProfile).toHaveBeenCalledTimes(2);
    expect(updateUser).toHaveBeenCalledWith(
      client,
      42,
      {
        channel_profiles: [101, 102],
        user_level: 1,
      },
      8000,
    );
  });

  it("reconciles remote profile membership even when a local profile mapping exists", async () => {
    vi.mocked(getGroupProfilesByGroupIds).mockReturnValue(
      new Map([
        [
          1,
          {
            group_id: 1,
            profile_id: 501,
            profile_name: "otpravkarr:g1:stale",
            created_at: "2024-01-01 00:00:00",
            updated_at: "2024-01-01 00:00:00",
          },
        ],
        [
          2,
          {
            group_id: 2,
            profile_id: 502,
            profile_name: "otpravkarr:g2:stale",
            created_at: "2024-01-01 00:00:00",
            updated_at: "2024-01-01 00:00:00",
          },
        ],
      ]),
    );
    const result = await applyGroupSubscription(client, 1, [2, 1]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.profileIds).toEqual([101, 102]);
      expect(result.data.groupIds).toEqual([1, 2]);
    }
    expect(listAllChannels).toHaveBeenCalledOnce();
    expect(listChannelGroups).toHaveBeenCalledOnce();
    expect(reconcileGroupProfile).toHaveBeenCalledTimes(2);
    expect(getGroupProfilesByGroupIds).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith(
      client,
      42,
      {
        channel_profiles: [101, 102],
        user_level: 1,
      },
      8000,
    );
  });

  it("resolves a ZERO-group selection to the empty profile, NEVER an empty array", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: -1,
      profile_id: 599,
      profile_name: "otpravkarr:empty:stale",
      created_at: "2024-01-01 00:00:00",
      updated_at: "2024-01-01 00:00:00",
    });
    const result = await applyGroupSubscription(client, 1, []);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.profileIds).toEqual([999]);
    expect(ensureEmptyProfile).toHaveBeenCalledOnce();
    expect(getGroupProfile).not.toHaveBeenCalled();
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
    // The critical guarantee: channel_profiles is non-empty (a real empty profile).
    expect(updateUser).toHaveBeenCalledWith(
      client,
      42,
      {
        channel_profiles: [999],
        user_level: 1,
      },
      8000,
    );
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[]",
      dispatcharr_profile_id: 999,
    });
  });

  it("refuses to scope an admin-level (user_level >= 10) Dispatcharr user", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(ok(makeUser({ user_level: 10 })));

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation_error");
      expect(result.message).toContain("bypasses channel-profile filtering");
    }
    expect(updateUser).not.toHaveBeenCalled();
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid direct group id %s before discovery or patching", async (invalidId) => {
    const result = await applyGroupSubscription(client, 1, [invalidId]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation_error");
      expect(result.message).toContain("positive safe integers");
    }
    expect(findUserByUsername).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(listAllChannels).not.toHaveBeenCalled();
    expect(listChannelGroups).not.toHaveBeenCalled();
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(updateUserMapping).not.toHaveBeenCalled();
  });
  it("rejects non-existent group ids before patching the user", async () => {
    const result = await applyGroupSubscription(client, 1, [1, 1, 999]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation_error");
    expect(updateUser).not.toHaveBeenCalled();
    expect(updateUserMapping).not.toHaveBeenCalled();
  });

  it("returns not_found when the mapping does not exist", async () => {
    vi.mocked(getUserMappingById).mockReturnValue(null);

    const result = await applyGroupSubscription(client, 7, [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("returns validation_error when the mapping has no Dispatcharr user", async () => {
    vi.mocked(getUserMappingById).mockReturnValue(makeMapping({ dispatcharr_user_id: null }));

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation_error");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("propagates a channel-fetch failure and does not patch the user", async () => {
    vi.mocked(listAllChannels).mockResolvedValue({
      ok: false,
      // Non-transient so retryResult returns immediately (no real backoff).
      error: "auth_failure",
      message: "down",
    });

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("auth_failure");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("propagates a profile-resolution failure without patching the user", async () => {
    vi.mocked(reconcileGroupProfile).mockResolvedValue({
      ok: false,
      error: "server_error",
      message: "boom",
    });

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("server_error");
    expect(updateUser).not.toHaveBeenCalled();
    expect(updateUserMapping).not.toHaveBeenCalled();
  });

  it("propagates a user PATCH failure (leaves caller to clean up)", async () => {
    vi.mocked(updateUser).mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "bad",
    });

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(false);
    expect(updateUserMapping).not.toHaveBeenCalled();
    expect(appendAuditLog).not.toHaveBeenCalled();
  });
});
