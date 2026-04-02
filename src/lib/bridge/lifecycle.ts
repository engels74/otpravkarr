import { encrypt } from "$lib/crypto/encryption";
import { generateXcPassword } from "$lib/crypto/passwords";
import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  getAllUserMappings,
  markMappingInactive,
  updateLastSynced,
  updatePlexIdentity,
  updateUserMapping,
} from "$lib/db/repositories/users";
import type { UserMapping } from "$lib/db/types";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { getUser, updateUser } from "$lib/dispatcharr/endpoints/users";
import { getAccount } from "$lib/plex/client";
import { fetchFriends } from "$lib/plex/friends";
import type { PlexFriend } from "$lib/plex/types";
import {
  isTransientPlexError,
  isTransientResultError,
  retryAsync,
  retryResult,
} from "$lib/utils/retry";
import type { SyncReport } from "./types";

const CREDENTIAL_PURPOSE = "credential-encryption";

/**
 * Rotate the XC credentials for a mapped user.
 * Generates a new password, pushes it to Dispatcharr, and stores the encrypted value locally.
 */
export async function rotateCredentials(
  client: DispatcharrClient,
  mapping: UserMapping,
): Promise<void> {
  if (mapping.dispatcharr_user_id == null) {
    throw new Error("Cannot rotate credentials: no Dispatcharr user ID");
  }
  if (mapping.provisioning_mode !== "automatic") {
    throw new Error(
      `Cannot rotate credentials for non-automatic user (mode: ${mapping.provisioning_mode})`,
    );
  }
  const dispatcharrUserId = mapping.dispatcharr_user_id;

  const newPassword = generateXcPassword();

  // Encrypt before pushing to Dispatcharr — if encrypt fails, remote state is unchanged
  const encryptedPassword = await encrypt(newPassword, CREDENTIAL_PURPOSE);

  const result = await retryResult(
    () => updateUser(client, dispatcharrUserId, { password: newPassword }),
    isTransientResultError,
  );
  if (!result.ok) {
    if (result.error === "not_found") {
      // Dispatcharr user was deleted externally — clear stale fields before throwing
      try {
        updateUserMapping(mapping.id, {
          is_active: 0,
          dispatcharr_user_id: null,
          dispatcharr_username: null,
          dispatcharr_xc_password_enc: null,
        });
      } catch (dbErr) {
        throw new Error(
          `Cannot rotate credentials: Dispatcharr user no longer exists and cleanup failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      throw new Error(
        "Cannot rotate credentials: Dispatcharr user no longer exists (cleaned up stale mapping)",
      );
    }
    throw new Error(`Failed to rotate credentials on Dispatcharr: ${result.message}`);
  }

  try {
    updateUserMapping(mapping.id, { dispatcharr_xc_password_enc: encryptedPassword });

    appendAuditLog({
      action: AuditAction.USER_CREDENTIALS_ROTATED,
      detail: {
        mapping_id: mapping.id,
        dispatcharr_username: mapping.dispatcharr_username,
      },
    });
  } catch (err) {
    throw new Error(
      `Dispatcharr password rotated but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Disable a user on Dispatcharr and mark the local mapping as inactive.
 */
export async function disableUser(client: DispatcharrClient, mapping: UserMapping): Promise<void> {
  if (mapping.dispatcharr_user_id == null) {
    throw new Error("Cannot disable user: no Dispatcharr user ID");
  }
  const dispatcharrUserId = mapping.dispatcharr_user_id;

  const result = await retryResult(
    () => updateUser(client, dispatcharrUserId, { is_active: false }),
    isTransientResultError,
  );
  if (!result.ok) {
    if (result.error === "not_found") {
      // Dispatcharr user was deleted externally — clear stale fields and mark inactive
      try {
        updateUserMapping(mapping.id, {
          is_active: 0,
          dispatcharr_user_id: null,
          dispatcharr_username: null,
          dispatcharr_xc_password_enc: null,
        });
      } catch (dbErr) {
        throw new Error(
          `Dispatcharr user not found and cleanup failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return;
    }
    throw new Error(`Failed to disable user on Dispatcharr: ${result.message}`);
  }

  try {
    markMappingInactive(mapping.id);

    if (mapping.is_active === 1) {
      appendAuditLog({
        action: AuditAction.USER_DISABLED,
        detail: {
          mapping_id: mapping.id,
          dispatcharr_username: mapping.dispatcharr_username,
        },
      });
    }
  } catch (err) {
    throw new Error(
      `Dispatcharr user disabled but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Enable a user on Dispatcharr and mark the local mapping as active.
 */
export async function enableUser(client: DispatcharrClient, mapping: UserMapping): Promise<void> {
  if (mapping.dispatcharr_user_id == null) {
    throw new Error("Cannot enable user: no Dispatcharr user ID");
  }
  const dispatcharrUserId = mapping.dispatcharr_user_id;

  const result = await retryResult(
    () => updateUser(client, dispatcharrUserId, { is_active: true }),
    isTransientResultError,
  );
  if (!result.ok) {
    if (result.error === "not_found") {
      // Dispatcharr user was deleted externally — clear stale fields
      try {
        updateUserMapping(mapping.id, {
          is_active: 0,
          dispatcharr_user_id: null,
          dispatcharr_username: null,
          dispatcharr_xc_password_enc: null,
        });
      } catch (dbErr) {
        throw new Error(
          `Dispatcharr user not found and cleanup failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return;
    }
    throw new Error(`Failed to enable user on Dispatcharr: ${result.message}`);
  }

  try {
    updateUserMapping(mapping.id, { is_active: 1 });
  } catch (err) {
    throw new Error(
      `Dispatcharr user enabled but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Reconcile local user mappings against live Plex friends and Dispatcharr state.
 *
 * - Disables mappings for users no longer in the Plex friends list
 * - Refreshes Plex identity fields when they've changed
 * - Detects orphaned Dispatcharr users (deleted externally)
 * - Reconciles group/active-status drift from Dispatcharr
 * - Counts new Plex friends not yet mapped
 */
export async function reconcileSync(
  client: DispatcharrClient,
  plexAdminToken: string,
): Promise<SyncReport> {
  const report: SyncReport = {
    newFriends: 0,
    disabled: 0,
    orphaned: 0,
    refreshed: 0,
    errors: [],
  };

  let friends: PlexFriend[];
  try {
    const account = await retryAsync(() => getAccount(plexAdminToken), isTransientPlexError);
    friends = await retryAsync(() => fetchFriends(account), isTransientPlexError);
  } catch (error) {
    report.errors.push(
      `Failed to fetch Plex friends: ${error instanceof Error ? error.message : String(error)}`,
    );
    appendAuditLog({ action: AuditAction.SYNC_COMPLETED, detail: { ...report } });
    return report;
  }

  const allMappings = getAllUserMappings();
  // Only treat accepted friends as active — pending invites should not grant access
  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const friendIds = new Set(acceptedFriends.map((f) => f.id));
  const friendMap = new Map(acceptedFriends.map((f) => [f.id, f]));

  for (const mapping of allMappings) {
    if (!friendIds.has(mapping.plex_account_id)) {
      // User removed from Plex friends — ensure disabled
      if (mapping.dispatcharr_user_id != null) {
        // Always disable on Dispatcharr regardless of local is_active,
        // in case the Dispatcharr user drifted back to active externally.
        // Only increment report.disabled on actual state transitions to stay idempotent.
        const wasActive = mapping.is_active === 1;
        try {
          await disableUser(client, mapping);
          if (wasActive) {
            report.disabled++;
          }
        } catch (err) {
          report.errors.push(
            `Failed to disable user ${mapping.plex_username}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (mapping.is_active === 1) {
        // No Dispatcharr user — deactivate locally and clear stale credentials
        updateUserMapping(mapping.id, {
          is_active: 0,
          dispatcharr_username: null,
          dispatcharr_xc_password_enc: null,
        });
        report.disabled++;
        appendAuditLog({
          action: AuditAction.USER_DISABLED,
          detail: {
            mapping_id: mapping.id,
            dispatcharr_username: mapping.dispatcharr_username,
            reason: "plex_friend_removed_no_dispatcharr_user",
          },
        });
      }
    } else {
      // Still on Plex — refresh identity if changed
      const friend = friendMap.get(mapping.plex_account_id);
      if (friend) {
        const newUsername =
          friend.username ?? friend.title ?? friend.friendlyName ?? mapping.plex_username;
        const newEmail = friend.email ?? null;
        const newThumb = friend.thumb ?? null;

        if (
          newUsername !== mapping.plex_username ||
          newEmail !== mapping.plex_email ||
          newThumb !== mapping.plex_thumb
        ) {
          updatePlexIdentity(mapping.id, newUsername, newEmail, newThumb);
          report.refreshed++;
        }
      }

      // Verify on Dispatcharr (only if provisioned)
      let verificationFailed = false;
      if (mapping.dispatcharr_user_id != null) {
        const dispatcharrUserId = mapping.dispatcharr_user_id;
        const userResult = await retryResult(
          () => getUser(client, dispatcharrUserId),
          isTransientResultError,
        );

        if (!userResult.ok) {
          if (userResult.error === "not_found") {
            // Orphaned — Dispatcharr user was deleted externally; clear stale Dispatcharr fields
            updateUserMapping(mapping.id, {
              is_active: 0,
              dispatcharr_user_id: null,
              dispatcharr_username: null,
              dispatcharr_xc_password_enc: null,
            });
            report.orphaned++;
          } else {
            report.errors.push(
              `Failed to verify Dispatcharr user ${mapping.dispatcharr_username}: ${userResult.message}`,
            );
            verificationFailed = true;
          }
        } else {
          // Reconcile drift — Dispatcharr is source of truth for groups and active status
          try {
            const dispatcharrUser = userResult.data;
            const localGroups = JSON.parse(mapping.dispatcharr_group_ids) as number[];
            const remoteGroups = dispatcharrUser.groups;
            const groupsDrift =
              JSON.stringify([...localGroups].sort()) !== JSON.stringify([...remoteGroups].sort());
            const activeDrift = (mapping.is_active === 1) !== dispatcharrUser.is_active;

            if (groupsDrift || activeDrift) {
              updateUserMapping(mapping.id, {
                dispatcharr_group_ids: JSON.stringify(remoteGroups),
                is_active: dispatcharrUser.is_active ? 1 : 0,
              });
            }
          } catch (err) {
            report.errors.push(
              `Failed to reconcile groups for user ${mapping.dispatcharr_username}: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
        }
      }

      if (!verificationFailed) {
        updateLastSynced(mapping.id);
      }
    }
  }

  // Count new accepted friends not yet mapped
  const mappedPlexIds = new Set(allMappings.map((m) => m.plex_account_id));
  for (const friend of acceptedFriends) {
    if (!mappedPlexIds.has(friend.id)) {
      report.newFriends++;
    }
  }

  appendAuditLog({ action: AuditAction.SYNC_COMPLETED, detail: { ...report } });

  return report;
}
