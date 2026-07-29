// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Bun.file() — used by migrate.ts to read .sql files
// ---------------------------------------------------------------------------

vi.stubGlobal("Bun", {
  ...globalThis.Bun,
  file: (path: string) => ({
    text: async () => readFileSync(path, "utf-8"),
  }),
});

// ---------------------------------------------------------------------------
// In-memory mock Database that tracks tables, rows, and supports transactions
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface TableDef {
  rows: Row[];
  nextId: number;
  columns: string[];
  checks: Record<string, string[]>;
  indices: string[];
}

let tables: Record<string, TableDef> = {};
let executedSql: string[] = [];

function resetMockDb() {
  tables = {};
  executedSql = [];
}

class MockStatement {
  constructor(
    _db: MockDatabase,
    private sql: string,
  ) {}

  get(...params: unknown[]): Row | null {
    const rows = this.all(...params);
    return rows[0] ?? null;
  }

  all(...params: unknown[]): Row[] {
    const sql = this.sql.trim();

    // SELECT version FROM _migrations
    if (sql.includes("SELECT version FROM _migrations")) {
      const t = tables._migrations;
      if (!t) return [];
      return t.rows.map((r) => ({ version: r.version }));
    }

    // SELECT version, name FROM _migrations ORDER BY version
    if (sql.includes("SELECT version, name FROM _migrations")) {
      const t = tables._migrations;
      if (!t) return [];
      const rows = t.rows.map((r) => ({ version: r.version, name: r.name }));
      if (sql.includes("ORDER BY version"))
        rows.sort((a, b) => (a.version as number) - (b.version as number));
      return rows;
    }

    // SELECT * FROM _migrations
    if (sql.includes("SELECT * FROM _migrations")) {
      const t = tables._migrations;
      if (!t) return [];
      return t.rows.map((r) => ({ ...r }));
    }

    // SELECT applied_at FROM _migrations WHERE version = ?
    if (sql.includes("SELECT applied_at FROM _migrations WHERE version = ?")) {
      const t = tables._migrations;
      if (!t) return [];
      const row = t.rows.find((r) => r.version === params[0]);
      return row ? [{ applied_at: row.applied_at }] : [];
    }

    // SELECT name FROM sqlite_master WHERE type='table'
    if (sql.includes("sqlite_master") && sql.includes("type='table'")) {
      const allTableNames = Object.keys(tables);
      let result = allTableNames.map((name) => ({ name }));

      if (sql.includes("name='_migrations'")) {
        result = result.filter((r) => r.name === "_migrations");
      } else if (sql.includes("NOT LIKE '\\_%'") || sql.includes("NOT LIKE '\\_")) {
        result = result.filter((r) => !r.name.startsWith("_") && !r.name.startsWith("sqlite_"));
      }
      if (sql.includes("name='test'")) {
        result = result.filter((r) => r.name === "test");
      }
      if (sql.includes("name='bad'")) {
        result = result.filter((r) => r.name === "bad");
      }
      if (sql.includes("IN ('first', 'second')")) {
        result = result.filter((r) => r.name === "first" || r.name === "second");
      }
      return result;
    }

    // SELECT name FROM sqlite_master WHERE type='index'
    if (sql.includes("sqlite_master") && sql.includes("type='index'")) {
      const allIndices: { name: string }[] = [];
      for (const t of Object.values(tables)) {
        for (const idx of t.indices) {
          allIndices.push({ name: idx });
        }
      }
      if (sql.includes("LIKE 'idx_%'")) {
        return allIndices.filter((i) => i.name.startsWith("idx_"));
      }
      return allIndices;
    }

    // PRAGMA table_info
    const pragmaMatch = sql.match(/PRAGMA table_info\((\w+)\)/);
    if (pragmaMatch) {
      const tableName = pragmaMatch[1] as string;
      const t = tables[tableName];
      if (!t) return [];
      return t.columns.map((name, i) => ({
        cid: i,
        name,
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
        pk: i === 0 ? 1 : 0,
      }));
    }

    // COUNT(*)
    if (sql.includes("COUNT(*)")) {
      // Extract table name
      const tableMatch = sql.match(/FROM\s+(\w+)/);
      if (tableMatch) {
        const t = tables[tableMatch[1] as string];
        return [{ c: t ? t.rows.length : 0 }];
      }
    }

    return [];
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const sql = this.sql.trim();

    // INSERT INTO _migrations (version, name) VALUES (?, ?)
    if (sql.includes("INSERT INTO _migrations")) {
      const t = tables._migrations;
      if (!t) throw new Error("_migrations table does not exist");
      const now = new Date().toISOString();
      t.rows.push({
        version: params[0] as number,
        name: params[1] as string,
        applied_at: now,
      });
      return { changes: 1, lastInsertRowid: t.rows.length };
    }

    // Generic INSERT
    const insertMatch = sql.match(/INSERT INTO (\w+)/);
    if (insertMatch) {
      const tableName = insertMatch[1] as string;
      const t = tables[tableName];
      if (!t) throw new Error(`Table ${tableName} does not exist`);

      // Parse column names and VALUES clause
      const normalized = sql.replace(/\s+/g, " ");
      const colsMatch = normalized.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (colsMatch) {
        const cols = (colsMatch[1] as string).split(",").map((c) => c.trim());
        const valueParts = (colsMatch[2] as string).split(",").map((v) => v.trim());
        const row: Row = {};
        let paramIdx = 0;
        cols.forEach((col, i) => {
          const valExpr = valueParts[i]?.trim();
          if (valExpr === "?") {
            row[col] = params[paramIdx++];
          } else if (valExpr?.startsWith("'") && valExpr.endsWith("'")) {
            row[col] = valExpr.slice(1, -1);
          } else if (valExpr !== undefined && !Number.isNaN(Number(valExpr))) {
            row[col] = Number(valExpr);
          } else {
            row[col] = valExpr;
          }
        });
        // Check constraints
        for (const [col, allowedValues] of Object.entries(t.checks)) {
          if (row[col] !== undefined && !allowedValues.includes(String(row[col]))) {
            throw new Error(`CHECK constraint failed: ${tableName}.${col}`);
          }
        }
        const id = t.nextId++;
        row.id = id;
        t.rows.push(row);
        return { changes: 1, lastInsertRowid: id };
      }
    }

    return { changes: 0, lastInsertRowid: 0 };
  }
}

