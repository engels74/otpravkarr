// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatcharrChannel, DispatcharrResult } from "$lib/dispatcharr/types";

vi.mock("$lib/db/repositories/channel-group-profiles", () => ({
  EMPTY_PROFILE_GROUP_ID: -1,
  getGroupProfile: vi.fn(),
  upsertGroupProfile: vi.fn(),
  updateGroupProfileKnownChannels: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/profiles", () => ({
  getProfile: vi.fn(),
  createProfile: vi.fn(),
  bulkUpdateProfileMembership: vi.fn(),
  listProfiles: vi.fn(),
}));

vi.mock("$lib/utils/retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/utils/retry")>();
  return { ...actual, sleep: vi.fn(async () => {}) };
});

const { getGroupProfile, updateGroupProfileKnownChannels, upsertGroupProfile } = await import(
  "$lib/db/repositories/channel-group-profiles"
);
const { getProfile, createProfile, bulkUpdateProfileMembership, listProfiles } = await import(
  "$lib/dispatcharr/endpoints/profiles"
);
const {
  buildGroupChannelMap,
  profileNameForGroup,
  profileNameNeedsCsvRepair,
  reconcileGroupProfile,
  ensureEmptyProfile,
  EMPTY_PROFILE_NAME,
} = await import("../group-profiles");

const client = {} as import("$lib/dispatcharr/client").DispatcharrClient;

function ok<T>(data: T): DispatcharrResult<T> {
  return { ok: true, data };
}

function profile(id: number, name: string, channels: number[]) {
  return { id, name, channels };
}

beforeEach(() => {
  vi.mocked(getGroupProfile).mockReset().mockReturnValue(null);
  vi.mocked(upsertGroupProfile).mockReset();
  vi.mocked(updateGroupProfileKnownChannels).mockReset();
  vi.mocked(getProfile).mockReset();
  vi.mocked(createProfile).mockReset();
  vi.mocked(bulkUpdateProfileMembership).mockReset().mockResolvedValue(ok(null));
  vi.mocked(listProfiles).mockReset();
});

describe("buildGroupChannelMap", () => {
  it("buckets channels by effective group, falls back to channel_group_id, skips ungrouped", () => {
    const channels: DispatcharrChannel[] = [
      { id: 1, name: "a", effective_channel_group_id: 5 },
      { id: 2, name: "b", effective_channel_group_id: 5 },
      { id: 3, name: "c", channel_group_id: 7 }, // no effective → fallback
      { id: 4, name: "d", effective_channel_group_id: null, channel_group_id: null },
    ];
    const map = buildGroupChannelMap(channels);
    expect(map.get(5)).toEqual([1, 2]);
    expect(map.get(7)).toEqual([3]);
    expect(map.has(4)).toBe(false);
    expect(map.size).toBe(2);
  });
});

describe("profileNameForGroup", () => {
  it("produces a stable id-keyed, readable, length-capped name", () => {
    expect(profileNameForGroup(42, "Sports")).toBe("otpravkarr:g42:Sports");
    const long = profileNameForGroup(1, "x".repeat(200));
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.startsWith("otpravkarr:g1:")).toBe(true);
  });

  it("strips commas so the name round-trips through ECM's CSV scope field", () => {
    // A group name with a comma must not survive into the profile name: ECM's
    // channel_profile_name is comma-separated, so an embedded comma would split
    // the name on read-back and trigger perpetual re-appends.
    expect(profileNameForGroup(42, "Sports, News")).toBe("otpravkarr:g42:Sports News");
    expect(profileNameForGroup(7, "A,,B")).toBe("otpravkarr:g7:A B");
    expect(profileNameForGroup(7, "Sports, News")).not.toContain(",");
  });

  it("detects legacy comma-bearing profile names that need repair", () => {
    expect(profileNameNeedsCsvRepair("otpravkarr:g1:Sports, News")).toBe(true);
    expect(profileNameNeedsCsvRepair("otpravkarr:g1:Sports News")).toBe(false);
  });
});

