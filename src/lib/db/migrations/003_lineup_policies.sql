-- Explicit least-privilege lineup policy state.
--
-- This migration runs exactly once (tracked in _migrations), so plain ALTER
-- TABLE ADD COLUMN is safe; SQLite does not support IF NOT EXISTS on columns.
-- New tables use IF NOT EXISTS per project convention.

-- `dispatcharr_group_ids` remains the materialized effective access set. These
-- columns retain policy intent independently so temporarily missing, disabled,
-- unapproved, or quarantined groups can be restored without widening access.
ALTER TABLE user_mappings ADD COLUMN lineup_policy_override TEXT
  CHECK (lineup_policy_override IN ('fixed', 'core_bundles', 'approved_selection'));
ALTER TABLE user_mappings ADD COLUMN selected_bundle_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_mappings ADD COLUMN selected_approved_group_ids TEXT NOT NULL DEFAULT '[]';

-- Existing materialized access is the only safe intent available during
-- migration. Copy it verbatim: it can only preserve or narrow existing access.
UPDATE user_mappings
SET selected_approved_group_ids = dispatcharr_group_ids;

-- Stable bundle identities are never derived from their display names. `id`
-- and `slug` are durable references; display_name, enabled, and group_ids are
-- the mutable catalog data. group_ids is an ordered JSON array of group IDs.
CREATE TABLE IF NOT EXISTS lineup_bundles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  group_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS lineup_bundles_prevent_identity_change
BEFORE UPDATE OF id, slug ON lineup_bundles
WHEN NEW.id <> OLD.id OR NEW.slug <> OLD.slug
BEGIN
  SELECT RAISE(ABORT, 'lineup bundle id and slug are immutable');
END;

-- Instance policy defaults. `default_selectable_groups` predates this migration
-- and is now interpreted as the approved set; it is deliberately not seeded so
-- an unset value fails closed rather than exposing all live groups.
INSERT OR IGNORE INTO config (key, value) VALUES ('lineup_policy_default', 'core_bundles');
INSERT OR IGNORE INTO config (key, value) VALUES ('lineup_fixed_group_ids', '[]');
INSERT OR IGNORE INTO config (key, value) VALUES ('lineup_core_group_ids', '[]');
INSERT OR IGNORE INTO config (key, value) VALUES ('lineup_bundle_catalog_version', '1');
