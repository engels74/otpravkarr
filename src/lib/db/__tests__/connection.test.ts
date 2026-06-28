// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock bun:sqlite with a minimal Database class backed by real behavior
const mockExec = vi.fn();
const mockQuery = vi.fn();
const mockClose = vi.fn();
const mockMkdirSync = vi.fn();

class MockDatabase {
  pragmas: string[] = [];

  constructor(public path: string) {}

  exec(sql: string) {
    this.pragmas.push(sql);
    mockExec(sql);
  }

  query(sql: string) {
    mockQuery(sql);
    if (sql === "PRAGMA journal_mode") {
      return { get: () => ({ journal_mode: "wal" }) };
    }
    if (sql === "PRAGMA foreign_keys") {
      return { get: () => ({ foreign_keys: 1 }) };
    }
    return { get: () => null };
  }

  close() {
    mockClose();
  }
}

vi.mock("bun:sqlite", () => ({
  Database: MockDatabase,
}));

vi.mock("$env/dynamic/private", () => ({
  env: { DATABASE_PATH: "" },
}));

vi.mock("../migrate", () => ({
  runMigrations: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: mockMkdirSync,
}));

const { createDatabase, getDb, initializeDatabase, _resetForTesting } = await import(
  "../connection"
);
const { runMigrations } = await import("../migrate");

describe("createDatabase", () => {
  afterEach(() => {
    _resetForTesting();
    vi.clearAllMocks();
  });

  it("creates a Database instance with the given path", () => {
    const db = createDatabase(":memory:");
    expect(db).toBeInstanceOf(MockDatabase);
    expect((db as unknown as MockDatabase).path).toBe(":memory:");
  });

  it("enables WAL journal mode", () => {
    createDatabase(":memory:");
    expect(mockExec).toHaveBeenCalledWith("PRAGMA journal_mode=WAL");
  });

  it("enables foreign keys", () => {
    createDatabase(":memory:");
    expect(mockExec).toHaveBeenCalledWith("PRAGMA foreign_keys=ON");
  });

  it("sets WAL before foreign keys", () => {
    createDatabase(":memory:");
    const calls = mockExec.mock.calls.map((c) => c[0]);
    const walIdx = calls.indexOf("PRAGMA journal_mode=WAL");
    const fkIdx = calls.indexOf("PRAGMA foreign_keys=ON");
    expect(walIdx).toBeLessThan(fkIdx);
  });

  it("creates the parent directory chain for a nested file path", () => {
    createDatabase("/tmp/nested/sub/otpravkarr.sqlite");
    expect(mockMkdirSync).toHaveBeenCalledWith("/tmp/nested/sub", { recursive: true });
  });

  it("does not attempt mkdir for an in-memory database", () => {
    createDatabase(":memory:");
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it("does not attempt mkdir when the path has no parent directory", () => {
    createDatabase("otpravkarr.sqlite");
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe("getDb", () => {
  afterEach(() => {
    _resetForTesting();
    vi.clearAllMocks();
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("uses default path when DATABASE_PATH is not set", () => {
    const db = getDb();
    expect((db as unknown as MockDatabase).path).toBe("./data/otpravkarr.sqlite");
  });
});

describe("initializeDatabase", () => {
  afterEach(() => {
    _resetForTesting();
    vi.clearAllMocks();
  });

  it("calls runMigrations with the database instance", async () => {
    await initializeDatabase();
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledWith(expect.anything());
  });
});
