/**
 * Database types — mirrors the SQLite schema from 001_initial.sql.
 *
 * All date fields are SQLite datetime strings in 'YYYY-MM-DD HH:MM:SS' format (from datetime('now')).
 * Boolean fields are stored as INTEGER (0/1) in SQLite.
 */

export type ProvisioningMode = "automatic" | "self_managed" | "staff";

export interface UserMapping {
  id: number;
  plex_account_id: number;
  plex_uuid: string;
  plex_username: string;
  plex_email: string | null;
  plex_thumb: string | null;
  dispatcharr_user_id: number | null;
  dispatcharr_username: string | null;
  dispatcharr_xc_password_enc: string | null;
  dispatcharr_group_ids: string; // JSON array string, default '[]'
  dispatcharr_profile_id: number | null;
  provisioning_mode: ProvisioningMode;
  is_active: number; // 0 or 1
  // Admin override of the user's self-select ability. 0 = user may self-select,
  // 1 = locked (admin assigns groups). See migration 002.
  group_selection_locked: number; // 0 or 1
  // Marks the Plex-server owner's self-subscription mapping. See migration 002.
  is_owner: number; // 0 or 1
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  last_accessed_at: string | null;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  actor: string | null;
  action: string;
  detail: string | null; // JSON string
  ip_address: string | null;
}

export interface Session {
  id: string;
  user_ref: string;
  session_type: "admin" | "user";
  expires_at: string;
  created_at: string;
}

export interface AdminAccount {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
  encrypted: number; // 0 or 1
  updated_at: string;
}

export interface ChannelGroupProfile {
  // Dispatcharr channel group id. Sentinel -1 = the shared "empty" profile.
  group_id: number;
  // Dispatcharr channel profile id that scopes this group (Model A).
  profile_id: number;
  profile_name: string;
  created_at: string;
  updated_at: string;
}

export const AuditAction = {
  SETUP_COMPLETED: "setup.completed",
  SETUP_RECOVERY_LOGIN: "setup.recovery_login",
  ADMIN_LOGIN: "admin.login",
  USER_PROVISIONED: "user.provisioned",
  USER_MAPPING_DELETED: "user.mapping_deleted",
  USER_RE_ENABLED: "user.re_enabled",
  USER_DISABLED: "user.disabled",
  USER_CREDENTIALS_ROTATED: "user.credentials_rotated",
  USER_GROUP_CHANGED: "user.group_changed",
  USER_PROFILE_CHANGED: "user.profile_changed",
  USER_LOCK_CHANGED: "user.lock_changed",
  USER_OWNER_SUBSCRIBED: "user.owner_subscribed",
  SYNC_STARTED: "sync.started",
  SYNC_COMPLETED: "sync.completed",
  SYNC_FAILED: "sync.failed",
  CONFIG_CHANGED: "config.changed",
  ADMIN_LOGOUT: "admin.logout",
  HEALTH_CHECK_FAILED: "health.check_failed",
  ECM_SCOPE_UPDATED: "ecm.scope_updated",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];
