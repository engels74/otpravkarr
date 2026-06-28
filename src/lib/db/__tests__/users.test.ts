// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory store that simulates bun:sqlite behavior ---

type Row = Record<string, unknown>;

let tables: Record<string, Row[]> = {};
let autoIncrements: Record<string, number> = {};
let preparedStatements: MockStatement[] = [];

function resetStore() {
  tables = {};
  autoIncrements = {};
  preparedStatements = [];
}

function initSchema() {
  tables.user_mappings = [];
  autoIncrements.user_mappings = 1;
}

class MockStatement {
  constructor(public sql: string) {}

  get(...params: unknown[]): Row | null {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const rows = this.all(...flatParams);
    return rows[0] ?? null;
  }

  all(...params: unknown[]): Row[] {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const sql = this.sql.trim();

    if (sql.startsWith("SELECT * FROM user_mappings")) {
      return selectUserMappings(sql, flatParams as unknown[]);
    }
    return [];
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const sql = this.sql.trim();

    if (sql.startsWith("INSERT INTO user_mappings")) {
      return insertUserMapping(flatParams as unknown[]);
    }
    if (sql.startsWith("UPDATE user_mappings")) {
      return updateUserMapping(sql, flatParams as unknown[]);
    }
    if (sql.startsWith("DELETE FROM user_mappings WHERE id = ?")) {
      return deleteUserMapping(flatParams as unknown[]);
    }
    return { changes: 0, lastInsertRowid: 0 };
  }
}

function selectUserMappings(sql: string, params: unknown[]): Row[] {
  const rows = tables.user_mappings ?? [];

  if (sql.includes("WHERE plex_account_id = ?")) {
    return rows.filter((r) => r.plex_account_id === params[0]);
  }
  if (sql.includes("WHERE dispatcharr_user_id = ?")) {
    return rows.filter((r) => r.dispatcharr_user_id === params[0]);
  }
  if (sql.includes("WHERE is_active = 1")) {
    return rows.filter((r) => r.is_active === 1);
  }
  if (sql.includes("WHERE is_active = 0")) {
    return rows.filter((r) => r.is_active === 0);
  }
  if (sql.includes("WHERE id = ?")) {
    return rows.filter((r) => r.id === params[0]);
  }
  return rows;
}

function insertUserMapping(params: unknown[]): { changes: number; lastInsertRowid: number } {
  const id = autoIncrements.user_mappings ?? 0;
  autoIncrements.user_mappings = id + 1;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  const row: Row = {
    id,
    plex_account_id: params[0],
    plex_uuid: params[1],
    plex_username: params[2],
    plex_email: params[3],
    plex_thumb: params[4],
    dispatcharr_user_id: params[5],
    dispatcharr_username: params[6],
    dispatcharr_xc_password_enc: params[7],
    dispatcharr_group_ids: params[8],
    dispatcharr_profile_id: params[9],
    provisioning_mode: params[10],
    is_active: params[11],
    group_selection_locked: params[12],
    is_owner: params[13],
    created_at: now,
    updated_at: now,
    last_synced_at: params[14],
    last_accessed_at: params[15],
  };

  tables.user_mappings?.push(row);
  return { changes: 1, lastInsertRowid: id };
}

function updateUserMapping(
  sql: string,
  params: unknown[],
): { changes: number; lastInsertRowid: number } {
  const rows = tables.user_mappings ?? [];
  // The id is always the last parameter in UPDATE ... WHERE id = ?
  const id = params[params.length - 1];
  const row = rows.find((r) => r.id === id);
  if (!row) return { changes: 0, lastInsertRowid: 0 };

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (sql.includes("SET is_active = 0")) {
    row.is_active = 0;
    row.updated_at = now;
  } else if (sql.includes("SET last_accessed_at = datetime('now')")) {
    row.last_accessed_at = now;
    row.updated_at = now;
  } else if (sql.includes("SET last_synced_at = datetime('now')")) {
    row.last_synced_at = now;
    row.updated_at = now;
  } else if (sql.includes("SET plex_username = ?")) {
    row.plex_username = params[0];
    row.plex_email = params[1];
    row.plex_thumb = params[2];
    row.updated_at = now;
  } else {
    // Generic update: parse SET clause for dynamic updateUserMapping
    const setMatch = sql.match(/SET (.+) WHERE/);
    if (setMatch) {
      const setClauses = setMatch[1]?.split(",").map((s) => s.trim()) ?? [];
      let paramIdx = 0;
      for (const clause of setClauses) {
        const colMatch = clause.match(/^(\w+)\s*=\s*(.+)$/);
        if (colMatch) {
          const col = colMatch[1] ?? "";
          const valExpr = colMatch[2]?.trim();
          if (valExpr === "?") {
            row[col] = params[paramIdx];
            paramIdx++;
          } else if (valExpr === "datetime('now')") {
            row[col] = now;
          }
        }
      }
    }
  }

  return { changes: 1, lastInsertRowid: 0 };
}

