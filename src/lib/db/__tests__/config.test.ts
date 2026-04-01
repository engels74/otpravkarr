// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — bun:sqlite with a real in-memory-like prepared statement system
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class MockStatement {
  constructor(
    private db: MockDatabase,
    private sql: string,
  ) {}

  get(...params: unknown[]): Row | null {
    return this.db._exec(this.sql, params, "get") as Row | null;
  }

  run(...params: unknown[]): void {
    this.db._exec(this.sql, params, "run");
  }

  all(...params: unknown[]): Row[] {
    return this.db._exec(this.sql, params, "all") as Row[];
  }
}

// Simple in-memory table store for the config table
interface ConfigRow {
  key: string;
  value: string;
  encrypted: number;
  updated_at: string;
}

class MockDatabase {
  private configRows: Map<string, ConfigRow> = new Map();

  constructor(public path: string = ":memory:") {}

  exec(sql: string): void {
    // Handle CREATE TABLE and PRAGMA — no-op for our purposes
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(this, sql);
  }

  _exec(sql: string, params: unknown[], mode: "get" | "run" | "all"): Row | Row[] | null {
    const now = new Date().toISOString();

    // SELECT single row
    if (sql.includes("FROM config WHERE key = ?")) {
      const key = params[0] as string;
      const row = this.configRows.get(key);
      if (!row) return mode === "all" ? [] : null;
      return mode === "all" ? [{ ...row }] : { ...row };
    }

    // SELECT all rows
    if (sql.includes("FROM config") && !sql.includes("WHERE")) {
      const rows = [...this.configRows.values()].map((r) => ({ ...r }));
      return mode === "all" ? rows : (rows[0] ?? null);
    }

    // UPSERT
    if (sql.includes("INSERT INTO config")) {
      const [key, value, encrypted] = params as [string, string, number];
      this.configRows.set(key, { key, value, encrypted, updated_at: now });
      return mode === "all" ? [] : null;
    }

    return mode === "all" ? [] : null;
  }

  close(): void {}
}

const mockDb = new MockDatabase();

vi.mock("bun:sqlite", () => ({
  Database: MockDatabase,
}));

vi.mock("$env/dynamic/private", () => ({
  env: { DATABASE_PATH: "" },
}));

// Mock the connection module to return our controlled mock db
vi.mock("../connection", () => ({
  db: mockDb,
  getDb: () => mockDb,
}));

// Mock crypto — identity functions for deterministic testing
vi.mock("../../crypto/encryption", () => ({
  encrypt: vi.fn(async (plaintext: string, _purpose: string) => `ENC:${plaintext}`),
  decrypt: vi.fn(async (ciphertext: string, _purpose: string) => {
    if (ciphertext.startsWith("ENC:")) return ciphertext.slice(4);
    return ciphertext;
  }),
  DecryptionError: class DecryptionError extends Error {
    override name = "DecryptionError" as const;
  },
}));

const {
  getConfig,
  setConfig,
  getAllConfig,
  loadConfigCache,
  invalidateConfigCache,
  _resetStatementsForTesting,
} = await import("../repositories/config");