class MockDatabase {
  constructor(public path: string = ":memory:") {}

  prepare(sql: string): MockStatement {
    return new MockStatement(this, sql);
  }

  exec(sql: string): void {
    executedSql.push(sql);
    // Parse CREATE TABLE statements
    const createMatches = sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([^;]*)\)/gi);
    for (const match of createMatches) {
      const tableName = match[1] as string;
      const body = match[2] as string;
      if (!tables[tableName]) {
        const columns = parseColumns(body);
        const checks = parseChecks(body);
        tables[tableName] = { rows: [], nextId: 1, columns, checks, indices: [] };
      }
    }

    // Parse CREATE INDEX statements
    const indexMatches = sql.matchAll(/CREATE INDEX(?:\s+IF NOT EXISTS)?\s+(\w+)\s+ON\s+(\w+)/gi);
    for (const match of indexMatches) {
      const indexName = match[1] as string;
      const tableName = match[2] as string;
      const t = tables[tableName];
      if (t && !t.indices.includes(indexName)) {
        t.indices.push(indexName);
      }
    }

    // Check for intentionally invalid SQL (for rollback testing)
    if (sql.includes("INVALID SQL HERE")) {
      throw new Error('near "INVALID": syntax error');
    }
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      // Save state for rollback
      const snapshot = JSON.stringify(tables);
      try {
        return fn();
      } catch (e) {
        // Rollback
        tables = JSON.parse(snapshot);
        throw e;
      }
    };
  }

  close(): void {}
}

function parseColumns(body: string): string[] {
  const columns: string[] = [];
  // Split by comma but respect parentheses
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (
        trimmed &&
        !trimmed.startsWith("CHECK") &&
        !trimmed.startsWith("UNIQUE") &&
        !trimmed.startsWith("PRIMARY KEY") &&
        !trimmed.startsWith("FOREIGN KEY") &&
        !trimmed.startsWith("CREATE")
      ) {
        const colName = trimmed.split(/\s+/)[0];
        if (colName) columns.push(colName);
      }
      current = "";
      continue;
    }
    current += char;
  }
  // Last column
  const trimmed = current.trim();
  if (
    trimmed &&
    !trimmed.startsWith("CHECK") &&
    !trimmed.startsWith("UNIQUE") &&
    !trimmed.startsWith("PRIMARY KEY") &&
    !trimmed.startsWith("FOREIGN KEY")
  ) {
    const colName = trimmed.split(/\s+/)[0];
    if (colName) columns.push(colName);
  }
  return columns;
}

