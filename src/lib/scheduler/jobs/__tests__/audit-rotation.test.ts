// @vitest-environment node

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const mockRun = vi.fn().mockReturnValue({ changes: 0 });
const mockPrepare = vi.fn().mockReturnValue({ run: mockRun });
const mockGetDb = vi.fn().mockReturnValue({ prepare: mockPrepare });

vi.mock("$lib/db/connection", () => ({
  getDb: () => mockGetDb(),
}));

vi.mock("$lib/db/repositories/config", () => ({
  getConfig: vi.fn(),
}));

import { getConfig } from "$lib/db/repositories/config";
import { createAuditRotationJob } from "$lib/scheduler/jobs/audit-rotation";

const mockGetConfig = vi.mocked(getConfig);
const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
  mockGetConfig.mockReset();
  mockRun.mockReset().mockReturnValue({ changes: 0 });
  mockPrepare.mockClear();
  mockGetDb.mockClear();
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

describe("createAuditRotationJob", () => {
  it("returns a job with correct name and default interval", () => {
    const job = createAuditRotationJob();
    expect(job.name).toBe("audit-log-rotation");
    expect(job.interval).toBe(24 * 60 * 60 * 1000);
  });

  it("accepts a custom interval", () => {
    const job = createAuditRotationJob(5000);
    expect(job.interval).toBe(5000);
  });

  it("reads config, deletes old entries, and logs the count", async () => {
    mockGetConfig.mockResolvedValue("90");
    mockRun.mockReturnValue({ changes: 42 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockGetConfig).toHaveBeenCalledWith("audit_retention_days");
    expect(mockPrepare).toHaveBeenCalledWith(
      "DELETE FROM audit_log WHERE timestamp < datetime('now', ?)",
    );
    expect(mockRun).toHaveBeenCalledWith("-90 days");

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.audit-rotation");
    expect(entry).toBeDefined();
    expect(entry?.job).toBe("audit-log-rotation");
    expect(entry?.deletedCount).toBe(42);
    expect(entry?.retentionDays).toBe(90);
    expect(typeof entry?.timestamp).toBe("string");
  });

  it("defaults to 90 days when config key is missing", async () => {
    mockGetConfig.mockResolvedValue(null);
    mockRun.mockReturnValue({ changes: 5 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockRun).toHaveBeenCalledWith("-90 days");

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.audit-rotation");
    expect(entry).toBeDefined();
    expect(entry?.retentionDays).toBe(90);
    expect(entry?.deletedCount).toBe(5);
  });

  it("defaults to 90 days when config value is invalid (non-numeric)", async () => {
    mockGetConfig.mockResolvedValue("abc");
    mockRun.mockReturnValue({ changes: 3 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockRun).toHaveBeenCalledWith("-90 days");

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.audit-rotation");
    expect(entry).toBeDefined();
    expect(entry?.retentionDays).toBe(90);
  });

  it("defaults to 90 days when config value is zero", async () => {
    mockGetConfig.mockResolvedValue("0");
    mockRun.mockReturnValue({ changes: 0 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockRun).toHaveBeenCalledWith("-90 days");
  });

  it("defaults to 90 days when config value is negative", async () => {
    mockGetConfig.mockResolvedValue("-30");
    mockRun.mockReturnValue({ changes: 0 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockRun).toHaveBeenCalledWith("-90 days");
  });

  it("uses custom retention days from config", async () => {
    mockGetConfig.mockResolvedValue("30");
    mockRun.mockReturnValue({ changes: 10 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockRun).toHaveBeenCalledWith("-30 days");

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.audit-rotation");
    expect(entry?.retentionDays).toBe(30);
  });

  it("uses correct datetime modifier format with hyphen prefix", async () => {
    mockGetConfig.mockResolvedValue("7");
    mockRun.mockReturnValue({ changes: 0 });

    const job = createAuditRotationJob();
    await job.fn();

    expect(mockRun).toHaveBeenCalledWith("-7 days");
  });

  it("catches delete query errors and logs without re-throwing", async () => {
    mockGetConfig.mockResolvedValue("90");
    mockRun.mockImplementation(() => {
      throw new Error("database is locked");
    });

    const job = createAuditRotationJob();
    await expect(job.fn()).resolves.toBeUndefined();

    const entries = getLogEntries();
    const errorEntry = entries.find((e) => e.event === "job.audit-rotation.error");
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.job).toBe("audit-log-rotation");
    expect(errorEntry?.error).toBe("database is locked");
  });

  it("handles non-Error thrown values", async () => {
    mockGetConfig.mockResolvedValue("90");
    mockRun.mockImplementation(() => {
      throw "unexpected string error";
    });

    const job = createAuditRotationJob();
    await expect(job.fn()).resolves.toBeUndefined();

    const entries = getLogEntries();
    const errorEntry = entries.find((e) => e.event === "job.audit-rotation.error");
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.error).toBe("unexpected string error");
  });

  it("catches getConfig errors and logs without re-throwing", async () => {
    mockGetConfig.mockRejectedValue(new Error("config read failed"));

    const job = createAuditRotationJob();
    await expect(job.fn()).resolves.toBeUndefined();

    const entries = getLogEntries();
    const errorEntry = entries.find((e) => e.event === "job.audit-rotation.error");
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.error).toBe("config read failed");
  });

  it("logs zero when no entries are rotated", async () => {
    mockGetConfig.mockResolvedValue("90");
    mockRun.mockReturnValue({ changes: 0 });

    const job = createAuditRotationJob();
    await job.fn();

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.audit-rotation");
    expect(entry).toBeDefined();
    expect(entry?.deletedCount).toBe(0);
  });
});
