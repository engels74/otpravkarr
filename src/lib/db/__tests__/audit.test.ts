// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory store simulating SQLite for the audit_log table
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface AuditRow {
  id: number;
  timestamp: string;
  actor: string | null;
  action: string;
  detail: string | null;
  ip_address: string | null;
}

let auditRows: AuditRow[] = [];
let nextId = 1;

class MockStatement {
  constructor(private sql: string) {}

  get(...params: unknown[]): Row | null {
    const rows = this.all(...params);
    return rows[0] ?? null;
  }

  all(...params: unknown[]): Row[] {
    const sql = this.sql.trim();

    // COUNT query for total
    if (sql.includes("COUNT(*)")) {
      const filtered = applyFilters(sql, params);
      return [{ count: filtered.length }];
    }

    // SELECT query with filters, ORDER BY, LIMIT, OFFSET
    if (sql.includes("FROM audit_log")) {
      const filtered = applyFilters(sql, params);

      // Sort by timestamp descending
      filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      // Extract LIMIT and OFFSET — they are the last two params for paginated queries
      if (sql.includes("LIMIT ?")) {
        // For the paginated query, the last two params are limit and offset
        const allParams = [...params];
        const offset = allParams.pop() as number;
        const limit = allParams.pop() as number;
        return filtered.slice(offset, offset + limit).map((r) => ({ ...r }));
      }

      return filtered.map((r) => ({ ...r }));
    }

    return [];
  }

  run(...params: unknown[]): { changes: number } {
    const sql = this.sql.trim();

    if (sql.startsWith("INSERT INTO audit_log")) {
      const now = new Date().toISOString();
      auditRows.push({
        id: nextId++,
        timestamp: now,
        actor: params[0] as string | null,
        action: params[1] as string,
        detail: params[2] as string | null,
        ip_address: params[3] as string | null,
      });
      return { changes: 1 };
    }

    return { changes: 0 };
  }
}

function applyFilters(sql: string, params: unknown[]): AuditRow[] {
  let filtered = [...auditRows];
  let paramIdx = 0;

  // Count how many WHERE conditions and match params in order
  if (sql.includes("WHERE") || sql.includes("where")) {
    if (sql.includes("action = ?")) {
      const val = params[paramIdx++] as string;
      filtered = filtered.filter((r) => r.action === val);
    }
    if (sql.includes("actor = ?")) {
      const val = params[paramIdx++] as string;
      filtered = filtered.filter((r) => r.actor === val);
    }
    if (sql.includes("timestamp >= datetime(?)")) {
      const val = params[paramIdx++] as string;
      filtered = filtered.filter((r) => r.timestamp >= val);
    }
    if (sql.includes("timestamp <= datetime(?)")) {
      const val = params[paramIdx++] as string;
      filtered = filtered.filter((r) => r.timestamp <= val);
    }
  }

  return filtered;
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

const { appendAuditLog, queryAuditLog } = await import("../repositories/audit");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("audit repository", () => {
  beforeEach(() => {
    auditRows = [];
    nextId = 1;
  });

  afterEach(() => {
    auditRows = [];
    nextId = 1;
  });

  describe("appendAuditLog", () => {
    it("inserts an audit entry with all fields", () => {
      appendAuditLog({
        actor: "admin",
        action: "setup.completed",
        detail: { step: "final" },
        ipAddress: "127.0.0.1",
      });

      expect(auditRows).toHaveLength(1);
      const row = auditRows[0]!;
      expect(row.actor).toBe("admin");
      expect(row.action).toBe("setup.completed");
      expect(JSON.parse(row.detail!)).toEqual({ step: "final" });
      expect(row.ip_address).toBe("127.0.0.1");
    });

    it("handles optional fields as null", () => {
      appendAuditLog({ action: "admin.login" });

      const row = auditRows[0]!;
      expect(row.actor).toBeNull();
      expect(row.detail).toBeNull();
      expect(row.ip_address).toBeNull();
    });

    it("serializes detail object as JSON string", () => {
      const detail = { users: ["a", "b"], count: 2 };
      appendAuditLog({ action: "sync.completed", detail });

      expect(JSON.parse(auditRows[0]!.detail!)).toEqual(detail);
    });
  });

  describe("queryAuditLog", () => {
    function seedEntries() {
      // Insert entries with explicit timestamps for predictable ordering
      auditRows.push(
        {
          id: nextId++,
          timestamp: "2024-01-01T10:00:00Z",
          actor: "admin",
          action: "setup.completed",
          detail: null,
          ip_address: "10.0.0.1",
        },
        {
          id: nextId++,
          timestamp: "2024-01-02T10:00:00Z",
          actor: "admin",
          action: "admin.login",
          detail: null,
          ip_address: "10.0.0.1",
        },
        {
          id: nextId++,
          timestamp: "2024-01-03T10:00:00Z",
          actor: "system",
          action: "sync.completed",
          detail: '{"count":5}',
          ip_address: null,
        },
        {
          id: nextId++,
          timestamp: "2024-01-04T10:00:00Z",
          actor: "admin",
          action: "config.changed",
          detail: '{"key":"foo"}',
          ip_address: "10.0.0.2",
        },
        {
          id: nextId++,
          timestamp: "2024-01-05T10:00:00Z",
          actor: "system",
          action: "health.check_failed",
          detail: null,
          ip_address: null,
        },
      );
    }

    it("returns all entries when no filters are provided", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({});

      expect(total).toBe(5);
      expect(entries).toHaveLength(5);
    });

    it("returns entries ordered by timestamp descending", () => {
      seedEntries();
      const { entries } = queryAuditLog({});

      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1]!.timestamp >= entries[i]!.timestamp).toBe(true);
      }
    });

    it("filters by action", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({ action: "admin.login" });

      expect(total).toBe(1);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.action).toBe("admin.login");
    });

    it("filters by actor", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({ actor: "system" });

      expect(total).toBe(2);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.actor === "system")).toBe(true);
    });

    it("filters by after date", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({ after: "2024-01-04T00:00:00Z" });

      expect(total).toBe(2);
      expect(entries).toHaveLength(2);
    });

    it("filters by before date", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({ before: "2024-01-02T10:00:00Z" });

      expect(total).toBe(2);
      expect(entries).toHaveLength(2);
    });

    it("combines multiple filters", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({
        actor: "admin",
        after: "2024-01-02T00:00:00Z",
        before: "2024-01-04T12:00:00Z",
      });

      expect(total).toBe(2);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.actor === "admin")).toBe(true);
    });

    it("paginates with limit and offset", () => {
      seedEntries();
      const page1 = queryAuditLog({ limit: 2, offset: 0 });
      const page2 = queryAuditLog({ limit: 2, offset: 2 });

      expect(page1.total).toBe(5);
      expect(page1.entries).toHaveLength(2);
      expect(page2.entries).toHaveLength(2);

      // No overlap
      const page1Ids = page1.entries.map((e) => e.id);
      const page2Ids = page2.entries.map((e) => e.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it("returns correct total regardless of limit/offset", () => {
      seedEntries();
      const { total } = queryAuditLog({ limit: 1, offset: 4 });
      expect(total).toBe(5);
    });

    it("defaults limit to 50 and offset to 0", () => {
      seedEntries();
      const { entries } = queryAuditLog({});
      // All 5 entries returned since 5 < 50
      expect(entries).toHaveLength(5);
    });

    it("returns empty results when filters match nothing", () => {
      seedEntries();
      const { entries, total } = queryAuditLog({ action: "nonexistent.action" });

      expect(total).toBe(0);
      expect(entries).toHaveLength(0);
    });
  });
});
