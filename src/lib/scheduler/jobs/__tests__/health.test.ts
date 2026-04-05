// @vitest-environment node

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCheckServerHealth = vi.fn();
vi.mock("$lib/plex/client", () => ({
  checkServerHealth: (...args: unknown[]) => mockCheckServerHealth(...args),
}));

const mockCheckHealth = vi.fn();
vi.mock("$lib/dispatcharr/endpoints/health", () => ({
  createHealthEndpoints: () => ({ checkHealth: () => mockCheckHealth() }),
}));

vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: class {
    constructor(
      public baseUrl: string,
      public apiKey: string,
    ) {}
  },
}));

const mockGetConfig = vi.fn();
vi.mock("$lib/db/repositories/config", () => ({
  getConfig: (key: string) => mockGetConfig(key),
}));

const mockAppendAuditLog = vi.fn();
vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: (entry: unknown) => mockAppendAuditLog(entry),
}));

const mockExec = vi.fn();
let lastInsertedTs: string | undefined;
const mockPrepareRun = vi.fn().mockImplementation((...args: unknown[]) => {
  lastInsertedTs = args[0] as string;
});
const mockPrepareGet = vi.fn().mockImplementation(() => {
  return { ts: lastInsertedTs };
});
const mockPrepare = vi.fn().mockImplementation((sql: string) => {
  if (sql.startsWith("INSERT OR REPLACE")) {
    return { run: mockPrepareRun };
  }
  // SELECT ts ...
  return { get: mockPrepareGet };
});
vi.mock("$lib/db/connection", () => ({
  getDb: () => ({ exec: mockExec, prepare: mockPrepare }),
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: { HEALTH_CHECK_FAILED: "health.check_failed" },
}));

// Import after mocking
const { createHealthJob, getHealthStatus, resetHealthState, seedInitialHealth } = await import(
  "../health"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterAll(() => {
  consoleSpy.mockRestore();
});

function configMap(
  overrides: Record<string, string | null> = {},
): (key: string) => Promise<string | null> {
  const defaults: Record<string, string | null> = {
    plex_server_url: "http://plex.local:32400",
    plex_admin_token: "plex-token",
    plex_machine_id: "machine-123",
    dispatcharr_url: "https://dispatch.example.com",
    dispatcharr_api_key: "api-key",
    ...overrides,
  };
  return async (key: string) => defaults[key] ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCheckServerHealth.mockReset();
  mockCheckHealth.mockReset();
  mockGetConfig.mockReset();
  mockAppendAuditLog.mockReset();
  mockExec.mockClear();
  mockPrepare.mockClear();
  mockPrepareRun.mockClear().mockImplementation((...args: unknown[]) => {
    lastInsertedTs = args[0] as string;
  });
  mockPrepareGet.mockClear().mockImplementation(() => {
    return { ts: lastInsertedTs };
  });
  lastInsertedTs = undefined;
  consoleSpy.mockClear();
});

afterEach(() => {
  // Reset health state between tests
  resetHealthState();
  mockGetConfig.mockImplementation(async () => null);
  lastInsertedTs = undefined;
});

describe("createHealthJob", () => {
  it("returns a Job with correct name and default interval", () => {
    const job = createHealthJob();
    expect(job.name).toBe("health-check");
    expect(job.interval).toBe(300000);
  });

  it("accepts a custom interval", () => {
    const job = createHealthJob(60000);
    expect(job.interval).toBe(60000);
  });
});

