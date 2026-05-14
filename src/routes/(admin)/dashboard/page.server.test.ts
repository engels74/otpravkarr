// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMapping } from "$lib/db/types";
import type { PlexFriend } from "$lib/plex/types";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 1, username: "admin" })),
  queryAuditLog: vi.fn(() => ({ entries: [] })),
  getAllUserMappings: vi.fn(() => [] as UserMapping[]),
  getCachedFriends: vi.fn(() => null as PlexFriend[] | null),
  getHealthStatus: vi.fn(() => ({
    plex: { status: "healthy", lastChecked: "2025-01-01T00:00:00.000Z" },
    dispatcharr: {
      reachable: true,
      authValid: true,
      lastChecked: "2025-01-01T00:00:00.000Z",
    },
    database: { status: "healthy", lastChecked: "2025-01-01T00:00:00.000Z" },
  })),
  getJobStatus: vi.fn(() => null),
  tryResolveConfiguredPlexOwnerAccountId: vi.fn(async () => null as number | null),
}));

vi.mock("$lib/server/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("$lib/server/plex-owner", () => ({
  tryResolveConfiguredPlexOwnerAccountId: mocks.tryResolveConfiguredPlexOwnerAccountId,
  excludePlexOwnerMappings: <T extends { plex_account_id: number }>(
    mappings: T[],
    ownerPlexAccountId: number | null,
  ) =>
    ownerPlexAccountId == null
      ? mappings
      : mappings.filter((mapping) => mapping.plex_account_id !== ownerPlexAccountId),
}));

vi.mock("$lib/db/repositories/audit", () => ({
  queryAuditLog: mocks.queryAuditLog,
}));

vi.mock("$lib/db/repositories/users", () => ({
  getAllUserMappings: mocks.getAllUserMappings,
}));

vi.mock("$lib/plex/friends", () => ({
  getCachedFriends: mocks.getCachedFriends,
}));

vi.mock("$lib/scheduler/jobs/health", () => ({
  getHealthStatus: mocks.getHealthStatus,
}));

vi.mock("$lib/scheduler/runner", () => ({
  scheduler: {
    getJobStatus: mocks.getJobStatus,
  },
}));

function makeMapping(overrides?: Record<string, unknown>): UserMapping {
  return {
    id: 1,
    plex_account_id: 100,
    plex_uuid: "plex-uuid",
    plex_username: "regular-user",
    plex_email: "regular@example.com",
    plex_thumb: null,
    dispatcharr_user_id: 42,
    dispatcharr_username: "regular-user",
    dispatcharr_xc_password_enc: "encrypted",
    dispatcharr_group_ids: "[]",
    dispatcharr_profile_id: null,
    provisioning_mode: "automatic",
    is_active: 1,
    created_at: "2025-01-01 00:00:00",
    updated_at: "2025-01-01 00:00:00",
    last_synced_at: null,
    last_accessed_at: null,
    ...overrides,
  };
}

describe("admin dashboard load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryAuditLog.mockReturnValue({ entries: [] });
    mocks.getAllUserMappings.mockReturnValue([]);
    mocks.getCachedFriends.mockReturnValue(null);
    mocks.getJobStatus.mockReturnValue(null);
    mocks.tryResolveConfiguredPlexOwnerAccountId.mockResolvedValue(null);
  });

  it("excludes duplicate Plex-owner mappings from dashboard user stats", async () => {
    const { load } = await import("./+page.server");
    mocks.tryResolveConfiguredPlexOwnerAccountId.mockResolvedValueOnce(999);
    mocks.getAllUserMappings.mockReturnValueOnce([
      makeMapping({
        id: 1,
        plex_account_id: 999,
        plex_username: "plex-owner",
        provisioning_mode: "staff",
      }),
      makeMapping({ id: 2, plex_account_id: 100, plex_username: "active-user" }),
      makeMapping({
        id: 3,
        plex_account_id: 101,
        plex_username: "inactive-user",
        dispatcharr_user_id: null,
        provisioning_mode: "self_managed",
        is_active: 0,
      }),
    ]);

    const result = (await load({} as Parameters<typeof load>[0])) as {
      userStats: {
        total: number;
        active: number;
        inactive: number;
        orphaned: number;
        byMode: Record<string, number>;
      };
    };

    expect(result.userStats).toEqual({
      total: 2,
      active: 1,
      inactive: 1,
      orphaned: 0,
      byMode: { automatic: 1, self_managed: 1, staff: 0 },
    });
  });

  it("keeps regular unmapped accepted friends available while excluding mapped users and owner", async () => {
    const { load } = await import("./+page.server");
    mocks.tryResolveConfiguredPlexOwnerAccountId.mockResolvedValueOnce(999);
    mocks.getAllUserMappings.mockReturnValueOnce([
      makeMapping({ id: 1, plex_account_id: 999, plex_username: "plex-owner" }),
      makeMapping({ id: 2, plex_account_id: 100, plex_username: "mapped-user" }),
    ]);
    mocks.getCachedFriends.mockReturnValueOnce([
      { id: 999, email: "owner@example.com", status: "accepted" },
      { id: 100, email: "mapped@example.com", status: "accepted" },
      { id: 200, email: "new@example.com", status: "accepted" },
      { id: 300, email: "pending@example.com", status: "pending" },
    ]);

    const result = (await load({} as Parameters<typeof load>[0])) as {
      availableFriends: PlexFriend[] | null;
    };

    expect(result.availableFriends).toEqual([
      { id: 200, email: "new@example.com", status: "accepted" },
    ]);
  });
});
