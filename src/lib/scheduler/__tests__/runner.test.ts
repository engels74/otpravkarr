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

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as NonNullable<T>;
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

  describe("expectDefined", () => {
    it("rejects null values", () => {
      expect(() => expectDefined(null)).toThrowError(/not to be null/);
    });

    it("rejects undefined values", () => {
      expect(() => expectDefined(undefined)).toThrowError(/to be defined/);
    });
  });

  describe("register", () => {
    it("adds a job to the registry", () => {
      const job = createJob();
      scheduler.register(job);

      const status = expectDefined(scheduler.getJobStatus("test-job"));
      expect(status.lastRunAt).toBeNull();
      expect(status.lastDurationMs).toBeNull();
      expect(status.running).toBe(false);
    });

    it("logs a registration event", () => {
      scheduler.register(createJob());

      const entries = getLogEntries();
      const reg = expectDefined(entries.find((e) => e.event === "job.registered"));
      expect(reg.job).toBe("test-job");
      expect(reg.interval).toBe(1000);
    });

    it("replaces existing job on duplicate name (idempotent)", async () => {
      const fn1 = vi.fn(async () => {});
      const fn2 = vi.fn(async () => {});
      scheduler.register(createJob({ fn: fn1 }));
      scheduler.register(createJob({ fn: fn2 }));
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1000);

      expect(fn2).toHaveBeenCalledOnce();
      expect(fn1).not.toHaveBeenCalled();
    });

    it("keeps the existing job when replacement validation fails", async () => {
      const fn = vi.fn(async () => {});

      scheduler.register(createJob({ fn, interval: 100 }));
      expect(() => scheduler.register(createJob({ interval: 0 }))).toThrow("invalid interval");

      scheduler.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(fn).toHaveBeenCalledOnce();
    });

    it("zombie guard: old timer callback does not re-schedule after re-registration", async () => {
      const fn1 = vi.fn(async () => {});
      const fn2 = vi.fn(async () => {});
      const scheduledCallbacks: Array<() => Promise<void>> = [];
      const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        handler: TimerHandler,
        timeout?: number,
        ...args: unknown[]
      ) => {
        if (typeof handler === "function") {
          scheduledCallbacks.push(handler as () => Promise<void>);
        }

        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof setTimeout);

      try {
        scheduler.register(createJob({ fn: fn1, interval: 100 }));
        scheduler.start();

        // First tick fires at 100ms and schedules the old entry's next callback.
        await vi.advanceTimersByTimeAsync(100);
        expect(fn1).toHaveBeenCalledOnce();
        expect(scheduledCallbacks).toHaveLength(2);

        const staleCallback = expectDefined(scheduledCallbacks[1]);
        expect(staleCallback).toBeTypeOf("function");

        // Re-register with a new function. clearTimeout(existing.timer) removes the
        // old pending timer, so explicitly invoke the stale callback to verify the
        // generation guard inside tick() is what kills the zombie chain.
        scheduler.register(createJob({ fn: fn2, interval: 100 }));
        const scheduledCountBeforeZombieTick = scheduledCallbacks.length;

        await staleCallback();

        expect(fn1).toHaveBeenCalledOnce();
        expect(scheduledCallbacks).toHaveLength(scheduledCountBeforeZombieTick);

        // The replacement job should still execute on its own schedule.
        await vi.advanceTimersByTimeAsync(100);
        expect(fn2).toHaveBeenCalledOnce();
      } finally {
        setTimeoutSpy.mockRestore();
      }
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

    it("throws when registering a job with NaN interval", () => {
      expect(() => scheduler.register({ name: "bad", interval: NaN, fn: async () => {} })).toThrow(
        "invalid interval",
      );
    });

    it("throws when registering a job with Infinity interval", () => {
      expect(() =>
        scheduler.register({ name: "bad", interval: Infinity, fn: async () => {} }),
      ).toThrow("invalid interval");
    });

    it("throws when registering a job with -Infinity interval", () => {
      expect(() =>
        scheduler.register({ name: "bad", interval: -Infinity, fn: async () => {} }),
      ).toThrow("invalid interval");
    });

    it("throws when registering a job with interval exceeding MAX_SAFE_TIMEOUT", () => {
      expect(() =>
        scheduler.register({ name: "bad", interval: 2_147_483_648, fn: async () => {} }),
      ).toThrow("exceeding maximum safe timeout");
    });

    it("schedules a job registered after start()", async () => {
      scheduler.start();

      const fn = vi.fn(async () => {});
      scheduler.register(createJob({ fn, interval: 500 }));

      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledTimes(2);
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

      const status = expectDefined(scheduler.getJobStatus("test-job"));
      expect(status.lastRunAt).toBeGreaterThanOrEqual(beforeRun);
      expect(typeof status.lastDurationMs).toBe("number");
      expect(status.lastDurationMs).toBeGreaterThanOrEqual(0);
      expect(status.running).toBe(false);
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

      const status = expectDefined(scheduler.getJobStatus("test-job"));
      expect(status.lastDurationMs).toBeGreaterThanOrEqual(0);
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
      const skipEntry = expectDefined(entries.find((e) => e.event === "job.skipped"));
      expect(skipEntry.reason).toBe("overlap");

      // Resolve the first job
      expect(resolveJob).toBeDefined();
      if (!resolveJob) {
        throw new Error("expected resolveJob to be assigned");
      }
      const finishJob = resolveJob as () => void;
      finishJob();
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
        const gap = expectDefined(timestamps[i]) - expectDefined(timestamps[i - 1]);
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

    it("skips ahead instead of burst-firing when nextScheduledAt falls far behind", async () => {
      const fn = vi.fn(async () => {});

      scheduler.register(createJob({ fn, interval: 100 }));
      scheduler.start();

      // First tick at 100ms — establishes nextScheduledAt
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledOnce();

      // Simulate stalled event loop: jump Date.now() forward by 10 seconds
      // WITHOUT firing intermediate timers. This makes nextScheduledAt (≈200ms)
      // fall far behind now (≈10100ms), which is exactly the condition the
      // skip-ahead logic in scheduleTick() is designed to handle.
      const baseTime = Date.now();
      vi.setSystemTime(baseTime + 10_000);

      // Now advance fake timers just enough to fire the single pending timer
      // (which was scheduled ~100ms from the first tick). When its callback
      // runs, scheduleTick sees nextScheduledAt far in the past and must
      // skip ahead rather than burst-firing.
      await vi.advanceTimersByTimeAsync(100);

      // With skip-ahead: only 2 calls total (the initial tick + 1 after the gap).
      // Without skip-ahead: scheduleTick would repeatedly schedule 0ms timeouts
      // trying to "catch up" ~100 missed intervals, causing many rapid calls.
      expect(fn).toHaveBeenCalledTimes(2);

      // Verify normal cadence resumes (not bursting) after the skip.
      // Allow ±1 tolerance for timer alignment after the clock jump.
      fn.mockClear();
      await vi.advanceTimersByTimeAsync(300);
      const resumedCalls = fn.mock.calls.length;
      expect(resumedCalls).toBeGreaterThanOrEqual(2);
      expect(resumedCalls).toBeLessThanOrEqual(4);
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
      const errorEntry = expectDefined(entries.find((e) => e.event === "job.error"));
      expect(errorEntry.error).toBe("boom");

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

      const status = expectDefined(scheduler.getJobStatus("test-job"));
      expect(status.lastRunAt).not.toBeNull();
      expect(status.lastDurationMs).not.toBeNull();
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

      const fastStatus = expectDefined(scheduler.getJobStatus("fast"));
      const slowStatus = expectDefined(scheduler.getJobStatus("slow"));
      expect(fastStatus.lastRunAt).not.toBeNull();
      expect(slowStatus.lastRunAt).not.toBeNull();
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
      const completed = expectDefined(entries.find((e) => e.event === "job.completed"));
      expect(completed.job).toBe("test-job");
      expect(typeof completed.duration_ms).toBe("number");
    });
  });
});
