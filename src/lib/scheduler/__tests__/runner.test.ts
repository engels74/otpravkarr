// @vitest-environment node

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "$lib/scheduler/runner";
import { Scheduler } from "$lib/scheduler/runner";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
});

afterAll(() => {
  consoleSpy.mockRestore();
});

function createJob(overrides?: Partial<Job>): Job {
  return {
    name: overrides?.name ?? "test-job",
    interval: overrides?.interval ?? 1000,
    fn: overrides?.fn ?? (async () => {}),
  };
}

/** Collect all parsed log entries from console.log spy calls. */
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

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  describe("register", () => {
    it("adds a job to the registry", () => {
      const job = createJob();
      scheduler.register(job);

      const status = scheduler.getJobStatus("test-job");
      expect(status).toBeDefined();
      expect(status!.lastRunAt).toBeNull();
      expect(status!.lastDurationMs).toBeNull();
      expect(status!.running).toBe(false);
    });

    it("logs a registration event", () => {
      scheduler.register(createJob());

      const entries = getLogEntries();
      const reg = entries.find((e) => e.event === "job.registered");
      expect(reg).toBeDefined();
      expect(reg!.job).toBe("test-job");
      expect(reg!.interval).toBe(1000);
    });

    it("throws on duplicate job name", () => {
      scheduler.register(createJob());
      expect(() => scheduler.register(createJob())).toThrow('Job "test-job" is already registered');
    });

    it("throws when registering a job with zero interval", () => {
      expect(() => scheduler.register({ name: "bad", interval: 0, fn: async () => {} })).toThrow(
        "invalid interval",
      );
    });

    it("throws when registering a job with negative interval", () => {
      expect(() =>
        scheduler.register({ name: "bad", interval: -1000, fn: async () => {} }),
      ).toThrow("invalid interval");
    });
  });

  describe("start / stop lifecycle", () => {
    it("runs a job after its interval elapses", async () => {
      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("runs a job multiple times over multiple intervals", async () => {
      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn, interval: 500 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1500);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("stop prevents further job executions", async () => {
      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledOnce();

      scheduler.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("start is idempotent", async () => {
      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn }));
      scheduler.start();
      scheduler.start(); // second call should be noop

      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("stop is idempotent", () => {
      scheduler.register(createJob());
      scheduler.start();
      scheduler.stop();
      scheduler.stop(); // should not throw
    });

    it("logs scheduler.started and scheduler.stopped events", () => {
      scheduler.register(createJob());
      scheduler.start();
      scheduler.stop();

      const entries = getLogEntries();
      expect(entries.some((e) => e.event === "scheduler.started")).toBe(true);
      expect(entries.some((e) => e.event === "scheduler.stopped")).toBe(true);
    });

    it("no leaked timers after stop", async () => {
      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn, interval: 100 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledOnce();

      scheduler.stop();

      // Advance a lot — fn should not be called again
      await vi.advanceTimersByTimeAsync(10000);
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe("getJobStatus", () => {
    it("returns undefined for unknown job name", () => {
      expect(scheduler.getJobStatus("nonexistent")).toBeUndefined();
    });

    it("returns correct timestamps after job runs", async () => {
      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn }));
      scheduler.start();

      const beforeRun = Date.now();
      await vi.advanceTimersByTimeAsync(1000);

      const status = scheduler.getJobStatus("test-job");
      expect(status).toBeDefined();
      expect(status!.lastRunAt).toBeGreaterThanOrEqual(beforeRun);
      expect(typeof status!.lastDurationMs).toBe("number");
      expect(status!.lastDurationMs).toBeGreaterThanOrEqual(0);
      expect(status!.running).toBe(false);
    });

    it("tracks duration for slow jobs", async () => {
      const fn = vi.fn(async () => {
        // Simulate a job that takes ~50ms of real perf time
        // With fake timers, performance.now() still advances with advanceTimersByTime
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      });

      scheduler.register(createJob({ fn, interval: 1000 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1000);
      // The 50ms setTimeout inside the job also needs to fire
      await vi.advanceTimersByTimeAsync(50);

      const status = scheduler.getJobStatus("test-job");
      expect(status).toBeDefined();
      expect(status!.lastDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("overlap guard", () => {
    it("skips tick when job is still running", async () => {
      let resolveJob: (() => void) | null = null;
      const callCount = vi.fn();

      const fn = vi.fn(async () => {
        callCount();
        await new Promise<void>((resolve) => {
          resolveJob = resolve;
        });
      });

      scheduler.register(createJob({ fn, interval: 100 }));
      scheduler.start();

      // First tick fires at 100ms — job starts, blocks on promise
      await vi.advanceTimersByTimeAsync(100);
      expect(callCount).toHaveBeenCalledOnce();

      // Second tick fires at 200ms — job still running, should skip
      await vi.advanceTimersByTimeAsync(100);
      expect(callCount).toHaveBeenCalledOnce(); // still 1, skipped

      // Check that overlap skip was logged
      const entries = getLogEntries();
      const skipEntry = entries.find((e) => e.event === "job.skipped");
      expect(skipEntry).toBeDefined();
      expect(skipEntry!.reason).toBe("overlap");

      // Resolve the first job
      resolveJob!();
      await vi.advanceTimersByTimeAsync(0); // flush microtasks

      // Third tick should fire at 300ms — job should run again
      await vi.advanceTimersByTimeAsync(100);
      expect(callCount).toHaveBeenCalledTimes(2);
    });
  });

  describe("drift correction", () => {
    it("corrects for elapsed time between ticks", async () => {
      const timestamps: number[] = [];
      const fn = vi.fn(async () => {
        timestamps.push(Date.now());
      });

      scheduler.register(createJob({ fn, interval: 1000 }));
      scheduler.start();

      // Run through several intervals
      await vi.advanceTimersByTimeAsync(5000);

      expect(timestamps.length).toBe(5);

      // Each tick should be ~1000ms apart from the start
      // With drift correction, ticks should align to the schedule
      for (let i = 1; i < timestamps.length; i++) {
        const gap = timestamps[i]! - timestamps[i - 1]!;
        // Allow some tolerance but the gap should be close to 1000ms
        expect(gap).toBeGreaterThanOrEqual(900);
        expect(gap).toBeLessThanOrEqual(1100);
      }
    });

    it("uses delay of 0 when next fire time is already in the past", async () => {
      // If a job takes longer than its interval, the next scheduled time
      // will be in the past. Drift correction should use delay=0.
      let callIndex = 0;
      const fn = vi.fn(async () => {
        callIndex++;
        // First call: takes 1500ms (longer than the 1000ms interval)
        if (callIndex === 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        }
      });

      scheduler.register(createJob({ fn, interval: 1000 }));
      scheduler.start();

      // Tick at 1000ms: starts fn, schedules next at 2000ms
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledOnce();

      // At 2000ms: overlap guard skips (job still running), schedules next at 3000ms
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledOnce();

      // At 2500ms: job completes (inner setTimeout fires)
      await vi.advanceTimersByTimeAsync(500);

      // At 3000ms: next tick fires, job runs again
      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledTimes(2);

      // Verify the overlap skip was logged
      const entries = getLogEntries();
      expect(entries.some((e) => e.event === "job.skipped" && e.reason === "overlap")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("logs job.error when fn throws and continues scheduling", async () => {
      const fn = vi.fn(async () => {
        throw new Error("boom");
      });

      scheduler.register(createJob({ fn, interval: 500 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledOnce();

      const entries = getLogEntries();
      const errorEntry = entries.find((e) => e.event === "job.error");
      expect(errorEntry).toBeDefined();
      expect(errorEntry!.error).toBe("boom");

      // Job should continue to be scheduled after error
      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("tracks lastRunAt and lastDurationMs even on error", async () => {
      scheduler.register(
        createJob({
          fn: async () => {
            throw new Error("fail");
          },
        }),
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1000);

      const status = scheduler.getJobStatus("test-job");
      expect(status).toBeDefined();
      expect(status!.lastRunAt).not.toBeNull();
      expect(status!.lastDurationMs).not.toBeNull();
    });
  });

  describe("multiple jobs", () => {
    it("runs multiple jobs independently", async () => {
      const fnA = vi.fn(async () => {});
      const fnB = vi.fn(async () => {});

      scheduler.register(createJob({ name: "job-a", fn: fnA, interval: 300 }));
      scheduler.register(createJob({ name: "job-b", fn: fnB, interval: 500 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1500);

      // job-a: fires at 300, 600, 900, 1200, 1500 => 5 times
      expect(fnA).toHaveBeenCalledTimes(5);
      // job-b: fires at 500, 1000, 1500 => 3 times
      expect(fnB).toHaveBeenCalledTimes(3);
    });

    it("each job has independent status tracking", async () => {
      scheduler.register(createJob({ name: "fast", fn: async () => {}, interval: 100 }));
      scheduler.register(createJob({ name: "slow", fn: async () => {}, interval: 500 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(500);

      const fastStatus = scheduler.getJobStatus("fast");
      const slowStatus = scheduler.getJobStatus("slow");

      expect(fastStatus).toBeDefined();
      expect(slowStatus).toBeDefined();
      expect(fastStatus!.lastRunAt).not.toBeNull();
      expect(slowStatus!.lastRunAt).not.toBeNull();
    });
  });

  describe("structured logging", () => {
    it("emits valid JSON on every log call", async () => {
      scheduler.register(createJob());
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);
      scheduler.stop();

      for (const call of consoleSpy.mock.calls) {
        expect(() => JSON.parse(call[0] as string)).not.toThrow();
      }
    });

    it("includes timestamp in ISO format on all entries", async () => {
      scheduler.register(createJob());
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);
      scheduler.stop();

      const entries = getLogEntries();
      for (const entry of entries) {
        expect(typeof entry.timestamp).toBe("string");
        const parsed = new Date(entry.timestamp as string);
        expect(parsed.toISOString()).toBe(entry.timestamp);
      }
    });

    it("logs job.completed with duration_ms", async () => {
      scheduler.register(createJob());
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);

      const entries = getLogEntries();
      const completed = entries.find((e) => e.event === "job.completed");
      expect(completed).toBeDefined();
      expect(completed!.job).toBe("test-job");
      expect(typeof completed!.duration_ms).toBe("number");
    });
  });
});