const { encrypt, decrypt } = await import("../../crypto/encryption");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("config repository", () => {
  beforeEach(() => {
    // Clear mock db state and reset prepared statements + cache
    (mockDb as any).configRows = new Map();
    _resetStatementsForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetStatementsForTesting();
  });

  describe("getConfig", () => {
    it("returns null for a non-existent key", async () => {
      const result = await getConfig("missing_key");
      expect(result).toBeNull();
    });

    it("returns the plain value for an unencrypted key", async () => {
      (mockDb as any).configRows.set("app_name", {
        key: "app_name",
        value: "TestApp",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });

      const result = await getConfig("app_name");
      expect(result).toBe("TestApp");
      expect(decrypt).not.toHaveBeenCalled();
    });

    it("decrypts the value for an encrypted key", async () => {
      (mockDb as any).configRows.set("secret_key", {
        key: "secret_key",
        value: "ENC:my-secret",
        encrypted: 1,
        updated_at: "2026-01-01T00:00:00Z",
      });

      const result = await getConfig("secret_key");
      expect(result).toBe("my-secret");
      expect(decrypt).toHaveBeenCalledWith("ENC:my-secret", "config-encryption");
    });

    it("uses cache when populated", async () => {
      (mockDb as any).configRows.set("cached_key", {
        key: "cached_key",
        value: "cached_value",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });

      await loadConfigCache();

      // Clear db rows to prove cache is being used
      (mockDb as any).configRows = new Map();

      const result = await getConfig("cached_key");
      expect(result).toBe("cached_value");
    });

    it("returns null from cache for missing key", async () => {
      await loadConfigCache(); // empty cache
      const result = await getConfig("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("setConfig", () => {
    it("stores a plain value", async () => {
      await setConfig("app_name", "MyApp");

      const row = (mockDb as any).configRows.get("app_name") as ConfigRow;
      expect(row).toBeDefined();
      expect(row.value).toBe("MyApp");
      expect(row.encrypted).toBe(0);
      expect(encrypt).not.toHaveBeenCalled();
    });

    it("encrypts value when encrypted=true", async () => {
      await setConfig("api_key", "super-secret", true);

      const row = (mockDb as any).configRows.get("api_key") as ConfigRow;
      expect(row).toBeDefined();
      expect(row.value).toBe("ENC:super-secret");
      expect(row.encrypted).toBe(1);
      expect(encrypt).toHaveBeenCalledWith("super-secret", "config-encryption");
    });

    it("upserts existing key", async () => {
      await setConfig("key1", "value1");
      await setConfig("key1", "value2");

      const row = (mockDb as any).configRows.get("key1") as ConfigRow;
      expect(row.value).toBe("value2");
    });

    it("invalidates cache after write", async () => {
      (mockDb as any).configRows.set("key1", {
        key: "key1",
        value: "old_value",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });
      await loadConfigCache();

      await setConfig("key1", "new_value");

      // Cache is invalidated, so next read should hit the db
      const result = await getConfig("key1");
      expect(result).toBe("new_value");
    });
  });

  describe("getAllConfig", () => {
    it("returns empty record when no config exists", async () => {
      const result = await getAllConfig();
      expect(result).toEqual({});
    });

    it("returns all config values with decrypted encrypted fields", async () => {
      (mockDb as any).configRows.set("plain", {
        key: "plain",
        value: "plain_value",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });
      (mockDb as any).configRows.set("secret", {
        key: "secret",
        value: "ENC:secret_value",
        encrypted: 1,
        updated_at: "2026-01-01T00:00:00Z",
      });

      const result = await getAllConfig();
      expect(result).toEqual({
        plain: "plain_value",
        secret: "secret_value",
      });
      expect(decrypt).toHaveBeenCalledWith("ENC:secret_value", "config-encryption");
    });
  });

  describe("loadConfigCache", () => {
    it("populates cache from database", async () => {
      (mockDb as any).configRows.set("k1", {
        key: "k1",
        value: "v1",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });
      (mockDb as any).configRows.set("k2", {
        key: "k2",
        value: "ENC:v2",
        encrypted: 1,
        updated_at: "2026-01-01T00:00:00Z",
      });

      await loadConfigCache();

      // Remove db rows to prove cache is active
      (mockDb as any).configRows = new Map();

      expect(await getConfig("k1")).toBe("v1");
      expect(await getConfig("k2")).toBe("v2");
    });
  });

  describe("invalidateConfigCache", () => {
    it("clears the cache so reads hit the database again", async () => {
      (mockDb as any).configRows.set("k1", {
        key: "k1",
        value: "original",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });

      await loadConfigCache();

      // Update directly in db (bypassing setConfig)
      (mockDb as any).configRows.set("k1", {
        key: "k1",
        value: "updated",
        encrypted: 0,
        updated_at: "2026-01-01T00:00:00Z",
      });

      // Cache still has old value
      expect(await getConfig("k1")).toBe("original");

      invalidateConfigCache();

      // Now reads from db
      expect(await getConfig("k1")).toBe("updated");
    });
  });
});
