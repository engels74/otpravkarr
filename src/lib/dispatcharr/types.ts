export interface DispatcharrUser {
  id: number;
  username: string;
  email?: string | undefined;
  is_staff: boolean;
  is_superuser: boolean;
  /** Passthrough fields from the API that we don't actively use */
  [key: string]: unknown;
}

export interface DispatcharrGroup {
  id: number;
  name: string;
  permissions: number[];
}

export interface DispatcharrChannelProfile {
  id: number;
  name: string;
}

/** Channel group from `/api/channels/groups/` (NOT a Django permission group). */
export interface DispatcharrChannelGroup {
  id: number;
  name: string;
  channel_count?: number | null | undefined;
  /** Passthrough fields (m3u_account_count, m3u_accounts, …) we don't actively use */
  [key: string]: unknown;
}

/** Channel profile plus its enabled-channel membership (array of channel IDs). */
export interface DispatcharrChannelProfileWithChannels {
  id: number;
  name: string;
  channels: number[];
  [key: string]: unknown;
}

/** Plugin entry from `/api/plugins/plugins/` (untyped in the OpenAPI spec). */
export interface DispatcharrPlugin {
  key: string;
  name: string;
  version?: string | null | undefined;
  enabled: boolean;
  settings?: Record<string, unknown> | undefined;
  /** Passthrough: fields, actions, slug, update_available, loaded, missing, … */
  [key: string]: unknown;
}

export interface DispatcharrChannel {
  id: number;
  name: string;
  channel_number?: number | null | undefined;
  channel_group_id?: number | null | undefined;
  effective_channel_group_id?: number | null | undefined;
  user_level?: number | null | undefined;
  /** Passthrough fields from the API that we don't actively use */
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type DispatcharrErrorCode =
  | "auth_failure"
  | "network_error"
  | "server_error"
  | "unexpected_shape"
  | "not_found"
  | "validation_error";

export type DispatcharrResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DispatcharrErrorCode; message: string; retryable?: boolean };
