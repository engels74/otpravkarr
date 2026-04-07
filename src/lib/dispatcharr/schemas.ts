import { z } from "zod";

/**
 * Dispatcharr User schema aligned with the real API (OpenAPI 3.0.3 spec).
 *
 * Required in responses: id, username, api_key
 * The API may return additional fields beyond what we parse here; `.passthrough()`
 * ensures we don't reject them.
 *
 * Fields we actively use:
 *   id, username, email, is_staff
 *
 * Fields the API returns but we don't use locally (accepted via passthrough):
 *   api_key, user_level, channel_profiles, custom_properties, avatar_config,
 *   stream_limit, is_superuser, last_login, date_joined, first_name, last_name
 */
export const DispatcharrUserSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    email: z.string().optional(),
    is_staff: z.boolean().optional().default(false),
    is_superuser: z.boolean().optional().default(false),
  })
  .passthrough();

export const DispatcharrGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  permissions: z.array(z.number()),
});

export const DispatcharrChannelProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
});

/**
 * Dispatcharr Channel schema aligned with the real API (OpenAPI 3.0.3 spec).
 *
 * Required in responses: id, name
 * The API uses `channel_number` (double, nullable) — NOT `number`.
 * There is NO `enabled` field in the real API.
 * `.passthrough()` accepts additional fields the API returns.
 */
export const DispatcharrChannelSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    channel_number: z.number().nullable().optional(),
  })
  .passthrough();

/** Minimal schema for health-probe responses (paginated endpoint, items ignored). */
export const HealthProbeSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(z.unknown()),
});

export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}
