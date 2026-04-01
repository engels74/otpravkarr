CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plex_account_id INTEGER NOT NULL UNIQUE,
  plex_uuid TEXT NOT NULL,
  plex_username TEXT NOT NULL,
  plex_email TEXT,
  plex_thumb TEXT,
  dispatcharr_user_id INTEGER,
  dispatcharr_username TEXT,
  dispatcharr_xc_password_enc TEXT,
  dispatcharr_group_ids TEXT NOT NULL DEFAULT '[]',
  dispatcharr_profile_id INTEGER,
  provisioning_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (provisioning_mode IN ('automatic', 'self_managed', 'staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT,
  last_accessed_at TEXT
);

CREATE INDEX idx_user_mappings_plex_id ON user_mappings(plex_account_id);
CREATE INDEX idx_user_mappings_dispatcharr_id ON user_mappings(dispatcharr_user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_ref TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('admin', 'user')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE admin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip_address TEXT
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_action ON audit_log(action);
