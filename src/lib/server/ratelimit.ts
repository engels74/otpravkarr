export interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(key: string): void;
  resetAll(): void;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { windowMs, maxRequests } = config;
  const store = new Map<string, number[]>();

  function check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = store.get(key) ?? [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length < maxRequests) {
      timestamps.push(now);
      store.set(key, timestamps);
      return {
        allowed: true,
        remaining: maxRequests - timestamps.length,
        resetAt: (timestamps[0] ?? now) + windowMs,
      };
    }

    store.set(key, timestamps);
    return {
      allowed: false,
      remaining: 0,
      resetAt: (timestamps[0] ?? now) + windowMs,
    };
  }

  function reset(key: string): void {
    store.delete(key);
  }

  function resetAll(): void {
    store.clear();
  }

  return { check, reset, resetAll };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Setup endpoint: 5 attempts per 15 minutes (keyed by IP) */
export const setupLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, maxRequests: 5 });

/** Admin login: 10 attempts per 15 minutes (keyed by IP) */
export const loginLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, maxRequests: 10 });

/** User OAuth: 20 attempts per 15 minutes (keyed by IP) */
export const oauthLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, maxRequests: 20 });
