export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

export type RetryOptions = Partial<RetryConfig>;

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: 1,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeDelay(
  attempt: number,
  config: RetryConfig,
  random: () => number = Math.random,
): number {
  const raw = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
  const fixedPortion = raw * (1 - config.jitter);
  const jitteredPortion = raw * config.jitter * random();
  return Math.floor(fixedPortion + jitteredPortion);
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  shouldRetry?: (error: unknown) => boolean,
  options?: RetryOptions,
): Promise<T> {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options };
  config.maxRetries = Number.isFinite(config.maxRetries)
    ? Math.max(0, config.maxRetries)
    : DEFAULT_RETRY_CONFIG.maxRetries;
  config.baseDelayMs = Number.isFinite(config.baseDelayMs)
    ? Math.max(0, config.baseDelayMs)
    : DEFAULT_RETRY_CONFIG.baseDelayMs;
  config.maxDelayMs = Number.isFinite(config.maxDelayMs)
    ? Math.max(0, config.maxDelayMs)
    : DEFAULT_RETRY_CONFIG.maxDelayMs;
  config.jitter = Number.isFinite(config.jitter)
    ? Math.max(0, Math.min(1, config.jitter))
    : DEFAULT_RETRY_CONFIG.jitter;

  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }
      if (attempt < config.maxRetries) {
        await sleep(computeDelay(attempt, config));
      }
    }
  }
  throw lastError;
}

export async function retryResult<T, R extends { ok: boolean }>(
  fn: () => Promise<R>,
  shouldRetry: (result: R & { ok: false }) => boolean,
  options?: RetryOptions,
): Promise<R> {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options };
  config.maxRetries = Number.isFinite(config.maxRetries)
    ? Math.max(0, config.maxRetries)
    : DEFAULT_RETRY_CONFIG.maxRetries;
  config.baseDelayMs = Number.isFinite(config.baseDelayMs)
    ? Math.max(0, config.baseDelayMs)
    : DEFAULT_RETRY_CONFIG.baseDelayMs;
  config.maxDelayMs = Number.isFinite(config.maxDelayMs)
    ? Math.max(0, config.maxDelayMs)
    : DEFAULT_RETRY_CONFIG.maxDelayMs;
  config.jitter = Number.isFinite(config.jitter)
    ? Math.max(0, Math.min(1, config.jitter))
    : DEFAULT_RETRY_CONFIG.jitter;

  let lastResult!: R;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    lastResult = await fn();
    if (lastResult.ok) {
      return lastResult;
    }
    if (!shouldRetry(lastResult as R & { ok: false })) {
      return lastResult;
    }
    if (attempt < config.maxRetries) {
      await sleep(computeDelay(attempt, config));
    }
  }
  return lastResult;
}

export function isTransientResultError(result: { error: string; retryable?: boolean }): boolean {
  if (result.retryable === false) {
    return false;
  }
  return result.error === "network_error" || result.error === "server_error";
}

export function isTransientPlexError(error: unknown): boolean {
  if (error instanceof Error) {
    // plex-api surfaces transient network failures with this exact message,
    // which oauth.ts re-wraps into PlexAuthError("OAuth initiation failed: ...").
    if (error.message.includes("Unable to connect. Is the computer able to access the url?")) {
      return true;
    }
    if (error.name === "PlexAuthError") {
      return false;
    }
  }
  return true;
}