function parseChecks(body: string): Record<string, string[]> {
  const checks: Record<string, string[]> = {};
  // Normalize whitespace so multiline CHECK constraints become single-line
  const normalized = body.replace(/\s+/g, " ");
  // Match CHECK constraints like: CHECK (provisioning_mode IN ('automatic', 'self_managed', 'staff'))
  const checkMatches = normalized.matchAll(/CHECK\s*\(\s*(\w+)\s+IN\s*\(([^)]+)\)\s*\)/gi);
  for (const match of checkMatches) {
    const col = match[1] as string;
    const values = (match[2] as string).split(",").map((v) => v.trim().replace(/'/g, ""));
    checks[col] = values;
  }
  return checks;
}

vi.mock("bun:sqlite", () => ({
  Database: MockDatabase,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { runMigrations } = await import("../migrate");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempMigrationsDir(): string {
  return mkdtempSync(join(tmpdir(), "migrate-test-"));
}

function writeMigration(dir: string, filename: string, sql: string): void {
  writeFileSync(join(dir, filename), sql);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMigrations", () => {
  beforeEach(() => {
    resetMockDb();
  });

  afterEach(() => {
    resetMockDb();
  });

  it("creates _migrations table on first run", async () => {
    const dir = createTempMigrationsDir();
    const db = new MockDatabase(":memory:");

    await runMigrations(db as any, dir);

    expect(tables._migrations).toBeDefined();
  });

  it("applies a single migration and records it", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "001_create_test.sql", "CREATE TABLE test (id INTEGER PRIMARY KEY);");
    const db = new MockDatabase(":memory:");

    const applied = await runMigrations(db as any, dir);

    expect(applied).toBe(1);
    expect(tables.test).toBeDefined();

    const migrations = (tables._migrations as TableDef).rows;
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.version).toBe(1);
    expect(migrations[0]?.name).toBe("create_test");
  });

  it("applies migrations in numeric order", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "002_second.sql", "CREATE TABLE second (id INTEGER PRIMARY KEY);");
    writeMigration(dir, "001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    const db = new MockDatabase(":memory:");

    await runMigrations(db as any, dir);

    const migrations = (tables._migrations as TableDef).rows.sort(
      (a, b) => (a.version as number) - (b.version as number),
    );
    expect(migrations).toHaveLength(2);
    expect(migrations[0]?.version).toBe(1);
    expect(migrations[0]?.name).toBe("first");
    expect(migrations[1]?.version).toBe(2);
    expect(migrations[1]?.name).toBe("second");
  });

  it("does not re-apply already applied migrations", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "001_create_test.sql", "CREATE TABLE test (id INTEGER PRIMARY KEY);");
    const db = new MockDatabase(":memory:");

    const firstRun = await runMigrations(db as any, dir);
    expect(firstRun).toBe(1);

    const secondRun = await runMigrations(db as any, dir);
    expect(secondRun).toBe(0);

    expect((tables._migrations as TableDef).rows).toHaveLength(1);
  });

  it("applies only new migrations on subsequent runs", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    const db = new MockDatabase(":memory:");

    await runMigrations(db as any, dir);

    writeMigration(dir, "002_second.sql", "CREATE TABLE second (id INTEGER PRIMARY KEY);");

    const applied = await runMigrations(db as any, dir);
    expect(applied).toBe(1);

    expect((tables._migrations as TableDef).rows).toHaveLength(2);
    expect(tables.first).toBeDefined();
    expect(tables.second).toBeDefined();
  });

  it("records applied_at timestamp", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "001_test.sql", "CREATE TABLE test (id INTEGER PRIMARY KEY);");
    const db = new MockDatabase(":memory:");

    await runMigrations(db as any, dir);

    const row = (tables._migrations as TableDef).rows.find((r) => r.version === 1);
    expect(row?.applied_at).toBeTruthy();
    expect(new Date(row?.applied_at as string).getTime()).not.toBeNaN();
  });

  it("returns 0 when migrations directory is empty", async () => {
    const dir = createTempMigrationsDir();
    const db = new MockDatabase(":memory:");

    const applied = await runMigrations(db as any, dir);
    expect(applied).toBe(0);
  });

  it("ignores non-.sql files", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "001_test.sql", "CREATE TABLE test (id INTEGER PRIMARY KEY);");
    writeMigration(dir, "README.md", "# Migrations");
    writeMigration(dir, ".gitkeep", "");
    const db = new MockDatabase(":memory:");

    const applied = await runMigrations(db as any, dir);
    expect(applied).toBe(1);
  });

  it("rolls back all migrations on SQL error (atomic batch)", async () => {
    const dir = createTempMigrationsDir();
    writeMigration(dir, "001_good.sql", "CREATE TABLE good (id INTEGER PRIMARY KEY);");
    writeMigration(
      dir,
      "002_bad.sql",
      "CREATE TABLE bad (id INTEGER PRIMARY KEY); INVALID SQL HERE;",
    );
    const db = new MockDatabase(":memory:");

    await runMigrations(db as any, dir).catch(() => {});

    // Entire batch rolls back — no partial application
    expect((tables._migrations as TableDef).rows).toHaveLength(0);
    expect(tables.good).toBeUndefined();
    expect(tables.bad).toBeUndefined();
  });
});

