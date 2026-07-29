-- Preserve Event Channel Managarr visibility decisions across Otpravkarr
-- subscription reconciliation. This snapshot records the last observed channel
-- set for each owned group profile; it is not the enabled-membership set.
ALTER TABLE channel_group_profiles
  ADD COLUMN known_channel_ids TEXT NOT NULL DEFAULT '[]';
