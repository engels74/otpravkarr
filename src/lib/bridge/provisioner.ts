import { decrypt, encrypt } from "$lib/crypto/encryption";
import { generateXcPassword } from "$lib/crypto/passwords";
import { appendAuditLog } from "$lib/db/repositories/audit";
import {
  createUserMapping,
  getAllUserMappings,
  getUserMappingByPlexId,
  updateUserMapping,
} from "$lib/db/repositories/users";
import type { UserMapping } from "$lib/db/types";
import { AuditAction } from "$lib/db/types";
import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { createUser, getUser, updateUser } from "$lib/dispatcharr/endpoints/users";
import { fetchAllPages } from "$lib/dispatcharr/pagination";
import { DispatcharrUserSchema } from "$lib/dispatcharr/schemas";
import { isTransientResultError, retryResult } from "$lib/utils/retry";
import type { ProvisioningRequest, ProvisioningResult } from "./types";

const CREDENTIAL_PURPOSE = "credential-encryption";

/**
 * Sanitize a Plex username for use as a Dispatcharr username.
 * Strips non-alphanumeric characters, lowercases, and deduplicates against existing usernames.
 */
export function sanitizeUsername(plexUsername: string, existingUsernames: string[]): string {
  let base = plexUsername.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (base === "") {
    base = "plexuser";
  }

  const loweredUsernames = existingUsernames.map((u) => u.toLowerCase());

  if (!loweredUsernames.includes(base)) {
    return base;
  }

  let suffix = 2;
  while (loweredUsernames.includes(`${base}_${suffix}`)) {
    suffix++;
  }
  return `${base}_${suffix}`;
}

/**
 * Provision a Plex user into Dispatcharr.
 *
 * Handles three cases:
 * - User already exists and is active → returns already_exists
 * - User exists but is inactive → reactivates on Dispatcharr and locally
 * - New user → creates on Dispatcharr, stores mapping locally
 */
