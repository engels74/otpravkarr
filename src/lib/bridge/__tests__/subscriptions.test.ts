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

vi.mock("$lib/db/repositories/users", () => ({
  getUserMappingById: vi.fn(),
  updateUserMapping: vi.fn(),
}));

vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: vi.fn(),
}));

// Mock the repo so importing the real group-profiles module does not pull in
// $lib/db/connection (bun:sqlite), which is unavailable in the node test env.
vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getGroupProfile: vi.fn(),
  upsertGroupProfile: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({
  listChannelGroups: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/channels", () => ({
  listAllChannels: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/users", () => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
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
const { listChannelGroups } = await import("$lib/dispatcharr/endpoints/channel-groups");
const { listAllChannels } = await import("$lib/dispatcharr/endpoints/channels");
const { getUser, updateUser } = await import("$lib/dispatcharr/endpoints/users");
const { reconcileGroupProfile, ensureEmptyProfile } = await import("../group-profiles");
const { applyGroupSubscription } = await import("../subscriptions");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const client = {} as import("$lib/dispatcharr/client").DispatcharrClient;

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

beforeEach(() => {
  vi.mocked(getUserMappingById).mockReset().mockReturnValue(makeMapping());
  vi.mocked(updateUserMapping).mockReset();
  vi.mocked(appendAuditLog).mockReset();
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
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [101],
      user_level: 1,
    });
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[1]",
      dispatcharr_profile_id: null,
    });
    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.group_changed" }),
    );
  });

  it("assigns the UNION of profiles for multiple groups", async () => {
    const result = await applyGroupSubscription(client, 1, [1, 2]);

    expect(result.ok).toBe(true);
    expect(reconcileGroupProfile).toHaveBeenCalledTimes(2);
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [101, 102],
      user_level: 1,
    });
  });

  it("resolves a ZERO-group selection to the empty profile, NEVER an empty array", async () => {
    const result = await applyGroupSubscription(client, 1, []);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.profileIds).toEqual([999]);
    expect(ensureEmptyProfile).toHaveBeenCalledOnce();
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
    // The critical guarantee: channel_profiles is non-empty (a real empty profile).
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [999],
      user_level: 1,
    });
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[]",
      dispatcharr_profile_id: 999,
    });
  });

  it("refuses to scope an admin-level (user_level >= 10) Dispatcharr user", async () => {
    vi.mocked(getUser).mockResolvedValue(ok(makeUser({ user_level: 10 })));

    const result = await applyGroupSubscription(client, 1, [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation_error");
      expect(result.message).toContain("bypasses channel-profile filtering");
    }
    expect(updateUser).not.toHaveBeenCalled();
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
  });

  it("drops duplicate and non-existent group ids before resolving", async () => {
    const result = await applyGroupSubscription(client, 1, [1, 1, 999]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.groupIds).toEqual([1]);
    expect(reconcileGroupProfile).toHaveBeenCalledTimes(1);
    expect(reconcileGroupProfile).toHaveBeenCalledWith(client, 1, "Sports", new Set([1, 2]));
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
