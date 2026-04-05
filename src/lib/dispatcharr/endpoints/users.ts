import type { DispatcharrClient } from "../client";
import { DispatcharrUserSchema, paginatedSchema } from "../schemas";
import type { DispatcharrResult, DispatcharrUser, PaginatedResponse } from "../types";

const userPageSchema = paginatedSchema(DispatcharrUserSchema);

/**
 * Fields accepted by POST /api/accounts/users/ per the Dispatcharr OpenAPI spec.
 * Only `username` and `password` are required. Other writable fields are optional.
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
}>;

export function listUsers(
  client: DispatcharrClient,
  page?: number,
  pageSize?: number,
): Promise<DispatcharrResult<PaginatedResponse<DispatcharrUser>>> {
  const params = new URLSearchParams();
  if (page != null) params.set("page", String(page));
  if (pageSize != null) params.set("page_size", String(pageSize));

  const qs = params.toString();
  const path = `/api/accounts/users/${qs ? `?${qs}` : ""}`;

  return client.request("GET", path, { schema: userPageSchema });
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
): Promise<DispatcharrResult<DispatcharrUser>> {
  // Use PATCH for partial updates (PatchedUser schema in the API spec)
  return client.request("PATCH", `/api/accounts/users/${id}/`, {
    body: data,
    schema: DispatcharrUserSchema,
  });
}

export function deleteUser(
  client: DispatcharrClient,
  id: number,
): Promise<DispatcharrResult<void>> {
  return client.request("DELETE", `/api/accounts/users/${id}/`);
}
