// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory store simulating SQLite for the admin_accounts table
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

let adminRows: AdminRow[] = [];
let nextId = 1;

class MockStatement {
  constructor(private sql: string) {}

  get(...params: unknown[]): Row | null {
    const rows = this.all(...params);
    return rows[0] ?? null;
  }

  all(...params: unknown[]): Row[] {
    const sql = this.sql.trim();

    if (sql.includes("FROM admin_accounts WHERE username = ?")) {
      return adminRows.filter((r) => r.username === params[0]).map((r) => ({ ...r }));
    }

    if (sql.includes("COUNT(*)")) {
      return [{ count: adminRows.length }];
    }

    return [];
  }

  run(...params: unknown[]): { changes: number } {
    const sql = this.sql.trim();

    if (sql.startsWith("INSERT INTO admin_accounts")) {
      const username = params[0] as string;
      // Check unique constraint
      if (adminRows.some((r) => r.username === username)) {
        throw new Error(`UNIQUE constraint failed: admin_accounts.username`);
      }
      const now = new Date().toISOString();
      adminRows.push({
        id: nextId++,
        username,
        password_hash: params[1] as string,
        created_at: now,
        updated_at: now,
      });
      return { changes: 1 };
    }

    return { changes: 0 };
  }
}

class MockDatabase {
  constructor(public path: string = ":memory:") {}

  prepare(sql: string): MockStatement {
    return new MockStatement(sql);
  }

  exec(_sql: string): void {}
  close(): void {}
}

const mockDb = new MockDatabase();

vi.mock("bun:sqlite", () => ({
  Database: MockDatabase,
}));

vi.mock("$env/dynamic/private", () => ({
  env: { DATABASE_PATH: "" },
}));

vi.mock("../connection", () => ({
  getDb: () => mockDb,
}));

const { createAdmin, getAdminByUsername, adminExists } = await import("../repositories/admin");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("admin repository", () => {
  beforeEach(() => {
    adminRows = [];
    nextId = 1;
  });

  afterEach(() => {
    adminRows = [];
    nextId = 1;
  });

  describe("createAdmin", () => {
    it("inserts an admin account", () => {
      createAdmin("admin1", "hashed-password");

      const row = adminRows.find((r) => r.username === "admin1");
      expect(row).toBeDefined();
      expect(row?.username).toBe("admin1");
      expect(row?.password_hash).toBe("hashed-password");
    });

    it("throws on duplicate username", () => {
      createAdmin("admin1", "hash1");
      expect(() => createAdmin("admin1", "hash2")).toThrow();
    });
  });

  describe("getAdminByUsername", () => {
    it("returns the admin account when found", () => {
      createAdmin("admin1", "hashed-pw");
      const admin = getAdminByUsername("admin1");

      expect(admin).not.toBeNull();
      expect(admin?.username).toBe("admin1");
      expect(admin?.password_hash).toBe("hashed-pw");
      expect(admin?.id).toBeGreaterThan(0);
      expect(admin?.created_at).toBeTruthy();
      expect(admin?.updated_at).toBeTruthy();
    });

    it("returns null when not found", () => {
      expect(getAdminByUsername("nonexistent")).toBeNull();
    });
  });

  describe("adminExists", () => {
    it("returns false when no admins exist", () => {
      expect(adminExists()).toBe(false);
    });

    it("returns true when an admin exists", () => {
      createAdmin("admin1", "hash");
      expect(adminExists()).toBe(true);
    });

    it("returns true with multiple admins", () => {
      createAdmin("admin1", "hash1");
      createAdmin("admin2", "hash2");
      expect(adminExists()).toBe(true);
    });
  });
});
