// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrChannel, DispatcharrResult } from "$lib/dispatcharr/types";

vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getGroupProfile: vi.fn(),
  upsertGroupProfile: vi.fn(),
}));

vi.mock("$lib/db/repositories/users", () => ({
  getAllUserMappings: vi.fn(),
  updateUserMapping: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/channel-groups", () => ({ listChannelGroups: vi.fn() }));
vi.mock("$lib/dispatcharr/endpoints/channels", () => ({ listAllChannels: vi.fn() }));
vi.mock("$lib/dispatcharr/endpoints/users", () => ({ updateUser: vi.fn() }));
vi.mock("$lib/dispatcharr/pagination", () => ({ fetchAllPages: vi.fn() }));

vi.mock("$lib/server/subscription-config", () => {
  const quarantineNames = new Set(["graveyard", "slow", "black screens"]);
  return {
    isQuarantineGroup: (name: string) => quarantineNames.has(name.trim().toLowerCase()),
  };
});

vi.mock("../group-profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../group-profiles")>();
  return { ...actual, reconcileGroupProfile: vi.fn(), ensureEmptyProfile: vi.fn() };
});

vi.mock("../subscriptions", () => ({ PROVISIONED_USER_LEVEL: 1, ADMIN_USER_LEVEL: 10 }));

vi.mock("$lib/utils/retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/utils/retry")>();
  return { ...actual, sleep: vi.fn(async () => {}) };
});

const { getGroupProfile } = await import("$lib/db/repositories/channel-group-profiles");
const { getAllUserMappings, updateUserMapping } = await import("$lib/db/repositories/users");
const { listChannelGroups } = await import("$lib/dispatcharr/endpoints/channel-groups");
const { listAllChannels } = await import("$lib/dispatcharr/endpoints/channels");
const { updateUser } = await import("$lib/dispatcharr/endpoints/users");
const { fetchAllPages } = await import("$lib/dispatcharr/pagination");
const { reconcileGroupProfile, ensureEmptyProfile } = await import("../group-profiles");
const { reconcileSubscriptions } = await import("../subscription-sync");

const client = {} as import("$lib/dispatcharr/client").DispatcharrClient;

function ok<T>(data: T): DispatcharrResult<T> {
  return { ok: true, data };
}