export async function provisionUser(
  client: DispatcharrClient,
  request: ProvisioningRequest,
): Promise<ProvisioningResult> {
  let existingMapping: UserMapping | null;
  try {
    existingMapping = getUserMappingByPlexId(request.plexIdentity.id);
  } catch (err) {
    return {
      status: "failed",
      error: `Database lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Already active — nothing to do
  if (existingMapping && existingMapping.is_active === 1) {
    return { status: "already_exists", mapping: existingMapping };
  }

  // Inactive mapping — reactivation flow
  if (
    existingMapping &&
    existingMapping.is_active === 0 &&
    existingMapping.dispatcharr_user_id != null
  ) {
    const dispatcharrUserId = existingMapping.dispatcharr_user_id;

    // Verify the Dispatcharr user still exists (disable deletes the remote user)
    const result = await retryResult(
      () => getUser(client, dispatcharrUserId),
      isTransientResultError,
    );

    if (!result.ok) {
      if (result.error === "not_found") {
        // Dispatcharr user was deleted — clear stale ID and fall through to create flow
        try {
          updateUserMapping(existingMapping.id, {
            dispatcharr_user_id: null,
            dispatcharr_username: null,
            dispatcharr_xc_password_enc: null,
          });
        } catch (err) {
          return {
            status: "failed",
            error: `Failed to clean up stale mapping after Dispatcharr user not found: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      } else {
        return { status: "failed", error: result.message };
      }
    } else {
      try {
        // Re-assert custom_properties.xc_password on the remote. Pre-`ddfbff5`
        // mappings were created without this field, so Xtream endpoints return
        // 401 after reactivation. Push the locally-stored password (no churn —
        // bookmarked M3U/EPG URLs keep working; intentional rotation lives in
        // rotateCredentials). Only `automatic` mappings have a stored password;
        // `self_managed`/`staff` have no local state to re-sync.
        if (
          existingMapping.provisioning_mode === "automatic" &&
          existingMapping.dispatcharr_xc_password_enc != null
        ) {
          let xcPassword: string;
          try {
            xcPassword = await decrypt(
              existingMapping.dispatcharr_xc_password_enc,
              CREDENTIAL_PURPOSE,
            );
          } catch (err) {
            return {
              status: "failed",
              error: `Failed to decrypt stored xc_password during reactivation: ${err instanceof Error ? err.message : String(err)}`,
            };
          }

          // Merge xc_password into the existing custom_properties object rather
          // than replacing it wholesale. Django DRF's default PATCH semantics
          // for a JSONField replace the entire value, so sending only
          // { xc_password } would drop any other keys Dispatcharr stores there
          // (e.g. device fingerprints, UI preferences). We already have the
          // remote user from `result.data` — no second round-trip needed.
          const existingCustomProps =
            result.data.custom_properties != null &&
            typeof result.data.custom_properties === "object" &&
            !Array.isArray(result.data.custom_properties)
              ? (result.data.custom_properties as Record<string, unknown>)
              : {};
          const patchResult = await retryResult(
            () =>
              updateUser(client, dispatcharrUserId, {
                custom_properties: { ...existingCustomProps, xc_password: xcPassword },
              }),
            isTransientResultError,
          );
          if (!patchResult.ok) {
            return { status: "failed", error: patchResult.message };
          }
        }

        updateUserMapping(existingMapping.id, { is_active: 1 });

        appendAuditLog({
          action: AuditAction.USER_PROVISIONED,
          detail: {
            plex_username: request.plexIdentity.username,
            reactivated: true,
          },
        });

        const updatedMapping = getUserMappingByPlexId(request.plexIdentity.id);
        if (!updatedMapping) {
          return { status: "failed", error: "Failed to retrieve reactivated mapping" };
        }
        return { status: "reactivated", mapping: updatedMapping };
      } catch (err) {
        return {
          status: "failed",
          error: `Dispatcharr user reactivated but local mapping write failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  // New user — create flow
  let allMappings: UserMapping[];
  try {
    allMappings = getAllUserMappings();
  } catch (err) {
    return {
      status: "failed",
      error: `Database lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const localUsernames = allMappings
    .map((m: UserMapping) => m.dispatcharr_username)
    .filter((u): u is string => u != null);

  // Also include remote Dispatcharr usernames to avoid 400 "username already exists" collisions
  let remoteUsernames: string[] = [];
  try {
    const remoteResult = await fetchAllPages(client, "/api/accounts/users/", DispatcharrUserSchema);
    if (remoteResult.ok) {
      remoteUsernames = remoteResult.data.map((u) => u.username);
    } else {
      console.warn(
        `[provisioner] Failed to fetch remote usernames for dedup, falling back to local-only: ${remoteResult.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `[provisioner] Failed to fetch remote usernames for dedup, falling back to local-only: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const existingUsernames = [...new Set([...localUsernames, ...remoteUsernames])];
  const sanitizedUsername = sanitizeUsername(request.plexIdentity.username, existingUsernames);

  const password = generateXcPassword();

  // Encrypt before creating remote user — if encrypt fails, no orphaned Dispatcharr account
  let encryptedPassword: string | null = null;
  if (request.mode === "automatic") {
    try {
      encryptedPassword = await encrypt(password, CREDENTIAL_PURPOSE);
    } catch (err) {
      return {
        status: "failed",
        error: `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const createResult = await retryResult(
    () =>
      createUser(client, {
        username: sanitizedUsername,
        password,
        custom_properties: { xc_password: password },
        ...(request.mode === "staff" && { is_staff: true }),
      }),
    isTransientResultError,
  );

  if (!createResult.ok) {
    return { status: "failed", error: createResult.message };
  }

  const dispatcharrUser = createResult.data;

  let finalMapping: UserMapping;

  try {
    if (existingMapping) {
      // Existing mapping present (inactive with null dispatcharr_user_id, or stale fields cleared).
      // Update instead of insert to avoid UNIQUE constraint violation on plex_account_id.
      updateUserMapping(existingMapping.id, {
        plex_uuid: request.plexIdentity.uuid,
        plex_username: request.plexIdentity.username,
        plex_email: request.plexIdentity.email,
        plex_thumb: request.plexIdentity.thumb,
        dispatcharr_user_id: dispatcharrUser.id,
        dispatcharr_username: dispatcharrUser.username ?? sanitizedUsername,
        dispatcharr_xc_password_enc: encryptedPassword,
        dispatcharr_group_ids: JSON.stringify(request.groupIds),
        ...(request.profileId !== undefined && { dispatcharr_profile_id: request.profileId }),
        provisioning_mode: request.mode,
        is_active: 1,
      });

      const updated = getUserMappingByPlexId(request.plexIdentity.id);
      if (!updated) {
        return { status: "failed", error: "Failed to retrieve updated mapping" };
      }
      finalMapping = updated;
    } else {
      finalMapping = createUserMapping({
        plex_account_id: request.plexIdentity.id,
        plex_uuid: request.plexIdentity.uuid,
        plex_username: request.plexIdentity.username,
        plex_email: request.plexIdentity.email,
        plex_thumb: request.plexIdentity.thumb,
        dispatcharr_user_id: dispatcharrUser.id,
        dispatcharr_username: dispatcharrUser.username ?? sanitizedUsername,
        dispatcharr_xc_password_enc: encryptedPassword,
        dispatcharr_group_ids: JSON.stringify(request.groupIds),
        dispatcharr_profile_id: request.profileId ?? null,
        provisioning_mode: request.mode,
        is_active: 1,
        last_synced_at: null,
        last_accessed_at: null,
      });
    }

    appendAuditLog({
      action: AuditAction.USER_PROVISIONED,
      detail: {
        plex_username: request.plexIdentity.username,
        dispatcharr_username: dispatcharrUser.username ?? sanitizedUsername,
        mode: request.mode,
      },
    });
  } catch (err) {
    return {
      status: "failed",
      error: `Dispatcharr user created but local mapping write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Automatic mode persists the encrypted password and rotates on demand, so the
  // initial value is never surfaced. Self_managed/staff modes don't store the
  // password locally, so we return it once for the admin to communicate.
  if (request.mode !== "automatic") {
    return { status: "provisioned", mapping: finalMapping, initialPassword: password };
  }

  return { status: "provisioned", mapping: finalMapping };
}
