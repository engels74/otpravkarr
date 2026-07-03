import { type FetchOptions, ofetch } from "ofetch";
import type { z } from "zod";

import { isSafeHttpSecretUrl } from "$lib/server/validation";
import type { DispatcharrResult } from "./types";

function formatResponseDataForLog(responseData: unknown): string {
  const responseType =
    responseData === null ? "null" : Array.isArray(responseData) ? "array" : typeof responseData;

  try {
    const serialized = JSON.stringify(responseData) ?? "";
    return `[redacted ${responseType} response body; ${serialized.length} chars]`;
  } catch {
    return `[redacted ${responseType} response body; unserializable]`;
  }
}

// The svelte-adapter-bun server closes idle sockets after IDLE_TIMEOUT seconds
// (default 10). A render that awaits a Dispatcharr call longer than that window
// is severed mid-flight (ERR_EMPTY_RESPONSE) before its graceful degraded state
// can reach the browser. We mirror the adapter's own env read here.
function parseIdleTimeoutSeconds(): number {
  const raw = Number.parseInt(process.env.IDLE_TIMEOUT ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

/**
 * Derive an interactive request timeout that is always strictly below the
 * adapter's idle window, with ~2s of headroom and a 6s cap. Exposed for tests
 * so the `INTERACTIVE_TIMEOUT_MS < IDLE_TIMEOUT` invariant can be asserted
 * across idle-timeout tunings.
 */
export function computeInteractiveTimeoutMs(idleSeconds: number): number {
  const idleMs = (Number.isFinite(idleSeconds) && idleSeconds > 0 ? idleSeconds : 10) * 1000;
  const withHeadroom = Math.min(6_000, idleMs - 2_000);
  return Math.max(500, Math.min(withHeadroom, idleMs - 1_000));
}

/** The adapter idle window in ms (env-tunable, default 10s). */
export const IDLE_TIMEOUT_MS = parseIdleTimeoutSeconds() * 1000;

/** Per-request timeout for interactive (page-load / connection-test) clients. */
export const INTERACTIVE_TIMEOUT_MS = computeInteractiveTimeoutMs(parseIdleTimeoutSeconds());

// Fail-fast operator signal: the derivation above guarantees the invariant for
// any sane IDLE_TIMEOUT, so this only fires on a pathological (sub-second) tune.
if (INTERACTIVE_TIMEOUT_MS >= IDLE_TIMEOUT_MS) {
  console.warn(
    `[dispatcharr] INTERACTIVE_TIMEOUT_MS (${INTERACTIVE_TIMEOUT_MS}ms) is not below IDLE_TIMEOUT (${IDLE_TIMEOUT_MS}ms); interactive loads may be severed before rendering.`,
  );
}

/** Default (robust) request timeout: generous, for background jobs & mutations. */
const ROBUST_TIMEOUT_MS = 15_000;

export interface DispatcharrClientDefaults {
  /** Overrides the 15s default request timeout. */
  timeoutMs?: number;
  /** Overrides the idempotent-GET/HEAD retry count (default 1 for GET/HEAD, 0 otherwise). */
  retries?: number;
}

export interface DispatcharrRequestOptions<T> {
  body?: unknown;
  schema?: z.ZodType<T>;
  /** Per-call timeout override; falls back to the client default, then 15s. */
  timeoutMs?: number;
  /** Per-call retry override; falls back to the client default, then idempotent default. */
  retries?: number;
}

export class DispatcharrClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultTimeoutMs: number | undefined;
  private readonly defaultRetries: number | undefined;

  constructor(baseUrl: string, apiKey: string, defaults?: DispatcharrClientDefaults) {
    if (!isSafeHttpSecretUrl(baseUrl)) {
      throw new Error(
        "Refusing to send Dispatcharr API key over insecure transport — only https:// is accepted (http:// is allowed for loopback hosts only)",
      );
    }
    // Strip trailing slash for consistent URL joining
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.defaultTimeoutMs = defaults?.timeoutMs;
    this.defaultRetries = defaults?.retries;
  }

  async request<T>(
    method: string,
    path: string,
    options?: DispatcharrRequestOptions<T>,
  ): Promise<DispatcharrResult<T>> {
    // Guard against absolute URLs: extract just the path+search portion
    let normalizedPath = path;
    if (normalizedPath.startsWith("http://") || normalizedPath.startsWith("https://")) {
      try {
        const parsed = new URL(normalizedPath);
        normalizedPath = parsed.pathname + parsed.search;
      } catch {
        return {
          ok: false,
          error: "validation_error",
          message: `Invalid URL path: ${path}`,
        };
      }
    }
    if (!normalizedPath.startsWith("/")) {
      normalizedPath = `/${normalizedPath}`;
    }
    const url = `${this.baseUrl}${normalizedPath}`;

    const isIdempotent = method === "GET" || method === "HEAD";

    // Per-call option wins, then the client's profile default, then the built-in
    // default. Defaults preserve the original behaviour exactly (15s timeout,
    // one retry for idempotent GET/HEAD, none otherwise).
    const timeout = options?.timeoutMs ?? this.defaultTimeoutMs ?? ROBUST_TIMEOUT_MS;
    const retry = options?.retries ?? this.defaultRetries ?? (isIdempotent ? 1 : 0);

    const fetchOptions: FetchOptions = {
      method,
      timeout,
      retry,
      headers: {
        Authorization: `ApiKey ${this.apiKey}`,
      },
    };

    if (options?.body !== undefined) {
      fetchOptions.body = options.body;
      (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
    }

    let data: unknown;

    try {
      data = await ofetch(url, fetchOptions);
    } catch (error: unknown) {
      return this.mapFetchError(error, isIdempotent);
    }

    if (options?.schema) {
      const result = options.schema.safeParse(data);
      if (!result.success) {
        return {
          ok: false,
          error: "unexpected_shape",
          message: result.error.message,
        };
      }
      return { ok: true, data: result.data };
    }

    return { ok: true, data: data as T };
  }

  private mapFetchError<T>(error: unknown, isIdempotent: boolean): DispatcharrResult<T> {
    // ofetch throws FetchError with response status
    if (
      error != null &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as Record<string, unknown>).statusCode === "number"
    ) {
      const statusCode = (error as Record<string, unknown>).statusCode as number;
      // ofetch FetchError includes parsed response body as `data`
      const responseData = (error as Record<string, unknown>).data;

      // Log raw response for debugging; keep user-facing message generic
      if (responseData !== undefined) {
        console.error(`[dispatcharr] ${statusCode}: ${formatResponseDataForLog(responseData)}`);
      }

      const message = String(
        (error as Record<string, unknown>).statusMessage ??
          (error instanceof Error ? error.message : `Dispatcharr API error (${statusCode})`),
      );

      if (statusCode === 401 || statusCode === 403) {
        return { ok: false, error: "auth_failure", message };
      }
      if (statusCode === 404) {
        return { ok: false, error: "not_found", message };
      }
      // Remaining 4xx client errors
      if (statusCode >= 400 && statusCode < 500) {
        return { ok: false, error: "validation_error", message };
      }
      // 5xx: server responded but with an error (distinct from network_error)
      if (!isIdempotent) {
        return { ok: false, error: "server_error", message, retryable: false };
      }
      return { ok: false, error: "server_error", message };
    }

    // Generic network / other error
    const message = error instanceof Error ? error.message : String(error);
    if (!isIdempotent) {
      return { ok: false, error: "network_error", message, retryable: false };
    }
    return { ok: false, error: "network_error", message };
  }
}

/**
 * Robust client for background jobs, the bridge, provisioning, credential
 * serving, and health probes: the original 15s timeout with an idempotent-GET
 * retry. Use this whenever there is no idle-socket deadline to race.
 */
export function createRobustClient(baseUrl: string, apiKey: string): DispatcharrClient {
  return new DispatcharrClient(baseUrl, apiKey);
}

/**
 * Interactive client for page loads and connection tests: a short timeout
 * (< IDLE_TIMEOUT) and no retries, so the caller's graceful-degradation path
 * renders before the adapter severs the socket. Bounds a *single* call; a
 * multi-call load (e.g. paginated drift) must additionally use an aggregate
 * deadline (see withDeadline).
 */
export function createInteractiveClient(baseUrl: string, apiKey: string): DispatcharrClient {
  return new DispatcharrClient(baseUrl, apiKey, { timeoutMs: INTERACTIVE_TIMEOUT_MS, retries: 0 });
}
