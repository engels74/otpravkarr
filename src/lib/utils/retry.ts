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

export function isTransientResultError(result: { error: string }): boolean {
  return result.error === "network_error" || result.error === "server_error";
}

export function isTransientPlexError(error: unknown): boolean {
  if (error instanceof Error && error.name === "PlexAuthError") {
    return false;
  }
  return true;
}
