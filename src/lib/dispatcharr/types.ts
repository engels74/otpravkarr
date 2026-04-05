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

export interface DispatcharrChannel {
  id: number;
  name: string;
  number: number;
  enabled: boolean;
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
  | { ok: false; error: DispatcharrErrorCode; message: string };
