export interface Job {
  name: string;
  interval: number;
  fn: () => Promise<void>;
}

export interface JobStatus {
  lastRunAt: number | null;
  lastDurationMs: number | null;
  running: boolean;
}

interface JobEntry {
  job: Job;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  nextScheduledAt: number | null;
  generation: number;
}

function log(event: string, job: string, extra?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      job,
      ...extra,
    }),
  );
}

/** Maximum safe setTimeout delay (2^31 - 1 ms ≈ 24.85 days). Larger values are clamped to 0 by JS runtimes. */
const MAX_SAFE_TIMEOUT = 2_147_483_647;

export type RunExclusiveResult<T> =
  | { ok: true; result: T }
  | { ok: false; reason: "already_running" | "unknown_job" };

export class Scheduler {
  private jobs = new Map<string, JobEntry>();
  private started = false;
  private generationCounter = 0;

  register(job: Job): void {
    if (!Number.isFinite(job.interval) || job.interval <= 0) {
      throw new Error(
        `Job "${job.name}" has invalid interval ${job.interval}ms (must be a finite number > 0)`,
      );
    }
    if (job.interval > MAX_SAFE_TIMEOUT) {
      throw new Error(
        `Job "${job.name}" has interval ${job.interval}ms exceeding maximum safe timeout (${MAX_SAFE_TIMEOUT}ms)`,
      );
    }

    const existing = this.jobs.get(job.name);
    if (existing) {
      if (existing.timer !== null) {
        clearTimeout(existing.timer);
      }
      this.jobs.delete(job.name);
    }
    const entry: JobEntry = {
      job,
      timer: null,
      running: false,
      lastRunAt: null,
      lastDurationMs: null,
      nextScheduledAt: null,
      generation: ++this.generationCounter,
    };
    this.jobs.set(job.name, entry);
    log("job.registered", job.name, { interval: job.interval });

    // If scheduler is already running, schedule immediately
    if (this.started) {
      this.scheduleTick(entry);
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    for (const entry of this.jobs.values()) {
      this.scheduleTick(entry);
    }

    log("scheduler.started", "*", { jobCount: this.jobs.size });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const entry of this.jobs.values()) {
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      entry.nextScheduledAt = null;
    }

    log("scheduler.stopped", "*");
  }

  getJobStatus(name: string): JobStatus | undefined {
    const entry = this.jobs.get(name);
    if (!entry) return undefined;
    return {
      lastRunAt: entry.lastRunAt,
      lastDurationMs: entry.lastDurationMs,
      running: entry.running,
    };
  }

  async runExclusive<T>(name: string, fn: () => Promise<T>): Promise<RunExclusiveResult<T>> {
    const entry = this.jobs.get(name);
    if (!entry) return { ok: false, reason: "unknown_job" };
    if (entry.running) return { ok: false, reason: "already_running" };

    entry.running = true;
    const start = performance.now();

    try {
      const result = await fn();
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      entry.lastRunAt = Date.now();
      entry.lastDurationMs = durationMs;
      return { ok: true, result };
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      entry.lastRunAt = Date.now();
      entry.lastDurationMs = durationMs;
      throw err;
    } finally {
      entry.running = false;
    }
  }

  private scheduleTick(entry: JobEntry): void {
    if (!this.started) return;

    const now = Date.now();
    const lastScheduled = entry.nextScheduledAt ?? now;
    let nextFireAt = lastScheduled + entry.job.interval;

    // If we've fallen behind, skip ahead to the next future tick
    // instead of rapidly firing to "catch up"
    if (nextFireAt <= now) {
      const missedTicks = Math.ceil((now - nextFireAt) / entry.job.interval);
      nextFireAt += missedTicks * entry.job.interval;
    }

    const delay = Math.min(nextFireAt - now, MAX_SAFE_TIMEOUT);
    entry.nextScheduledAt = nextFireAt;
    entry.timer = setTimeout(() => this.tick(entry), delay);
  }

  private async tick(entry: JobEntry): Promise<void> {
    if (!this.started) return;

    // Guard against zombie callbacks: if this entry was replaced by a new
    // registration, the map will hold a different generation. Bail out so
    // the stale timer chain dies.
    const current = this.jobs.get(entry.job.name);
    if (!current || current.generation !== entry.generation) return;

    if (entry.running) {
      log("job.skipped", entry.job.name, { reason: "overlap" });
      this.scheduleTick(entry);
      return;
    }

    // Schedule the next tick BEFORE running so that the overlap guard
    // can fire while this job is still awaiting.
    this.scheduleTick(entry);

    entry.running = true;
    const start = performance.now();

    try {
      await entry.job.fn();
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      entry.lastRunAt = Date.now();
      entry.lastDurationMs = durationMs;
      log("job.completed", entry.job.name, { duration_ms: durationMs });
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      entry.lastRunAt = Date.now();
      entry.lastDurationMs = durationMs;
      log("job.error", entry.job.name, {
        duration_ms: durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      entry.running = false;
    }
  }
}

export const scheduler = new Scheduler();
