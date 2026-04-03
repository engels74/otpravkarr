// @vitest-environment node

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCleanupJob } from "$lib/scheduler/jobs/cleanup";

vi.mock("$lib/db/repositories/sessions", () => ({
  deleteExpiredSessions: vi.fn(),
}));

import { deleteExpiredSessions } from "$lib/db/repositories/sessions";

const mockDeleteExpiredSessions = vi.mocked(deleteExpiredSessions);
const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
  mockDeleteExpiredSessions.mockReset();
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

describe("createCleanupJob", () => {
  it("returns a job with correct name and default interval", () => {
    const job = createCleanupJob();
    expect(job.name).toBe("session-cleanup");
    expect(job.interval).toBe(30 * 60 * 1000);
  });

  it("accepts a custom interval", () => {
    const job = createCleanupJob(5000);
    expect(job.interval).toBe(5000);
  });

  it("deletes expired sessions and logs the count", async () => {
    mockDeleteExpiredSessions.mockReturnValue(7);

    const job = createCleanupJob();
    await job.fn();

    expect(mockDeleteExpiredSessions).toHaveBeenCalledOnce();

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.session-cleanup");
    expect(entry).toBeDefined();
    expect(entry!.job).toBe("session-cleanup");
    expect(entry!.deletedCount).toBe(7);
    expect(typeof entry!.timestamp).toBe("string");
  });

  it("logs zero when no sessions are expired", async () => {
    mockDeleteExpiredSessions.mockReturnValue(0);

    const job = createCleanupJob();
    await job.fn();

    const entries = getLogEntries();
    const entry = entries.find((e) => e.event === "job.session-cleanup");
    expect(entry).toBeDefined();
    expect(entry!.deletedCount).toBe(0);
  });

  it("catches errors and logs them without re-throwing", async () => {
    mockDeleteExpiredSessions.mockImplementation(() => {
      throw new Error("db locked");
    });

    const job = createCleanupJob();
    await expect(job.fn()).resolves.toBeUndefined();

    const entries = getLogEntries();
    const errorEntry = entries.find((e) => e.event === "job.session-cleanup.error");
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.job).toBe("session-cleanup");
    expect(errorEntry!.error).toBe("db locked");
  });

  it("handles non-Error thrown values", async () => {
    mockDeleteExpiredSessions.mockImplementation(() => {
      throw "unexpected string error";
    });

    const job = createCleanupJob();
    await expect(job.fn()).resolves.toBeUndefined();

    const entries = getLogEntries();
    const errorEntry = entries.find((e) => e.event === "job.session-cleanup.error");
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.error).toBe("unexpected string error");
  });
});
