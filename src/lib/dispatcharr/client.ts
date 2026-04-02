import { type FetchOptions, ofetch } from "ofetch";
import type { z } from "zod";

import type { DispatcharrResult } from "./types";

export class DispatcharrClient {
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    // Strip trailing slash for consistent URL joining
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async request<T>(
    method: string,
    path: string,
    options?: { body?: unknown; schema?: z.ZodType<T> },
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

    const fetchOptions: FetchOptions = {
      method,
      headers: {
        Authorization: `ApiKey ${this.apiKey}`,
      },
    };

    if (options?.body !== undefined) {
      fetchOptions.body = options.body;
    }

    let data: unknown;

    try {
      data = await ofetch(url, fetchOptions);
    } catch (error: unknown) {
      return this.mapFetchError(error);
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

  private mapFetchError<T>(error: unknown): DispatcharrResult<T> {
    // ofetch throws FetchError with response status
    if (
      error != null &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as Record<string, unknown>).statusCode === "number"
    ) {
      const statusCode = (error as Record<string, unknown>).statusCode as number;
      const message =
        (error as Record<string, unknown>).statusMessage ??
        (error instanceof Error ? error.message : String(error));

      if (statusCode === 401 || statusCode === 403) {
        return { ok: false, error: "auth_failure", message: String(message) };
      }
      if (statusCode === 404) {
        return { ok: false, error: "not_found", message: String(message) };
      }
      // Remaining 4xx client errors
      if (statusCode >= 400 && statusCode < 500) {
        return { ok: false, error: "validation_error", message: String(message) };
      }
      // 5xx: server responded but with an error (distinct from network_error)
      return { ok: false, error: "server_error", message: String(message) };
    }

    // Generic network / other error
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: "network_error", message };
  }
}