function makeMapping(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 1,
    plex_account_id: 1,
    plex_uuid: "u",
    plex_username: "alice",
    plex_email: null,
    plex_thumb: null,
    dispatcharr_user_id: 42,
    dispatcharr_username: "alice",
    dispatcharr_xc_password_enc: "e",
    dispatcharr_group_ids: "[1]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
    group_selection_locked: 0,
    is_owner: 0,
    created_at: "",
    updated_at: "",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

function ch(id: number, groupId: number): DispatcharrChannel {
  return { id, name: `c${id}`, effective_channel_group_id: groupId };
}

beforeEach(() => {
  vi.mocked(getAllUserMappings).mockReset().mockReturnValue([makeMapping()]);
  vi.mocked(updateUserMapping).mockReset();
  vi.mocked(getGroupProfile).mockReset().mockReturnValue(null);
  vi.mocked(listAllChannels)
    .mockReset()
    .mockResolvedValue(ok([ch(1, 1), ch(2, 1)]));
  vi.mocked(listChannelGroups)
    .mockReset()
    .mockResolvedValue(ok([{ id: 1, name: "Sports" }]));
  vi.mocked(reconcileGroupProfile).mockReset().mockResolvedValue(ok(100));
  vi.mocked(ensureEmptyProfile).mockReset().mockResolvedValue(ok(900));
  vi.mocked(updateUser)
    .mockReset()
    .mockResolvedValue(ok({ id: 42 }) as never);
  vi.mocked(fetchAllPages)
    .mockReset()
    .mockResolvedValue(ok([{ id: 42, username: "alice", user_level: 1 }]) as never);
});

describe("reconcileSubscriptions", () => {
  it("reconciles each subscribed group's profile once; no per-user write on pure membership drift", async () => {
    // Profile already mapped and reconcile returns the SAME id → not recreated.
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "otpravkarr:g1:Sports",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(reconcileGroupProfile).mockResolvedValue(ok(100));

    const report = await reconcileSubscriptions(client);

    expect(report.groupsReconciled).toBe(1);
    expect(report.profilesRecreated).toBe(0);
    expect(report.usersRepatched).toBe(0);
    expect(reconcileGroupProfile).toHaveBeenCalledWith(client, 1, "Sports", new Set([1, 2]));
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("re-patches users whose group-profile was recreated (id changed)", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "old",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(reconcileGroupProfile).mockResolvedValue(ok(200)); // recreated

    const report = await reconcileSubscriptions(client);

    expect(report.profilesRecreated).toBe(1);
    expect(report.usersRepatched).toBe(1);
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [200],
      user_level: 1,
    });
  });

  it("removes live quarantine groups before reconciliation and persists sanitized groups", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([
      makeMapping({ id: 1, dispatcharr_user_id: 42, dispatcharr_group_ids: "[1,2]" }),
    ]);
    vi.mocked(listAllChannels).mockResolvedValue(ok([ch(1, 1), ch(2, 2)]));
    vi.mocked(listChannelGroups).mockResolvedValue(
      ok([
        { id: 1, name: "Sports" },
        { id: 2, name: "Graveyard" },
      ]),
    );
    vi.mocked(getGroupProfile).mockImplementation((groupId) =>
      groupId === 1
        ? {
            group_id: 1,
            profile_id: 101,
            profile_name: "otpravkarr:g1:Sports",
            created_at: "",
            updated_at: "",
          }
        : null,
    );
    vi.mocked(reconcileGroupProfile).mockResolvedValue(ok(101));

    const report = await reconcileSubscriptions(client);

    expect(report.profilesRecreated).toBe(0);
    expect(report.usersRepatched).toBe(1);
    expect(reconcileGroupProfile).toHaveBeenCalledOnce();
    expect(reconcileGroupProfile).toHaveBeenCalledWith(client, 1, "Sports", new Set([1]));
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [101],
      user_level: 1,
    });
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[1]",
      dispatcharr_profile_id: null,
    });
  });

  it("moves quarantine-only subscriptions to the empty profile and persists zero groups", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([
      makeMapping({ id: 1, dispatcharr_user_id: 42, dispatcharr_group_ids: "[2]" }),
    ]);
    vi.mocked(listAllChannels).mockResolvedValue(ok([ch(2, 2)]));
    vi.mocked(listChannelGroups).mockResolvedValue(ok([{ id: 2, name: "Slow" }]));
    vi.mocked(getGroupProfile).mockImplementation((groupId) =>
      groupId === -1
        ? {
            group_id: -1,
            profile_id: 900,
            profile_name: "otpravkarr:empty",
            created_at: "",
            updated_at: "",
          }
        : null,
    );
    vi.mocked(ensureEmptyProfile).mockResolvedValue(ok(900));

    const report = await reconcileSubscriptions(client);

    expect(report.profilesRecreated).toBe(0);
    expect(report.usersRepatched).toBe(1);
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
    expect(ensureEmptyProfile).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [900],
      user_level: 1,
    });
    expect(updateUserMapping).toHaveBeenCalledWith(1, {
      dispatcharr_group_ids: "[]",
      dispatcharr_profile_id: 900,
    });
  });

  it("repoints a zero-group user to the empty profile when it was (re)created", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([
      makeMapping({ id: 1, dispatcharr_user_id: 42, dispatcharr_group_ids: "[]" }),
    ]);
    vi.mocked(getGroupProfile).mockReturnValue(null); // empty profile not yet known
    vi.mocked(ensureEmptyProfile).mockResolvedValue(ok(900));

    const report = await reconcileSubscriptions(client);

    expect(ensureEmptyProfile).toHaveBeenCalledOnce();
    expect(report.usersRepatched).toBe(1);
    expect(updateUser).toHaveBeenCalledWith(client, 42, {
      channel_profiles: [900],
      user_level: 1,
    });
  });

  it("records an error and skips the affected user when a group fails to reconcile", async () => {
    vi.mocked(reconcileGroupProfile).mockResolvedValue({
      ok: false,
      error: "server_error",
      message: "boom",
    });

    const report = await reconcileSubscriptions(client);

    expect(report.errors).toHaveLength(1);
    expect(report.usersRepatched).toBe(0);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("no-ops when there are no active subscribers", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([]);

    const report = await reconcileSubscriptions(client);

    expect(report).toEqual({
      groupsReconciled: 0,
      profilesRecreated: 0,
      usersRepatched: 0,
      errors: [],
    });
    expect(listAllChannels).not.toHaveBeenCalled();
  });

  it("aborts with an error when the channel list cannot be fetched", async () => {
    vi.mocked(listAllChannels).mockResolvedValue({
      ok: false,
      error: "auth_failure",
      message: "down",
    });

    const report = await reconcileSubscriptions(client);

    expect(report.errors[0]).toContain("Failed to list channels");
    expect(reconcileGroupProfile).not.toHaveBeenCalled();
  });
});
