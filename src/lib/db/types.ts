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

export const AuditAction = {
  SETUP_COMPLETED: "setup.completed",
  ADMIN_LOGIN: "admin.login",
  USER_PROVISIONED: "user.provisioned",
  USER_DISABLED: "user.disabled",
  USER_CREDENTIALS_ROTATED: "user.credentials_rotated",
  SYNC_COMPLETED: "sync.completed",
  SYNC_FAILED: "sync.failed",
  CONFIG_CHANGED: "config.changed",
  HEALTH_CHECK_FAILED: "health.check_failed",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];
