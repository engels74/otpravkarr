import type { ProvisioningMode, UserMapping } from "$lib/db/types";
import type { PlexIdentity } from "$lib/plex/types";

export type { ProvisioningMode } from "$lib/db/types";

export interface ProvisioningRequest {
  plexIdentity: PlexIdentity;
  mode: ProvisioningMode;
  groupIds: number[];
  profileId?: number | undefined;
  exposeInitialPassword?: boolean | undefined;
  /** Marks this provision as the Plex owner's own (non-admin) self-subscription. */
  isOwner?: boolean | undefined;
}

export type ProvisioningResult =
  | { status: "provisioned"; mapping: UserMapping; initialPassword?: string }
  | { status: "already_exists"; mapping: UserMapping }
  | { status: "reactivated"; mapping: UserMapping }
  | { status: "failed"; error: string };

export interface SyncReport {
  unmappedFriends: number;
  disabled: number;
  orphaned: number;
  refreshed: number;
  errors: string[];
}

export class UserMappingNotFoundError extends Error {
  override readonly name = "UserMappingNotFoundError" as const;
}
