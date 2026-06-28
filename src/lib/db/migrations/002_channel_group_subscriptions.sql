-- Channel-group subscriptions (Feature: Channel-Group Subscriptions)
--
-- Adds per-user controls and the global mapping from a Dispatcharr channel
-- group to the otpravkarr-owned Channel Profile that scopes it (Model A).
--
-- This migration runs exactly once (tracked in _migrations), so plain
-- ALTER TABLE ADD COLUMN is safe; SQLite does not support IF NOT EXISTS on
-- columns. New tables use IF NOT EXISTS per project convention.

-- Admin override of the user's ability to self-select groups. 0 = user may
-- self-select (default); 1 = locked, admin assigns groups.
ALTER TABLE user_mappings ADD COLUMN group_selection_locked INTEGER NOT NULL DEFAULT 0;

-- Marks a mapping as the Plex-server owner's self-subscription. The owner is
-- excluded from friend-sync / disable / orphan reaping regardless of this flag
-- (see plex-owner.ts); this flag drives admin UI affordances only.
ALTER TABLE user_mappings ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;

-- Global mapping: Dispatcharr channel group id -> the otpravkarr-owned Channel
-- Profile that contains exactly that group's channels (Model A). The sentinel
-- group_id -1 stores the shared "empty" profile (zero enabled channels) used to
-- safely represent a zero-group subscription without leaving channel_profiles
-- empty (an empty array exposes the ENTIRE catalog — see brief 3.5).
CREATE TABLE IF NOT EXISTS channel_group_profiles (
  group_id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
