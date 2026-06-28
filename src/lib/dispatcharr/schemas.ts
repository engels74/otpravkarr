import { z } from "zod";

/**
 * Dispatcharr User schema aligned with the real API (OpenAPI 3.0.3 spec).
 *
 * The OpenAPI response marks `id`, `username`, and `api_key` as required.
 * This schema intentionally enforces only `id` and `username`; `api_key` is
 * accepted as an additional passthrough field.
 * The API may return additional fields beyond what we parse here; `.passthrough()`
 * ensures we don't reject them.
 *
 * Fields we actively use:
 *   id, username, email, is_staff
 *
 * Fields the API returns but we don't use locally (accepted via passthrough):
 *   api_key, user_level, channel_profiles, custom_properties, avatar_config,
 *   stream_limit, is_superuser, last_login, date_joined, first_name, last_name
 *
 * Note: `custom_properties.xc_password` is the credential Dispatcharr's
 * Xtream-Codes endpoints (`/get.php`, `/player_api.php`) authenticate against.
 * It is written during provisioning (see CreateUserData) and is distinct from
 * the Django `password` field used for admin/UI login.
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
 * Dispatcharr Channel Group schema (`/api/channels/groups/`).
 *
 * These are CHANNEL groups (organize channels), NOT the Django permission
 * groups served by `/api/accounts/groups/` (see DispatcharrGroupSchema).
 * The API returns a flat array of `{ id, name, channel_count, ... }`;
 * `.passthrough()` accepts `m3u_account_count` / `m3u_accounts` etc.
 */
export const DispatcharrChannelGroupSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    channel_count: z.number().nullable().optional(),
  })
  .passthrough();

/**
 * Channel Profile with its enabled-channel membership.
 *
 * The OpenAPI spec types `channels` as a string, but the real API returns an
 * array of enabled channel IDs. Parse defensively: coerce any non-array shape
 * (string / null / missing) to an empty list and drop non-numeric entries.
 */
export const DispatcharrChannelProfileWithChannelsSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    channels: z.preprocess(
      (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "number") : []),
      z.array(z.number()),
    ),
  })
  .passthrough();

/**
 * Dispatcharr Channel schema aligned with the real API (OpenAPI 3.0.3 spec).
 *
 * Required in responses: id, name
 * The API uses `channel_number` (double, nullable) — NOT `number`.
 * There is NO `enabled` field in the real API.
 * `channel_group_id` / `effective_channel_group_id` carry the channel's group
 * (the latter honors ChannelOverride). `user_level` gates visibility against
 * `user.user_level` (>= 10 bypasses profile filtering). `.passthrough()`
 * accepts additional fields the API returns.
 */
export const DispatcharrChannelSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    channel_number: z.number().nullable().optional(),
    channel_group_id: z.number().nullable().optional(),
    effective_channel_group_id: z.number().nullable().optional(),
    user_level: z.number().nullable().optional(),
  })
  .passthrough();

/** Minimal schema for health-probe responses (paginated endpoint, items ignored). */
export const HealthProbeSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(z.unknown()),
});

/**
 * Dispatcharr plugin entry from `GET /api/plugins/plugins/`.
 *
 * The OpenAPI spec marks this endpoint "No response body" (untyped), so parse
 * defensively: require only `key` + `name`, accept everything else via
 * passthrough, and coerce `settings` to an object when present. The real API
 * returns `{ plugins: [...] }` with each entry carrying enabled/version/settings/
 * fields/actions and update metadata.
 */
export const DispatcharrPluginSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    version: z.string().nullable().optional(),
    enabled: z.boolean().optional().default(false),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** `{ plugins: [...] }` envelope. Tolerates a bare array as a fallback. */
export const DispatcharrPluginsResponseSchema = z.union([
  z.object({ plugins: z.array(DispatcharrPluginSchema) }),
  z.array(DispatcharrPluginSchema),
]);

export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}
