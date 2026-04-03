// @vitest-environment node

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockGetConfig = vi.fn();
vi.mock("$lib/db/repositories/config", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

const mockReconcileSync = vi.fn();
vi.mock("$lib/bridge/lifecycle", () => ({
  reconcileSync: (...args: unknown[]) => mockReconcileSync(...args),
}));

const mockAppendAuditLog = vi.fn();
vi.mock("$lib/db/repositories/audit", () => ({
  appendAuditLog: (entry: unknown) => mockAppendAuditLog(entry),
}));

vi.mock("$lib/db/types", () => ({
  AuditAction: {
    SYNC_COMPLETED: "sync.completed",
    SYNC_FAILED: "sync.failed",
  },
}));

// DispatcharrClient is used with `new` — mock it as a class that captures constructor args.
// The factory must be self-contained (no top-level variable references due to hoisting).
vi.mock("$lib/dispatcharr/client", () => ({
  DispatcharrClient: class {
    baseUrl: string;
    apiKey: string;
    constructor(baseUrl: string, apiKey: string) {
      this.baseUrl = baseUrl;
      this.apiKey = apiKey;
    }
  },
}));

import { createSyncJob } from "$lib/scheduler/jobs/sync";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  vi.clearAllMocks();
  consoleSpy.mockClear();
});

afterAll(() => {
  consoleSpy.mockRestore();
});

