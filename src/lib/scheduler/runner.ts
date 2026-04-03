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

export class Scheduler {
  private jobs = new Map<string, JobEntry>();
  private started = false;

  register(job: Job): void {
    if (this.jobs.has(job.name)) {
      throw new Error(`Job "${job.name}" is already registered`);
    }
    if (job.interval <= 0) {
      throw new Error(`Job "${job.name}" has invalid interval ${job.interval}ms (must be > 0)`);
    }
    const entry: JobEntry = {
      job,
      timer: null,
      running: false,
      lastRunAt: null,
      lastDurationMs: null,
      nextScheduledAt: null,
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

  private scheduleTick(entry: JobEntry): void {
    if (!this.started) return;

    const now = Date.now();
    const nextScheduledAt = entry.nextScheduledAt ?? now;
    const nextFireAt = nextScheduledAt + entry.job.interval;
    const delay = Math.max(0, nextFireAt - now);

    entry.nextScheduledAt = nextFireAt;
    entry.timer = setTimeout(() => this.tick(entry), delay);
  }

  private async tick(entry: JobEntry): Promise<void> {
    if (!this.started) return;

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
