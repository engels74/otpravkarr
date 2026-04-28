import { encrypt } from "$lib/crypto/encryption";
import { generateXcPassword } from "$lib/crypto/passwords";
import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  getAllUserMappings,
  getUserMappingById,
  getUserMappingsByDispatcharrId,
  updateLastSynced,
  updatePlexIdentity,
  updateUserMapping,
  updateXcPasswordForMapping,
} from "$lib/db/repositories/users";
import type { UserMapping } from "$lib/db/types";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { deleteUser, getUser, updateUser } from "$lib/dispatcharr/endpoints/users";
import { getAccount } from "$lib/plex/client";
import { fetchFriends } from "$lib/plex/friends";
import type { PlexFriend } from "$lib/plex/types";
import {
  isTransientPlexError,
  isTransientResultError,
  retryAsync,
  retryResult,
} from "$lib/utils/retry";
import { type SyncReport, UserMappingNotFoundError } from "./types";

const CREDENTIAL_PURPOSE = "credential-encryption";

export interface ActorContext {
  actor: string;
  ipAddress: string;
}

/**
 * Rotate the XC credentials for a mapped user.
 * Generates a new password, pushes it to Dispatcharr, and stores the encrypted value locally.
 */
export async function rotateCredentials(
  client: DispatcharrClient,
  mapping: UserMapping,
  actorContext?: ActorContext,
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
  const owners = getUserMappingsByDispatcharrId(dispatcharrUserId);
  if (owners.length !== 1 || owners[0]?.id !== mapping.id) {
    throw new Error(
      `Cannot rotate credentials: Dispatcharr user ID ${dispatcharrUserId} is not uniquely owned by mapping ${mapping.id}`,
    );
  }

  const newPassword = generateXcPassword();

  // Encrypt before pushing to Dispatcharr — if encrypt fails, remote state is unchanged
  const encryptedPassword = await encrypt(newPassword, CREDENTIAL_PURPOSE);

  const getResult = await retryResult(
    () => getUser(client, dispatcharrUserId),
    isTransientResultError,
  );
  if (!getResult.ok) {
    if (getResult.error === "not_found") {
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
    throw new Error(`Failed to rotate credentials on Dispatcharr: ${getResult.message}`);
  }

  const existingCustomProps =
    getResult.data.custom_properties != null &&
    typeof getResult.data.custom_properties === "object" &&
    !Array.isArray(getResult.data.custom_properties)
      ? (getResult.data.custom_properties as Record<string, unknown>)
      : {};

  const result = await retryResult(
    () =>
      updateUser(client, dispatcharrUserId, {
        password: newPassword,
        custom_properties: { ...existingCustomProps, xc_password: newPassword },
      }),
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
    const updated = updateXcPasswordForMapping(mapping.id, dispatcharrUserId, encryptedPassword);
    if (!updated) {
      throw new Error("guarded local credential update matched no rows");
    }

    appendAuditLog({
      actor: actorContext?.actor,
      ipAddress: actorContext?.ipAddress,
      action: AuditAction.USER_CREDENTIALS_ROTATED,
      detail: {
        mapping_id: mapping.id,
        dispatcharr_username: getResult.data.username,
      },
    });
  } catch (err) {
    throw new Error(
      `Dispatcharr password rotated but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Rotate credentials by mapping ID, reloading the row immediately before use.
 * Route handlers should prefer this over passing a potentially stale mapping.
 */
export async function rotateCredentialsForMappingId(
  client: DispatcharrClient,
  mappingId: number,
  actorContext?: ActorContext,
): Promise<void> {
  const mapping = getUserMappingById(mappingId);
  if (!mapping) {
    throw new UserMappingNotFoundError("Cannot rotate credentials: user mapping not found");
  }
  if (mapping.is_active !== 1) {
    throw new Error("Cannot rotate credentials: user is inactive");
  }
  await rotateCredentials(client, mapping, actorContext);
}

/**
 * Disable a user: delete on Dispatcharr and mark the local mapping inactive.
 *
 * The Dispatcharr API does not expose an `is_active` field on users, so disabling
 * means deleting the remote account. The local mapping retains the Plex identity so
 * the user can be re-provisioned later if needed.
 */
export async function disableUser(
  client: DispatcharrClient,
  mapping: UserMapping,
  actorContext?: ActorContext,
): Promise<void> {
  if (mapping.dispatcharr_user_id == null) {
    throw new Error("Cannot disable user: no Dispatcharr user ID");
  }
  const dispatcharrUserId = mapping.dispatcharr_user_id;

  const result = await retryResult(
    () => deleteUser(client, dispatcharrUserId),
    isTransientResultError,
  );
  if (!result.ok) {
    if (result.error === "not_found") {
      // Already gone — clear stale fields and mark inactive
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
    throw new Error(`Failed to delete user on Dispatcharr: ${result.message}`);
  }

  try {
    updateUserMapping(mapping.id, {
      is_active: 0,
      dispatcharr_user_id: null,
      dispatcharr_username: null,
      dispatcharr_xc_password_enc: null,
    });

    if (mapping.is_active === 1) {
      appendAuditLog({
        actor: actorContext?.actor,
        ipAddress: actorContext?.ipAddress,
        action: AuditAction.USER_DISABLED,
        detail: {
          mapping_id: mapping.id,
          dispatcharr_username: mapping.dispatcharr_username,
        },
      });
    }
  } catch (err) {
    throw new Error(
      `Dispatcharr user deleted but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Enable a user: verify they still exist on Dispatcharr and mark the local mapping as active.
 *
 * Since disabling deletes the Dispatcharr user, enabling an inactive mapping with a
 * null `dispatcharr_user_id` requires re-provisioning (handled by the provisioner).
 */
export async function enableUser(client: DispatcharrClient, mapping: UserMapping): Promise<void> {
  if (mapping.dispatcharr_user_id == null) {
    throw new Error("Cannot enable user: no Dispatcharr user ID (re-provisioning required)");
  }
  const dispatcharrUserId = mapping.dispatcharr_user_id;

  // Verify user still exists on Dispatcharr
  const result = await retryResult(
    () => getUser(client, dispatcharrUserId),
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
      throw new Error(
        "Cannot enable user: Dispatcharr user no longer exists (re-provisioning required)",
      );
    }
    throw new Error(`Failed to verify user on Dispatcharr: ${result.message}`);
  }

  try {
    updateUserMapping(mapping.id, { is_active: 1 });
  } catch (err) {
    throw new Error(
      `Dispatcharr user verified but local DB write failed (state may be inconsistent): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Reconcile local user mappings against live Plex friends and Dispatcharr state.
 *
 * - Disables mappings for users no longer in the Plex friends list
 * - Refreshes Plex identity fields when they've changed
 * - Detects orphaned Dispatcharr users (deleted externally)
 * - Reconciles Dispatcharr username drift and cleans up orphaned users
 * - Counts new Plex friends not yet mapped
 */
export async function reconcileSync(
  client: DispatcharrClient,
  plexAdminToken: string,
): Promise<SyncReport> {
  const report: SyncReport = {
    unmappedFriends: 0,
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
    try {
      appendAuditLog({ action: AuditAction.SYNC_COMPLETED, detail: { ...report } });
    } catch (auditErr) {
      report.errors.push(
        `Failed to write sync-completed audit log: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
      );
    }
    return report;
  }

  let allMappings: UserMapping[];
  try {
    allMappings = getAllUserMappings();
  } catch (error) {
    report.errors.push(
      `Failed to load user mappings: ${error instanceof Error ? error.message : String(error)}`,
    );
    try {
      appendAuditLog({ action: AuditAction.SYNC_COMPLETED, detail: { ...report } });
    } catch (auditErr) {
      report.errors.push(
        `Failed to write sync-completed audit log: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
      );
    }
    return report;
  }

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
        try {
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
        } catch (err) {
          report.errors.push(
            `Failed to deactivate local mapping for ${mapping.plex_username}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
          try {
            updatePlexIdentity(mapping.id, newUsername, newEmail, newThumb);
            report.refreshed++;
          } catch (err) {
            report.errors.push(
              `Failed to refresh Plex identity for ${mapping.plex_username}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
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
            try {
              updateUserMapping(mapping.id, {
                is_active: 0,
                dispatcharr_user_id: null,
                dispatcharr_username: null,
                dispatcharr_xc_password_enc: null,
              });
              report.orphaned++;
            } catch (err) {
              report.errors.push(
                `Failed to clean up orphaned mapping for ${mapping.plex_username}: ${err instanceof Error ? err.message : String(err)}`,
              );
              verificationFailed = true;
            }
          } else {
            report.errors.push(
              `Failed to verify Dispatcharr user ${mapping.dispatcharr_username}: ${userResult.message}`,
            );
            verificationFailed = true;
          }
        } else {
          // User exists on Dispatcharr — reconcile username drift if changed
          try {
            const dispatcharrUser = userResult.data;
            if (
              dispatcharrUser.username &&
              dispatcharrUser.username !== mapping.dispatcharr_username
            ) {
              updateUserMapping(mapping.id, {
                dispatcharr_username: dispatcharrUser.username,
              });
            }
          } catch (err) {
            report.errors.push(
              `Failed to reconcile username for user ${mapping.dispatcharr_username}: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
        }
      }

      if (!verificationFailed) {
        try {
          updateLastSynced(mapping.id);
        } catch (err) {
          report.errors.push(
            `Failed to update last-synced timestamp for ${mapping.plex_username}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  // Count new accepted friends not yet mapped
  const mappedPlexIds = new Set(allMappings.map((m) => m.plex_account_id));
  for (const friend of acceptedFriends) {
    if (!mappedPlexIds.has(friend.id)) {
      report.unmappedFriends++;
    }
  }

  try {
    appendAuditLog({ action: AuditAction.SYNC_COMPLETED, detail: { ...report } });
  } catch (err) {
    report.errors.push(
      `Failed to write sync-completed audit log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return report;
}