describe("001_initial.sql migration", () => {
  const migrationsDir = join(import.meta.dirname ?? ".", "..", "migrations");

  beforeEach(() => {
    resetMockDb();
  });

  afterEach(() => {
    resetMockDb();
  });

  it("creates all expected tables", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const tableNames = Object.keys(tables)
      .filter((n) => !n.startsWith("_") && !n.startsWith("sqlite_"))
      .sort();
    expect(tableNames).toEqual([
      "admin_accounts",
      "audit_log",
      "channel_group_profiles",
      "config",
      "lineup_bundles",
      "sessions",
      "user_mappings",
    ]);
  });

  it("creates expected indices", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const allIndices: string[] = [];
    for (const t of Object.values(tables)) {
      for (const idx of t.indices) {
        if (idx.startsWith("idx_")) allIndices.push(idx);
      }
    }
    allIndices.sort();
    expect(allIndices).toEqual([
      "idx_audit_log_action",
      "idx_audit_log_timestamp",
      "idx_sessions_expires",
      "idx_user_mappings_dispatcharr_id",
      "idx_user_mappings_plex_id",
    ]);
  });

  it("config table has correct columns", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const colNames = (tables.config as TableDef).columns;
    expect(colNames).toEqual(["key", "value", "encrypted", "updated_at"]);
  });

  it("user_mappings table has correct columns", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const colNames = (tables.user_mappings as TableDef).columns;
    expect(colNames).toContain("plex_account_id");
    expect(colNames).toContain("plex_uuid");
    expect(colNames).toContain("dispatcharr_xc_password_enc");
    expect(colNames).toContain("provisioning_mode");
    expect(colNames).toContain("is_active");
  });

  it("user_mappings enforces provisioning_mode CHECK constraint", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const insert = db.prepare(`
      INSERT INTO user_mappings (plex_account_id, plex_uuid, plex_username, provisioning_mode)
      VALUES (1, 'uuid-1', 'testuser', ?)
    `);

    expect(() => insert.run("automatic")).not.toThrow();
    expect(() => insert.run("invalid_mode")).toThrow();
  });

  it("sessions enforces session_type CHECK constraint", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const insert = db.prepare(`
      INSERT INTO sessions (id, user_ref, session_type, expires_at)
      VALUES (?, 'ref-1', ?, '2099-01-01T00:00:00Z')
    `);

    expect(() => insert.run("s1", "admin")).not.toThrow();
    expect(() => insert.run("s2", "user")).not.toThrow();
    expect(() => insert.run("s3", "invalid")).toThrow();
  });

  it("records migrations in _migrations table", async () => {
    const db = new MockDatabase(":memory:");
    await runMigrations(db as any, migrationsDir);

    const migrations = (tables._migrations as TableDef).rows;
    expect(migrations).toHaveLength(4);
    expect(migrations[0]?.version).toBe(1);
    expect(migrations[0]?.name).toBe("initial");
    expect(migrations[1]?.version).toBe(2);
    expect(migrations[1]?.name).toBe("channel_group_subscriptions");
    expect(migrations[2]?.version).toBe(3);
    expect(migrations[2]?.name).toBe("lineup_policies");
    expect(migrations[3]?.version).toBe(4);
    expect(migrations[3]?.name).toBe("event_membership_state");
  });
});