describe("reconcileGroupProfile", () => {
  it("diffs an existing profile: enables missing channels and disables extras", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "otpravkarr:g1:Sports",
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(ok(profile(100, "otpravkarr:g1:Sports", [1, 2, 3])));

    const result = await reconcileGroupProfile(client, 1, "Sports", new Set([2, 3, 4]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(100);
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(
      client,
      100,
      expect.arrayContaining([
        { channel_id: 4, enabled: true },
        { channel_id: 1, enabled: false },
      ]),
    );
    const updates = vi.mocked(bulkUpdateProfileMembership).mock.calls[0]?.[2] ?? [];
    expect(updates).toHaveLength(2); // only the diff (2,3 already enabled & desired)
  });

  it("creates and scopes a brand-new profile (fresh profiles start all-enabled)", async () => {
    vi.mocked(getGroupProfile).mockReturnValue(null);
    // No existing prefix-owned profile, so the prefix scan falls through to create.
    vi.mocked(listProfiles).mockResolvedValue(ok([]));
    // A freshly created Dispatcharr profile reports ALL channels enabled.
    vi.mocked(createProfile).mockResolvedValue(
      ok(profile(200, "otpravkarr:g2:News", [1, 2, 3, 4])),
    );

    const result = await reconcileGroupProfile(client, 2, "News", new Set([3, 4]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(200);
    expect(upsertGroupProfile).toHaveBeenCalledWith(2, 200, "otpravkarr:g2:News");
    // Channels 1 and 2 must be disabled to scope the profile to {3,4}.
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(
      client,
      200,
      expect.arrayContaining([
        { channel_id: 1, enabled: false },
        { channel_id: 2, enabled: false },
      ]),
    );
  });

  it("recreates the profile when the locally-mapped profile was deleted (404)", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "stale",
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue({ ok: false, error: "not_found", message: "gone" });
    // Profile was deleted, so the prefix scan finds nothing and re-creates it.
    vi.mocked(listProfiles).mockResolvedValue(ok([]));
    vi.mocked(createProfile).mockResolvedValue(ok(profile(300, "otpravkarr:g1:Sports", [1, 2])));

    const result = await reconcileGroupProfile(client, 1, "Sports", new Set([1, 2]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(300);
    expect(upsertGroupProfile).toHaveBeenCalledWith(1, 300, "otpravkarr:g1:Sports");
  });

  it("makes no membership call when already aligned", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "otpravkarr:g1:Sports",
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(ok(profile(100, "otpravkarr:g1:Sports", [1, 2])));

    const result = await reconcileGroupProfile(client, 1, "Sports", new Set([1, 2]));

    expect(result.ok).toBe(true);
    expect(bulkUpdateProfileMembership).not.toHaveBeenCalled();
  });

  it("adopts an existing same-named profile on create collision", async () => {
    vi.mocked(getGroupProfile).mockReturnValue(null);
    vi.mocked(createProfile).mockResolvedValue({
      ok: false,
      error: "validation_error",
      message: "exists",
    });
    vi.mocked(listProfiles).mockResolvedValue(ok([{ id: 77, name: "otpravkarr:g1:Sports" }]));
    vi.mocked(getProfile).mockResolvedValue(ok(profile(77, "otpravkarr:g1:Sports", [1, 2])));

    const result = await reconcileGroupProfile(client, 1, "Sports", new Set([1, 2]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(77);
    expect(upsertGroupProfile).toHaveBeenCalledWith(1, 77, "otpravkarr:g1:Sports");
  });

  it("adopts the prefix-owned profile after a group rename instead of orphaning it", async () => {
    // Mapping lost (DB reset) while the Dispatcharr profile survived under its
    // OLD display name after a group rename. An exact-name match would miss it
    // and createProfile would succeed, orphaning the old profile behind a
    // second otpravkarr:g1:* one.
    vi.mocked(getGroupProfile).mockReturnValue(null);
    vi.mocked(listProfiles).mockResolvedValue(ok([{ id: 55, name: "otpravkarr:g1:OldName" }]));
    vi.mocked(getProfile).mockResolvedValue(ok(profile(55, "otpravkarr:g1:OldName", [1, 2])));

    const result = await reconcileGroupProfile(client, 1, "NewName", new Set([1, 2]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(55);
    expect(createProfile).not.toHaveBeenCalled();
    expect(upsertGroupProfile).toHaveBeenCalledWith(1, 55, "otpravkarr:g1:OldName");
  });

  it("repairs an actively mapped comma-bearing owned profile to the canonical name", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "otpravkarr:g1:Sports, News",
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(
      ok(profile(100, "otpravkarr:g1:Sports, News", [1, 2, 3])),
    );
    // Only the comma-bearing profile exists, so the prefix scan filters it out
    // (unsafe) and falls through to create the canonical comma-free name.
    vi.mocked(listProfiles).mockResolvedValue(
      ok([{ id: 100, name: "otpravkarr:g1:Sports, News" }]),
    );
    vi.mocked(createProfile).mockResolvedValue(
      ok(profile(200, "otpravkarr:g1:Sports News", [1, 2, 3])),
    );

    const result = await reconcileGroupProfile(client, 1, "Sports, News", new Set([2, 3]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(200);
    expect(createProfile).toHaveBeenCalledWith(client, "otpravkarr:g1:Sports News");
    expect(upsertGroupProfile).toHaveBeenCalledWith(1, 200, "otpravkarr:g1:Sports News");
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(client, 200, [
      { channel_id: 1, enabled: false },
    ]);
  });

  it("reuses an existing comma-free prefix profile during repair instead of creating a duplicate", async () => {
    // The active mapping still points at a comma-bearing profile, but a comma-free
    // prefix-owned profile already exists under a different suffix (e.g. a prior
    // repair landed, then the group was renamed). Repair must adopt that profile
    // rather than create a third one and leave it orphaned.
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "otpravkarr:g1:Sports, News",
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile)
      .mockResolvedValueOnce(ok(profile(100, "otpravkarr:g1:Sports, News", [1, 2, 3])))
      .mockResolvedValueOnce(ok(profile(150, "otpravkarr:g1:Old News", [1, 2])));
    vi.mocked(listProfiles).mockResolvedValue(
      ok([
        { id: 100, name: "otpravkarr:g1:Sports, News" },
        { id: 150, name: "otpravkarr:g1:Old News" },
      ]),
    );

    const result = await reconcileGroupProfile(client, 1, "Fresh News", new Set([2]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(150);
    expect(createProfile).not.toHaveBeenCalled();
    expect(upsertGroupProfile).toHaveBeenCalledWith(1, 150, "otpravkarr:g1:Old News");
  });

  it("does not adopt a comma-bearing prefix profile when rebuilding a lost mapping", async () => {
    vi.mocked(getGroupProfile).mockReturnValue(null);
    vi.mocked(listProfiles).mockResolvedValue(ok([{ id: 55, name: "otpravkarr:g1:Sports, News" }]));
    vi.mocked(createProfile).mockResolvedValue(
      ok(profile(201, "otpravkarr:g1:Sports News", [1, 2])),
    );

    const result = await reconcileGroupProfile(client, 1, "Sports, News", new Set([2]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(201);
    expect(createProfile).toHaveBeenCalledWith(client, "otpravkarr:g1:Sports News");
    expect(getProfile).not.toHaveBeenCalledWith(client, 55);
    expect(upsertGroupProfile).toHaveBeenCalledWith(1, 201, "otpravkarr:g1:Sports News");
  });
  it("preserves ECM-hidden event channels while enabling newly discovered channels", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 9,
      profile_id: 900,
      profile_name: "otpravkarr:g9:UK/English — PPV/Events",
      known_channel_ids: "[1,2]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(
      ok(profile(900, "otpravkarr:g9:UK/English — PPV/Events", [1])),
    );

    const result = await reconcileGroupProfile(
      client,
      9,
      "UK/English — PPV/Events",
      new Set([1, 2, 3]),
    );

    expect(result.ok).toBe(true);
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(client, 900, [
      { channel_id: 3, enabled: true },
    ]);
    expect(updateGroupProfileKnownChannels).toHaveBeenCalledWith(9, [1, 2, 3]);
  });

  it("seeds all event channels when no prior snapshot exists", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 9,
      profile_id: 900,
      profile_name: "otpravkarr:g9:UK/English — PPV/Events",
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(
      ok(profile(900, "otpravkarr:g9:UK/English — PPV/Events", [1])),
    );

    const result = await reconcileGroupProfile(
      client,
      9,
      "UK/English — PPV/Events",
      new Set([1, 2]),
    );

    expect(result.ok).toBe(true);
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(client, 900, [
      { channel_id: 2, enabled: true },
    ]);
    expect(updateGroupProfileKnownChannels).toHaveBeenCalledWith(9, [1, 2]);
  });

  it.each([
    "not-json",
    "{}",
    "[1,0]",
    "[1,2.5]",
    '[1,"2"]',
  ])("fails closed on an invalid event known-channel snapshot: %s", async (knownChannelIds) => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 9,
      profile_id: 900,
      profile_name: "otpravkarr:g9:UK/English — PPV/Events",
      known_channel_ids: knownChannelIds,
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(
      ok(profile(900, "otpravkarr:g9:UK/English — PPV/Events", [1])),
    );

    const result = await reconcileGroupProfile(
      client,
      9,
      "UK/English — PPV/Events",
      new Set([1, 2]),
    );

    expect(result).toEqual({
      ok: false,
      error: "server_error",
      message: "Invalid known-channel snapshot for group 9",
    });
    expect(bulkUpdateProfileMembership).not.toHaveBeenCalled();
    expect(updateGroupProfileKnownChannels).not.toHaveBeenCalled();
  });
  it("keeps exact membership reconciliation for non-event groups", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: 1,
      profile_id: 100,
      profile_name: "otpravkarr:g1:Sports",
      known_channel_ids: "[1,2]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(ok(profile(100, "otpravkarr:g1:Sports", [1])));

    const result = await reconcileGroupProfile(client, 1, "Sports", new Set([1, 2, 3]));

    expect(result.ok).toBe(true);
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(
      client,
      100,
      expect.arrayContaining([
        { channel_id: 2, enabled: true },
        { channel_id: 3, enabled: true },
      ]),
    );
  });
});

describe("ensureEmptyProfile", () => {
  it("creates the empty profile and disables every channel", async () => {
    vi.mocked(getGroupProfile).mockReturnValue(null);
    vi.mocked(createProfile).mockResolvedValue(ok(profile(900, EMPTY_PROFILE_NAME, [1, 2, 3])));

    const result = await ensureEmptyProfile(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(900);
    expect(upsertGroupProfile).toHaveBeenCalledWith(-1, 900, EMPTY_PROFILE_NAME);
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(
      client,
      900,
      expect.arrayContaining([
        { channel_id: 1, enabled: false },
        { channel_id: 2, enabled: false },
        { channel_id: 3, enabled: false },
      ]),
    );
  });

  it("disables any channels that drifted back into an existing empty profile", async () => {
    vi.mocked(getGroupProfile).mockReturnValue({
      group_id: -1,
      profile_id: 900,
      profile_name: EMPTY_PROFILE_NAME,
      known_channel_ids: "[]",
      created_at: "",
      updated_at: "",
    });
    vi.mocked(getProfile).mockResolvedValue(ok(profile(900, EMPTY_PROFILE_NAME, [5]))); // drift

    const result = await ensureEmptyProfile(client);

    expect(result.ok).toBe(true);
    expect(bulkUpdateProfileMembership).toHaveBeenCalledWith(client, 900, [
      { channel_id: 5, enabled: false },
    ]);
  });
});