describe("health check fn", () => {
  it("all checks healthy — no audit log entries", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("healthy");
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: true },
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.plex.status).toBe("healthy");
    expect(health.plex.lastChecked).not.toBeNull();
    expect(health.dispatcharr.reachable).toBe(true);
    expect(health.dispatcharr.authValid).toBe(true);
    expect(health.dispatcharr.lastChecked).not.toBeNull();
    expect(health.database.status).toBe("healthy");
    expect(health.database.lastChecked).not.toBeNull();

    expect(mockAppendAuditLog).not.toHaveBeenCalled();
  });

  it("plex unhealthy — updates status and appends audit log", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("unauthorized");
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: true },
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.plex.status).toBe("unauthorized");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check_failed",
        detail: { check: "plex", status: "unauthorized" },
      }),
    );
  });

  it("plex throws — marks unreachable and appends audit log", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockRejectedValue(new Error("ECONNREFUSED"));
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: true },
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.plex.status).toBe("unreachable");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check_failed",
        detail: { check: "plex", error: "ECONNREFUSED" },
      }),
    );
  });

  it("dispatcharr unreachable — updates status and appends audit log", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("healthy");
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: false, authValid: false },
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.dispatcharr.reachable).toBe(false);
    expect(health.dispatcharr.authValid).toBe(false);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check_failed",
        detail: { check: "dispatcharr", reachable: false, authValid: false },
      }),
    );
  });

  it("dispatcharr returns error result — marks unreachable and logs", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("healthy");
    mockCheckHealth.mockResolvedValue({
      ok: false,
      error: "network_error",
      message: "Connection refused",
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.dispatcharr.reachable).toBe(false);
    expect(health.dispatcharr.authValid).toBe(false);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check_failed",
        detail: { check: "dispatcharr", error: "Connection refused" },
      }),
    );
  });

  it("dispatcharr throws — marks unreachable and logs", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("healthy");
    mockCheckHealth.mockRejectedValue(new Error("unexpected"));

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.dispatcharr.reachable).toBe(false);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check_failed",
        detail: { check: "dispatcharr", error: "unexpected" },
      }),
    );
  });

  it("sqlite failure — updates status and appends audit log", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("healthy");
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: true },
    });
    mockPrepareGet.mockImplementation(() => {
      throw new Error("database is locked");
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.database.status).toBe("unhealthy");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "health.check_failed",
        detail: { check: "database", error: "database is locked" },
      }),
    );
  });

  it("missing plex config — skips plex check, other checks still run", async () => {
    mockGetConfig.mockImplementation(
      configMap({
        plex_server_url: null,
        plex_admin_token: null,
        plex_machine_id: null,
      }),
    );
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: true },
    });

    const job = createHealthJob();
    await job.fn();

    expect(mockCheckServerHealth).not.toHaveBeenCalled();

    const health = getHealthStatus();
    expect(health.dispatcharr.reachable).toBe(true);
    expect(health.database.status).toBe("healthy");
  });

  it("missing dispatcharr config — skips dispatcharr check, other checks still run", async () => {
    mockGetConfig.mockImplementation(
      configMap({
        dispatcharr_url: null,
        dispatcharr_api_key: null,
      }),
    );
    mockCheckServerHealth.mockResolvedValue("healthy");

    const job = createHealthJob();
    await job.fn();

    expect(mockCheckHealth).not.toHaveBeenCalled();

    const health = getHealthStatus();
    expect(health.plex.status).toBe("healthy");
    expect(health.database.status).toBe("healthy");
  });

  it("getHealthStatus returns current state", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("server_changed");
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: false },
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.plex.status).toBe("server_changed");
    expect(health.dispatcharr.reachable).toBe(true);
    expect(health.dispatcharr.authValid).toBe(false);
    expect(health.database.status).toBe("healthy");
  });

  it("individual check failure does not abort other checks", async () => {
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockRejectedValue(new Error("plex down"));
    mockCheckHealth.mockRejectedValue(new Error("dispatcharr down"));
    mockPrepareGet.mockImplementation(() => {
      throw new Error("db locked");
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    // All checks ran and recorded their failures
    expect(health.plex.status).toBe("unreachable");
    expect(health.plex.lastChecked).not.toBeNull();
    expect(health.dispatcharr.reachable).toBe(false);
    expect(health.dispatcharr.lastChecked).not.toBeNull();
    expect(health.database.status).toBe("unhealthy");
    expect(health.database.lastChecked).not.toBeNull();

    // Three audit log entries (one per failed check)
    expect(mockAppendAuditLog).toHaveBeenCalledTimes(3);
  });
});

describe("seedInitialHealth", () => {
  it("sets all services to healthy with current timestamp", () => {
    // Verify initial state is unhealthy
    const before = getHealthStatus();
    expect(before.plex.status).toBe("unreachable");
    expect(before.dispatcharr.reachable).toBe(false);
    expect(before.database.status).toBe("unhealthy");

    seedInitialHealth();

    const after = getHealthStatus();
    expect(after.plex.status).toBe("healthy");
    expect(after.plex.lastChecked).not.toBeNull();
    expect(after.dispatcharr.reachable).toBe(true);
    expect(after.dispatcharr.authValid).toBe(true);
    expect(after.dispatcharr.lastChecked).not.toBeNull();
    expect(after.database.status).toBe("healthy");
    expect(after.database.lastChecked).not.toBeNull();
  });

  it("is overwritten by subsequent health check job", async () => {
    seedInitialHealth();

    // Now run a health check where plex is unhealthy
    mockGetConfig.mockImplementation(configMap());
    mockCheckServerHealth.mockResolvedValue("unauthorized");
    mockCheckHealth.mockResolvedValue({
      ok: true,
      data: { reachable: true, authValid: true },
    });

    const job = createHealthJob();
    await job.fn();

    const health = getHealthStatus();
    expect(health.plex.status).toBe("unauthorized");
    expect(health.dispatcharr.reachable).toBe(true);
    expect(health.database.status).toBe("healthy");
  });
});
