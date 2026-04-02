import type { z } from "zod";

import type { DispatcharrClient } from "./client";
import { paginatedSchema } from "./schemas";
import type { DispatcharrErrorCode, DispatcharrResult, PaginatedResponse } from "./types";

export class PaginationError extends Error {
  readonly code: DispatcharrErrorCode;

  constructor(code: DispatcharrErrorCode, message: string) {
    super(`Pagination failed: ${code} — ${message}`);
    this.name = "PaginationError";
    this.code = code;
  }
}

async function* paginate<T>(
  client: DispatcharrClient,
  initialUrl: string,
  itemSchema: z.ZodType<T>,
): AsyncGenerator<T[], void, undefined> {
  let url: string | null = initialUrl;
  const envelope = paginatedSchema(itemSchema);

  while (url != null) {
    // Convert absolute URLs to relative paths for the client
    let path: string;
    try {
      const parsed = new URL(url, client.baseUrl);
      path = parsed.pathname + parsed.search;
    } catch {
      path = url.startsWith("/") ? url : `/${url}`;
    }

    const result: DispatcharrResult<PaginatedResponse<T>> = await client.request<
      PaginatedResponse<T>
    >("GET", path, {
      schema: envelope,
    });

    if (!result.ok) {
      throw new PaginationError(result.error, result.message);
    }

    yield result.data.results;
    url = result.data.next;
  }
}

export async function fetchAllPages<T>(
  client: DispatcharrClient,
  url: string,
  itemSchema: z.ZodType<T>,
): Promise<DispatcharrResult<T[]>> {
  const all: T[] = [];
  try {
    for await (const page of paginate(client, url, itemSchema)) {
      all.push(...page);
    }
  } catch (error) {
    if (error instanceof PaginationError) {
      return { ok: false, error: error.code, message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: "network_error", message };
  }
  return { ok: true, data: all };
}