function getLogEntries(): Array<Record<string, unknown>> {
  return consoleSpy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(call[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

function mockConfigWith(config: Record<string, string>) {
  mockGetConfig.mockImplementation((key: string) => Promise.resolve(config[key] ?? null));
}

const FULL_CONFIG: Record<string, string> = {
  dispatcharr_url: "http://dispatcharr.local",
  dispatcharr_api_key: "test-api-key",
  plex_admin_token: "test-plex-token",
};

describe("createSyncJob", () => {
  it("returns a Job with correct name and default interval", async () => {
    const job = await createSyncJob();
    expect(job.name).toBe("plex-dispatcharr-sync");
    expect(job.interval).toBe(15 * 60 * 1000);
  });

  it("accepts a custom interval", async () => {
    const job = await createSyncJob(60_000);
    expect(job.interval).toBe(60_000);
  });

  it("reads sync_interval_minutes from config when available", async () => {
    mockGetConfig.mockImplementation((key: string) =>
      key === "sync_interval_minutes" ? Promise.resolve("10") : Promise.resolve(null),
    );
    const job = await createSyncJob();
    expect(job.interval).toBe(10 * 60 * 1000);
  });

  it("ignores invalid sync_interval_minutes values", async () => {
    mockGetConfig.mockImplementation((key: string) =>
      key === "sync_interval_minutes" ? Promise.resolve("not-a-number") : Promise.resolve(null),
    );
    const job = await createSyncJob();
    expect(job.interval).toBe(15 * 60 * 1000);
  });

  it("ignores non-positive sync_interval_minutes", async () => {
    mockGetConfig.mockImplementation((key: string) =>
      key === "sync_interval_minutes" ? Promise.resolve("0") : Promise.resolve(null),
    );
    const job = await createSyncJob();
    expect(job.interval).toBe(15 * 60 * 1000);
  });

  it("falls back to default when config read fails", async () => {
    mockGetConfig.mockRejectedValue(new Error("DB error"));
    const job = await createSyncJob();
    expect(job.interval).toBe(15 * 60 * 1000);
  });
});

describe("sync job fn", () => {
  it("happy path: calls reconcileSync and logs report", async () => {
    mockConfigWith(FULL_CONFIG);

    const report = {
      newFriends: 2,
      disabled: 1,
      orphaned: 0,
      refreshed: 3,
      errors: [],
    };
    mockReconcileSync.mockResolvedValueOnce(report);

    const job = await createSyncJob();
    await job.fn();

    expect(mockGetConfig).toHaveBeenCalledWith("dispatcharr_url");
    expect(mockGetConfig).toHaveBeenCalledWith("dispatcharr_api_key");
    expect(mockGetConfig).toHaveBeenCalledWith("plex_admin_token");

    // Verify reconcileSync was called with a DispatcharrClient instance and the plex token
    expect(mockReconcileSync).toHaveBeenCalledTimes(1);
    const [client, token] = mockReconcileSync.mock.calls[0]!;
    expect(client.baseUrl).toBe("http://dispatcharr.local");
    expect(client.apiKey).toBe("test-api-key");
    expect(token).toBe("test-plex-token");

    const logs = getLogEntries();
    const completedLog = logs.find((l) => l.event === "sync.completed");
    expect(completedLog).toBeDefined();
    expect(completedLog!.job).toBe("plex-dispatcharr-sync");
    expect(completedLog!.report).toEqual(report);

    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: "sync.completed",
      detail: { report },
    });
  });

  it("missing config: logs warning and returns early without calling reconcileSync", async () => {
    mockConfigWith({
      dispatcharr_url: "http://dispatcharr.local",
      // api key and plex token missing
    });

    const job = await createSyncJob();
    await job.fn();

    expect(mockReconcileSync).not.toHaveBeenCalled();

    const logs = getLogEntries();
    const skippedLog = logs.find((l) => l.event === "sync.skipped");
    expect(skippedLog).toBeDefined();
    expect(skippedLog!.reason).toBe("missing_config");
    expect(skippedLog!.missing).toEqual(["dispatcharr_api_key", "plex_admin_token"]);
  });

  it("missing all config keys: includes all in missing array", async () => {
    mockGetConfig.mockResolvedValue(null);

    const job = await createSyncJob();
    await job.fn();

    expect(mockReconcileSync).not.toHaveBeenCalled();

    const logs = getLogEntries();
    const skippedLog = logs.find((l) => l.event === "sync.skipped");
    expect(skippedLog).toBeDefined();
    expect(skippedLog!.missing).toEqual([
      "dispatcharr_url",
      "dispatcharr_api_key",
      "plex_admin_token",
    ]);
  });

  it("getConfig throws: logs config.error and returns early without calling reconcileSync", async () => {
    mockGetConfig.mockRejectedValue(new Error("DB connection lost"));

    const job = await createSyncJob();
    await expect(job.fn()).resolves.toBeUndefined();

    expect(mockReconcileSync).not.toHaveBeenCalled();

    const logs = getLogEntries();
    const configErrorLog = logs.find((l) => l.event === "config.error");
    expect(configErrorLog).toBeDefined();
    expect(configErrorLog!.error).toBe("DB connection lost");
  });

  it("reconcileSync throws: error caught and logged, no crash", async () => {
    mockConfigWith(FULL_CONFIG);
    mockReconcileSync.mockRejectedValueOnce(new Error("Network failure"));

    const job = await createSyncJob();
    // Should not throw
    await expect(job.fn()).resolves.toBeUndefined();

    const logs = getLogEntries();
    const errorLog = logs.find((l) => l.event === "sync.error");
    expect(errorLog).toBeDefined();
    expect(errorLog!.job).toBe("plex-dispatcharr-sync");
    expect(errorLog!.error).toBe("Network failure");

    expect(mockAppendAuditLog).toHaveBeenCalledWith({
      action: "sync.failed",
      detail: { error: "Network failure" },
    });
  });

  it("reconcileSync throws non-Error: error stringified and logged", async () => {
    mockConfigWith(FULL_CONFIG);
    mockReconcileSync.mockRejectedValueOnce("string error");

    const job = await createSyncJob();
    await expect(job.fn()).resolves.toBeUndefined();

    const logs = getLogEntries();
    const errorLog = logs.find((l) => l.event === "sync.error");
    expect(errorLog).toBeDefined();
    expect(errorLog!.error).toBe("string error");
  });
});
