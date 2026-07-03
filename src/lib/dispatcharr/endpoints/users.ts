import { z } from "zod";

import type { DispatcharrClient } from "../client";
import { DispatcharrUserSchema, paginatedSchema } from "../schemas";
import type { DispatcharrResult, DispatcharrUser, PaginatedResponse } from "../types";

const userPageSchema = paginatedSchema(DispatcharrUserSchema);
const flatArraySchema = z.array(DispatcharrUserSchema);

function normalizeUserPage(data: unknown): DispatcharrResult<PaginatedResponse<DispatcharrUser>> {
  const paginated = userPageSchema.safeParse(data);
  if (paginated.success) return { ok: true, data: paginated.data };

  const flat = flatArraySchema.safeParse(data);
  if (flat.success) {
    return {
      ok: true,
      data: { count: flat.data.length, next: null, previous: null, results: flat.data },
    };
  }

  return { ok: false, error: "unexpected_shape" as const, message: paginated.error.message };
}

/**
 * Fields accepted by POST /api/accounts/users/ per the Dispatcharr OpenAPI spec.
 * Only `username` and `password` are required. Other writable fields are optional.
 *
 * `custom_properties.xc_password` is the credential checked by Dispatcharr's
 * Xtream-Codes endpoints (`/get.php`, `/player_api.php`); the Django `password`
 * field above only covers the admin/UI login.
 */
export interface CreateUserData {
  username: string;
  password: string;
  email?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  user_level?: number;
  channel_profiles?: number[];
  stream_limit?: number;
  first_name?: string;
  last_name?: string;
  custom_properties?: Record<string, unknown>;
}

/**
 * Fields accepted by PATCH /api/accounts/users/{id}/ (PatchedUser schema).
 * All fields are optional for partial updates.
 */
export type UpdateUserData = Partial<{
  username: string;
  password: string;
  email: string;
  is_staff: boolean;
  is_superuser: boolean;
  user_level: number;
  channel_profiles: number[];
  stream_limit: number;
  first_name: string;
  last_name: string;
  custom_properties: Record<string, unknown>;
}>;

export async function listUsers(
  client: DispatcharrClient,
  page?: number,
  pageSize?: number,
): Promise<DispatcharrResult<PaginatedResponse<DispatcharrUser>>> {
  const params = new URLSearchParams();
  if (page != null) params.set("page", String(page));
  if (pageSize != null) params.set("page_size", String(pageSize));

  const qs = params.toString();
  const path = `/api/accounts/users/${qs ? `?${qs}` : ""}`;

  // The Dispatcharr users endpoint is inconsistent across query shapes: the
  // unfiltered and page-only paths usually return a paginated envelope, while
  // username filtering can return a flat array. Normalize both so callers do not
  // need to care which representation a specific Dispatcharr build chooses.
  const result = await client.request<unknown>("GET", path);
  if (!result.ok) return result;

  return normalizeUserPage(result.data);
}

export async function findUserByUsername(
  client: DispatcharrClient,
  username: string,
): Promise<DispatcharrResult<DispatcharrUser | null>> {
  const params = new URLSearchParams({ username, page_size: "100" });
  const result = await client.request<unknown>("GET", `/api/accounts/users/?${params}`);
  if (!result.ok) return result;

  const page = normalizeUserPage(result.data);
  if (!page.ok) return page;

  const exact = page.data.results.find((user) => user.username === username) ?? null;
  return { ok: true, data: exact };
}

export function createUser(
  client: DispatcharrClient,
  data: CreateUserData,
): Promise<DispatcharrResult<DispatcharrUser>> {
  return client.request("POST", "/api/accounts/users/", {
    body: data,
    schema: DispatcharrUserSchema,
  });
}

export function getUser(
  client: DispatcharrClient,
  id: number,
): Promise<DispatcharrResult<DispatcharrUser>> {
  return client.request("GET", `/api/accounts/users/${id}/`, {
    schema: DispatcharrUserSchema,
  });
}

export function updateUser(
  client: DispatcharrClient,
  id: number,
  data: UpdateUserData,
  timeoutMs?: number,
): Promise<DispatcharrResult<DispatcharrUser>> {
  // Use PATCH for partial updates (PatchedUser schema in the API spec).
  // `timeoutMs` lets a caller that wraps this in `withDeadline(work, ms, fallback)`
  // set the request's own timeout to that same `ms`, so ofetch aborts the in-flight
  // PATCH when the deadline is hit instead of leaving an orphaned mutation to land
  // late and desync remote vs. local state. Omitted → the client default (15s).
  return client.request("PATCH", `/api/accounts/users/${id}/`, {
    body: data,
    schema: DispatcharrUserSchema,
    // Omit rather than pass `undefined` (exactOptionalPropertyTypes); an absent
    // timeoutMs falls through to the client default in `request`.
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

export function deleteUser(
  client: DispatcharrClient,
  id: number,
): Promise<DispatcharrResult<void>> {
  return client.request("DELETE", `/api/accounts/users/${id}/`);
}