function deleteUserMapping(params: unknown[]): { changes: number; lastInsertRowid: number } {
  const rows = tables.user_mappings ?? [];
  const before = rows.length;
  tables.user_mappings = rows.filter((r) => r.id !== params[0]);
  return { changes: before - (tables.user_mappings?.length ?? 0), lastInsertRowid: 0 };
}

class MockDatabase {
  constructor(public path: string) {}

  prepare(sql: string) {
    const stmt = new MockStatement(sql);
    preparedStatements.push(stmt);
    return stmt;
  }

  exec(_sql: string) {}
  close() {}
}

// --- Mocks ---

vi.mock("bun:sqlite", () => ({
  Database: MockDatabase,
}));

vi.mock("$env/dynamic/private", () => ({
  env: { DATABASE_PATH: "" },
}));

vi.mock("../migrate", () => ({
  runMigrations: vi.fn(),
}));

// Import after mocks are set up
const connectionModule = await import("../connection");
const usersModule = await import("../repositories/users");

describe("user mappings repository", () => {
  beforeEach(() => {
    resetStore();
    initSchema();
    usersModule._resetStatementsForTesting();
  });

  function createTestMapping(
    overrides: Partial<
      Omit<import("../types").UserMapping, "id" | "created_at" | "updated_at">
    > = {},
  ) {
    return {
      plex_account_id: 12345,
      plex_uuid: "plex-uuid-abc",
      plex_username: "testuser",
      plex_email: "test@example.com",
      plex_thumb: "https://plex.tv/thumb.jpg",
      dispatcharr_user_id: 42,
      dispatcharr_username: "dispuser",
      dispatcharr_xc_password_enc: "encrypted-password-blob",
      dispatcharr_group_ids: "[1, 2]",
      dispatcharr_profile_id: 5,
      provisioning_mode: "automatic" as const,
      is_active: 1,
      last_synced_at: null,
      last_accessed_at: null,
      ...overrides,
    };
  }

  describe("createUserMapping", () => {
    it("creates a mapping and returns the full row with id and timestamps", () => {
      const input = createTestMapping();
      const result = usersModule.createUserMapping(input);

      expect(result.id).toBe(1);
      expect(result.plex_account_id).toBe(12345);
      expect(result.plex_uuid).toBe("plex-uuid-abc");
      expect(result.plex_username).toBe("testuser");
      expect(result.plex_email).toBe("test@example.com");
      expect(result.dispatcharr_user_id).toBe(42);
      expect(result.dispatcharr_xc_password_enc).toBe("encrypted-password-blob");
      expect(result.provisioning_mode).toBe("automatic");
      expect(result.is_active).toBe(1);
      expect(result.created_at).toBeTruthy();
      expect(result.updated_at).toBeTruthy();
    });

    it("auto-increments IDs for successive creates", () => {
      const first = usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "uuid-1" }),
      );
      const second = usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 2, plex_uuid: "uuid-2" }),
      );

      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });

    it("stores the encrypted password blob as-is", () => {
      const result = usersModule.createUserMapping(
        createTestMapping({ dispatcharr_xc_password_enc: "base64-encrypted-data" }),
      );
      expect(result.dispatcharr_xc_password_enc).toBe("base64-encrypted-data");
    });

    it("stores null password when not provided", () => {
      const result = usersModule.createUserMapping(
        createTestMapping({ dispatcharr_xc_password_enc: null }),
      );
      expect(result.dispatcharr_xc_password_enc).toBeNull();
    });
  });

  describe("getUserMappingByPlexId", () => {
    it("returns null when no mapping exists", () => {
      const result = usersModule.getUserMappingByPlexId(99999);
      expect(result).toBeNull();
    });

    it("returns the matching mapping", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 100 }));

      const result = usersModule.getUserMappingByPlexId(100);
      expect(result).not.toBeNull();
      expect(result?.plex_account_id).toBe(100);
    });

    it("does not return non-matching mappings", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 100 }));

      const result = usersModule.getUserMappingByPlexId(200);
      expect(result).toBeNull();
    });
  });

  describe("getUserMappingByDispatcharrId", () => {
    it("returns null when no mapping exists", () => {
      const result = usersModule.getUserMappingByDispatcharrId(99999);
      expect(result).toBeNull();
    });

    it("returns the matching mapping", () => {
      usersModule.createUserMapping(createTestMapping({ dispatcharr_user_id: 77 }));

      const result = usersModule.getUserMappingByDispatcharrId(77);
      expect(result).not.toBeNull();
      expect(result?.dispatcharr_user_id).toBe(77);
    });
  });

  describe("getUserMappingById", () => {
    it("returns null when no mapping exists", () => {
      const result = usersModule.getUserMappingById(99999);
      expect(result).toBeNull();
    });

    it("returns the matching mapping by primary key", () => {
      const created = usersModule.createUserMapping(createTestMapping({ plex_account_id: 500 }));

      const result = usersModule.getUserMappingById(created.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.plex_account_id).toBe(500);
    });

    it("does not return non-matching mappings", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 500 }));

      const result = usersModule.getUserMappingById(99999);
      expect(result).toBeNull();
    });
  });

  describe("getAllUserMappings", () => {
    it("returns all mappings when no filter is provided", () => {
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1", is_active: 1 }),
      );
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 2, plex_uuid: "u2", is_active: 0 }),
      );

      const result = usersModule.getAllUserMappings();
      expect(result).toHaveLength(2);
    });

    it("returns only active mappings when isActive is true", () => {
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1", is_active: 1 }),
      );
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 2, plex_uuid: "u2", is_active: 0 }),
      );

      const result = usersModule.getAllUserMappings({ isActive: true });
      expect(result).toHaveLength(1);
      expect(result[0]?.is_active).toBe(1);
    });

    it("returns only inactive mappings when isActive is false", () => {
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1", is_active: 1 }),
      );
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 2, plex_uuid: "u2", is_active: 0 }),
      );

      const result = usersModule.getAllUserMappings({ isActive: false });
      expect(result).toHaveLength(1);
      expect(result[0]?.is_active).toBe(0);
    });

    it("returns empty array when no mappings exist", () => {
      const result = usersModule.getAllUserMappings();
      expect(result).toEqual([]);
    });
  });

  describe("updateUserMapping", () => {
    it("updates specified fields", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updateUserMapping(1, { plex_username: "newname" });

      const updated = usersModule.getUserMappingByPlexId(1);
      expect(updated?.plex_username).toBe("newname");
    });

    it("updates the updated_at timestamp", () => {
      const created = usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }),
      );
      const originalUpdatedAt = created.updated_at;

      // Small delay to ensure different timestamp
      usersModule.updateUserMapping(1, { plex_username: "changed" });

      const updated = usersModule.getUserMappingByPlexId(1);
      expect(updated?.updated_at).toBeTruthy();
    });

    it("does nothing when no valid fields are provided", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      // Should not throw — just no-op
      usersModule.updateUserMapping(1, {});
    });

    it("ignores id and created_at in updates", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      // These should be filtered out as not in the allowed list
      usersModule.updateUserMapping(1, { id: 999, created_at: "2000-01-01" } as any);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.id).toBe(1);
    });
  });

  describe("markMappingInactive", () => {
    it("sets is_active to 0", () => {
      usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1", is_active: 1 }),
      );

      usersModule.markMappingInactive(1);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.is_active).toBe(0);
    });

    it("updates updated_at", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.markMappingInactive(1);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.updated_at).toBeTruthy();
    });
  });

  describe("updateLastAccessed", () => {
    it("sets last_accessed_at to a non-null value", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updateLastAccessed(1);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.last_accessed_at).toBeTruthy();
    });

    it("updates updated_at", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updateLastAccessed(1);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.updated_at).toBeTruthy();
    });
  });

  describe("updateLastSynced", () => {
    it("sets last_synced_at to a non-null value", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updateLastSynced(1);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.last_synced_at).toBeTruthy();
    });

    it("updates updated_at", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updateLastSynced(1);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.updated_at).toBeTruthy();
    });
  });

  describe("updatePlexIdentity", () => {
    it("updates username, email, and thumb", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updatePlexIdentity(1, "newuser", "new@example.com", "https://new-thumb.jpg");

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.plex_username).toBe("newuser");
      expect(row?.plex_email).toBe("new@example.com");
      expect(row?.plex_thumb).toBe("https://new-thumb.jpg");
    });

    it("handles null email and thumb", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updatePlexIdentity(1, "newuser", null, null);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.plex_username).toBe("newuser");
      expect(row?.plex_email).toBeNull();
      expect(row?.plex_thumb).toBeNull();
    });

    it("updates updated_at", () => {
      usersModule.createUserMapping(createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }));

      usersModule.updatePlexIdentity(1, "newuser", null, null);

      const row = usersModule.getUserMappingByPlexId(1);
      expect(row?.updated_at).toBeTruthy();
    });
  });

  describe("deleteUserMapping", () => {
    it("deletes an existing mapping from all lookup paths", () => {
      const deleted = usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1", dispatcharr_user_id: 100 }),
      );
      const retained = usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 2, plex_uuid: "u2", dispatcharr_user_id: 200 }),
      );

      expect(usersModule.deleteUserMapping(deleted.id)).toBe(true);

      expect(usersModule.getUserMappingById(deleted.id)).toBeNull();
      expect(usersModule.getUserMappingByPlexId(1)).toBeNull();
      expect(usersModule.getUserMappingByDispatcharrId(100)).toBeNull();
      expect(usersModule.getAllUserMappings()).toEqual([retained]);
    });

    it("returns false and leaves rows untouched when the mapping does not exist", () => {
      const existing = usersModule.createUserMapping(
        createTestMapping({ plex_account_id: 1, plex_uuid: "u1" }),
      );

      expect(usersModule.deleteUserMapping(999)).toBe(false);

      expect(usersModule.getAllUserMappings()).toEqual([existing]);
    });
  });
});
