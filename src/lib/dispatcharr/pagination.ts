import type { z } from "zod";

import type { DispatcharrClient } from "./client";
import { paginatedSchema } from "./schemas";
import type { DispatcharrResult, PaginatedResponse } from "./types";

async function* paginate<T>(
  client: DispatcharrClient,
  initialUrl: string,
  itemSchema: z.ZodType<T>,
): AsyncGenerator<T[], void, undefined> {
  let url: string | null = initialUrl;
  const envelope = paginatedSchema(itemSchema);

  while (url != null) {
    // Convert absolute URLs to relative paths for the client
    const path: string = url.startsWith(client.baseUrl) ? url.slice(client.baseUrl.length) : url;

    const result: DispatcharrResult<PaginatedResponse<T>> = await client.request<
      PaginatedResponse<T>
    >("GET", path, {
      schema: envelope,
    });

    if (!result.ok) {
      throw new Error(`Pagination failed: ${result.error} — ${result.message}`);
    }

    yield result.data.results;
    url = result.data.next;
  }
}

export async function fetchAllPages<T>(
  client: DispatcharrClient,
  url: string,
  itemSchema: z.ZodType<T>,
): Promise<T[]> {
  const all: T[] = [];
  for await (const page of paginate(client, url, itemSchema)) {
    all.push(...page);
  }
  return all;
}
