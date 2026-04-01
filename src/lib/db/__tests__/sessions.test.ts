// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory store simulating SQLite for the sessions table
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface SessionRow {
  id: string;
  user_ref: string;
  session_type: string;
  expires_at: string;
  created_at: string;
}

let sessionRows: SessionRow[] = [];

class MockStatement {
  constructor(private sql: string) {}

  get(...params: unknown[]): Row | null {
    const rows = this.all(...params);
    return rows[0] ?? null;
  }

  all(...params: unknown[]): Row[] {
    const sql = this.sql.trim();

    if (sql.includes("FROM sessions WHERE id = ?")) {
      return sessionRows.filter((r) => r.id === params[0]).map((r) => ({ ...r }));
    }

    if (sql.includes("COUNT(*)")) {
      return [{ c: sessionRows.length }];
    }

    return [];
  }

  run(...params: unknown[]): { changes: number } {
    const sql = this.sql.trim();

    if (sql.startsWith("INSERT INTO sessions")) {
      const now = new Date()
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "");
      sessionRows.push({
        id: params[0] as string,
        user_ref: params[1] as string,
        session_type: params[2] as string,
        expires_at: params[3] as string,
        created_at: now,
      });
      return { changes: 1 };
    }

    if (sql.includes("DELETE FROM sessions WHERE id = ?")) {
      const before = sessionRows.length;
      sessionRows = sessionRows.filter((r) => r.id !== params[0]);
      return { changes: before - sessionRows.length };
    }

    if (sql.includes("DELETE FROM sessions WHERE expires_at")) {
      const now = new Date()
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "");
      const before = sessionRows.length;
      sessionRows = sessionRows.filter((r) => r.expires_at >= now);
      return { changes: before - sessionRows.length };
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

const { createSession, getSession, deleteSession, deleteExpiredSessions } = await import(
  "../repositories/sessions"
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sessions repository", () => {
  beforeEach(() => {
    sessionRows = [];
  });

  afterEach(() => {
    sessionRows = [];
  });

  describe("createSession", () => {
    it("inserts a session and returns a UUID", () => {
      const id = createSession("admin-user", "admin", 3600);

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      const row = sessionRows.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row?.user_ref).toBe("admin-user");
      expect(row?.session_type).toBe("admin");
    });

    it("sets expires_at in the future based on ttlSeconds", () => {
      const before = Date.now();
      const id = createSession("ref", "user", 7200);
      const after = Date.now();

      const row = sessionRows.find((r) => r.id === id);
      expect(row).toBeDefined();
      const expiresMs = new Date(`${(row?.expires_at ?? "").replace(" ", "T")}Z`).getTime();

      expect(expiresMs).toBeGreaterThanOrEqual(before + 7200 * 1000 - 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + 7200 * 1000 + 1000);
    });

    it("generates unique session IDs", () => {
      const id1 = createSession("ref", "admin", 60);
      const id2 = createSession("ref", "admin", 60);
      expect(id1).not.toBe(id2);
    });
  });

  describe("getSession", () => {
    it("returns the session if it exists and is not expired", () => {
      const id = createSession("ref-1", "admin", 3600);
      const session = getSession(id);

      expect(session).not.toBeNull();
      expect(session?.id).toBe(id);
      expect(session?.user_ref).toBe("ref-1");
      expect(session?.session_type).toBe("admin");
    });

    it("returns null for a non-existent session", () => {
      expect(getSession("does-not-exist")).toBeNull();
    });

    it("returns null for an expired session", () => {
      sessionRows.push({
        id: "expired-id",
        user_ref: "ref",
        session_type: "user",
        expires_at: "2000-01-01 00:00:00",
        created_at: "2000-01-01 00:00:00",
      });

      expect(getSession("expired-id")).toBeNull();
    });
  });

  describe("deleteSession", () => {
    it("removes the session from the database", () => {
      const id = createSession("ref", "admin", 3600);
      expect(getSession(id)).not.toBeNull();

      deleteSession(id);
      expect(getSession(id)).toBeNull();
    });

    it("does not throw for non-existent session", () => {
      expect(() => deleteSession("nope")).not.toThrow();
    });
  });

  describe("deleteExpiredSessions", () => {
    it("deletes expired sessions and returns count", () => {
      sessionRows.push({
        id: "exp-1",
        user_ref: "ref",
        session_type: "user",
        expires_at: "2000-01-01 00:00:00",
        created_at: "2000-01-01 00:00:00",
      });
      sessionRows.push({
        id: "exp-2",
        user_ref: "ref",
        session_type: "admin",
        expires_at: "2000-01-01 00:00:00",
        created_at: "2000-01-01 00:00:00",
      });

      // Insert one valid session
      createSession("ref", "admin", 3600);

      const count = deleteExpiredSessions();
      expect(count).toBe(2);

      expect(sessionRows).toHaveLength(1);
    });

    it("returns 0 when no sessions are expired", () => {
      createSession("ref", "admin", 3600);
      expect(deleteExpiredSessions()).toBe(0);
    });
  });
});
