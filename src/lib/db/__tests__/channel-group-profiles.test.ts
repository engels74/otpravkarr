// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory stand-in for the bun:sqlite `db` proxy. Keyed by group_id,
// it models the repo's prepared statements (get / all / upsert / delete).

type Row = {
  group_id: number;
  profile_id: number;
  profile_name: string;
  known_channel_ids: string;
  created_at: string;
  updated_at: string;
};

let store: Map<number, Row>;

function makeStatement(sql: string) {
  const s = sql.trim();
  return {
    get(...params: unknown[]) {
      if (s.startsWith("SELECT * FROM channel_group_profiles WHERE group_id = ?")) {
        return store.get(params[0] as number) ?? null;
      }
      return null;
    },
    all() {
      return [...store.values()].sort((a, b) => a.group_id - b.group_id);
    },
    run(...params: unknown[]) {
      if (s.startsWith("INSERT INTO channel_group_profiles")) {
        const [groupId, profileId, profileName] = params as [number, number, string];
        const now = "2024-01-01 00:00:00";
        const existing = store.get(groupId);
        store.set(groupId, {
          group_id: groupId,
          profile_id: profileId,
          profile_name: profileName,
          known_channel_ids: existing?.known_channel_ids ?? "[]",
          created_at: existing?.created_at ?? now,
          updated_at: now,
        });
        return { changes: 1, lastInsertRowid: groupId };
      }
      if (s.startsWith("UPDATE channel_group_profiles")) {
        const [knownChannelIds, groupId] = params as [string, number];
        const existing = store.get(groupId);
        if (!existing) return { changes: 0, lastInsertRowid: 0 };
        store.set(groupId, {
          ...existing,
          known_channel_ids: knownChannelIds,
          updated_at: "2024-01-01 00:00:00",
        });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (s.startsWith("DELETE FROM channel_group_profiles WHERE group_id = ?")) {
        const deleted = store.delete(params[0] as number);
        return { changes: deleted ? 1 : 0, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    },
  };
}

vi.mock("../connection", () => ({
  db: { prepare: (sql: string) => makeStatement(sql) },
}));

const repo = await import("../repositories/channel-group-profiles");

beforeEach(() => {
  store = new Map();
  repo._resetStatementsForTesting();
});

describe("channel-group-profiles repository", () => {
  it("upserts and reads a single group→profile mapping", () => {
    repo.upsertGroupProfile(5, 100, "otpravkarr:g5:Sports");
    const row = repo.getGroupProfile(5);
    expect(row).toMatchObject({
      group_id: 5,
      profile_id: 100,
      profile_name: "otpravkarr:g5:Sports",
    });
  });

  it("returns null for an unknown group", () => {
    expect(repo.getGroupProfile(999)).toBeNull();
  });

  it("upsert replaces profile_id/name on conflict (same group)", () => {
    repo.upsertGroupProfile(5, 100, "old");
    repo.upsertGroupProfile(5, 200, "new");
    expect(repo.getGroupProfile(5)).toMatchObject({ profile_id: 200, profile_name: "new" });
    expect(repo.getAllGroupProfiles()).toHaveLength(1);
  });

  it("resolves several group ids into a Map, skipping the missing ones", () => {
    repo.upsertGroupProfile(1, 10, "a");
    repo.upsertGroupProfile(2, 20, "b");
    const map = repo.getGroupProfilesByGroupIds([1, 2, 3]);
    expect(map.size).toBe(2);
    expect(map.get(1)?.profile_id).toBe(10);
    expect(map.get(2)?.profile_id).toBe(20);
    expect(map.has(3)).toBe(false);
  });

  it("stores the empty-profile sentinel under EMPTY_PROFILE_GROUP_ID", () => {
    repo.upsertGroupProfile(repo.EMPTY_PROFILE_GROUP_ID, 900, "otpravkarr:empty");
    expect(repo.getGroupProfile(repo.EMPTY_PROFILE_GROUP_ID)?.profile_id).toBe(900);
    expect(repo.EMPTY_PROFILE_GROUP_ID).toBe(-1);
  });

  it("stores a normalized snapshot of known channel ids", () => {
    repo.upsertGroupProfile(5, 100, "x");
    repo.updateGroupProfileKnownChannels(5, [3, 1, 3, 2]);

    expect(repo.getGroupProfile(5)?.known_channel_ids).toBe("[1,2,3]");
  });
  it("deletes a mapping", () => {
    repo.upsertGroupProfile(5, 100, "x");
    expect(repo.deleteGroupProfile(5)).toBe(true);
    expect(repo.getGroupProfile(5)).toBeNull();
    expect(repo.deleteGroupProfile(5)).toBe(false);
  });
});
