// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import type { DispatcharrResult } from "$lib/dispatcharr/types";

vi.mock("$lib/db/repositories/users", () => ({
  getAllUserMappings: vi.fn(),
  updateLastSynced: vi.fn(),
}));

// This is intentionally mocked as the policy boundary. Reconciliation must not
// reach into profile/group internals or Dispatcharr mutation endpoints itself.
vi.mock("../subscriptions", () => ({
  enforceLineupPolicySubscription: vi.fn(),
}));

vi.mock("$lib/dispatcharr/endpoints/users", () => ({ updateUser: vi.fn() }));

const { getAllUserMappings, updateLastSynced } = await import("$lib/db/repositories/users");
const { updateUser } = await import("$lib/dispatcharr/endpoints/users");
const { enforceLineupPolicySubscription } = await import("../subscriptions");
const { reconcileSubscriptions } = await import("../subscription-sync");

const client = {} as import("$lib/dispatcharr/client").DispatcharrClient;

function ok(groupIds: number[]): DispatcharrResult<{ profileIds: number[]; groupIds: number[] }> {
  return { ok: true, data: { profileIds: groupIds.map((id) => id + 100), groupIds } };
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
    // Materialized Dispatcharr state is deliberately different from retained intent.
    dispatcharr_group_ids: "[99]",
    dispatcharr_profile_id: 199,
    provisioning_mode: "automatic",
    is_active: 1,
    group_selection_locked: 0,
    is_owner: 0,
    lineup_policy_override: "core_bundles",
    selected_bundle_ids: '["sports"]',
    selected_approved_group_ids: "[7]",
    created_at: "",
    updated_at: "",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getAllUserMappings).mockReset().mockReturnValue([makeMapping()]);
  vi.mocked(updateLastSynced).mockReset();
  vi.mocked(enforceLineupPolicySubscription)
    .mockReset()
    .mockResolvedValue(ok([1]));
  vi.mocked(updateUser).mockReset();
});

describe("reconcileSubscriptions", () => {
  it("recomputes every active non-staff mapping through the retained-policy boundary, including the owner", async () => {
    const subscriber = makeMapping({
      id: 1,
      dispatcharr_user_id: 42,
      dispatcharr_group_ids: "[99]",
      selected_bundle_ids: '["sports"]',
      selected_approved_group_ids: "[7]",
    });
    const owner = makeMapping({
      id: 2,
      dispatcharr_user_id: 43,
      is_owner: 1,
      dispatcharr_group_ids: "[88]",
      lineup_policy_override: "approved_selection",
      selected_bundle_ids: "[]",
      selected_approved_group_ids: "[5,6]",
    });
    const staff = makeMapping({
      id: 4,
      dispatcharr_user_id: 45,
      is_owner: 1,
      provisioning_mode: "staff",
    });
    vi.mocked(getAllUserMappings).mockReturnValue([subscriber, owner, staff]);
    vi.mocked(enforceLineupPolicySubscription)
      .mockResolvedValueOnce(ok([7]))
      .mockResolvedValueOnce(ok([5, 6]));

    const report = await reconcileSubscriptions(client);

    expect(getAllUserMappings).toHaveBeenCalledWith({ isActive: true });
    expect(enforceLineupPolicySubscription).toHaveBeenCalledTimes(2);
    expect(enforceLineupPolicySubscription).toHaveBeenNthCalledWith(1, client, 1);
    expect(enforceLineupPolicySubscription).toHaveBeenNthCalledWith(2, client, 2);
    expect(enforceLineupPolicySubscription).not.toHaveBeenCalledWith(
      client,
      1,
      expect.objectContaining({ selectedApprovedGroupIds: [99] }),
    );
    expect(report).toEqual({
      groupsReconciled: 3,
      profilesRecreated: 0,
      usersRepatched: 2,
      errors: [],
    });
    expect(updateLastSynced).toHaveBeenCalledTimes(2);
    expect(updateLastSynced).toHaveBeenCalledWith(1);
    expect(updateLastSynced).toHaveBeenCalledWith(2);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("reports a policy-enforcement failure without stamping that mapping, while converged mappings still stamp", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([
      makeMapping({ id: 1, dispatcharr_user_id: 42 }),
      makeMapping({ id: 2, dispatcharr_user_id: 43, is_owner: 1 }),
    ]);
    vi.mocked(enforceLineupPolicySubscription)
      .mockResolvedValueOnce({
        ok: false,
        error: "validation_error",
        message: "policy could not be resolved",
      })
      .mockResolvedValueOnce(ok([3]));

    const report = await reconcileSubscriptions(client);

    expect(report).toEqual({
      groupsReconciled: 1,
      profilesRecreated: 0,
      usersRepatched: 1,
      errors: ["User 42: policy could not be resolved"],
    });
    expect(updateLastSynced).not.toHaveBeenCalledWith(1);
    expect(updateLastSynced).toHaveBeenCalledOnce();
    expect(updateLastSynced).toHaveBeenCalledWith(2);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does nothing when no active non-staff mappings remain", async () => {
    vi.mocked(getAllUserMappings).mockReturnValue([
      makeMapping({
        id: 1,
        dispatcharr_user_id: 42,
        is_owner: 1,
        provisioning_mode: "staff",
      }),
    ]);

    const report = await reconcileSubscriptions(client);

    expect(report).toEqual({
      groupsReconciled: 0,
      profilesRecreated: 0,
      usersRepatched: 0,
      errors: [],
    });
    expect(enforceLineupPolicySubscription).not.toHaveBeenCalled();
    expect(updateLastSynced).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
