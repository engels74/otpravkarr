export interface PlexIdentity {
  id: number;
  uuid: string;
  username: string;
  email: string;
  thumb: string;
  authenticationToken: string;
}

export interface PlexFriend {
  id: number;
  uuid?: string | null | undefined;
  username?: string | null | undefined;
  title?: string | null | undefined;
  friendlyName?: string | null | undefined;
  email: string;
  thumb?: string | null | undefined;
  status: string;
}

export type PlexConnectionStatus = "healthy" | "unauthorized" | "unreachable" | "server_changed";

export interface PlexServerInfo {
  friendlyName: string;
  machineIdentifier: string;
  version: string;
}

export class PlexAuthError extends Error {
  override readonly name = "PlexAuthError" as const;
}

export class PlexConnectionError extends Error {
  override readonly name = "PlexConnectionError" as const;
}
