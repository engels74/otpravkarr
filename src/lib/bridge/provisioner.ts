import { encrypt } from "$lib/crypto/encryption";
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
import { createUser, updateUser } from "$lib/dispatcharr/endpoints/users";
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

  if (!existingUsernames.includes(base)) {
    return base;
  }

  let suffix = 2;
  while (existingUsernames.includes(`${base}_${suffix}`)) {
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
  const existingMapping = getUserMappingByPlexId(request.plexIdentity.id);

  // Already active — nothing to do
  if (existingMapping && existingMapping.is_active === 1) {
    return { status: "already_exists", mapping: existingMapping };
  }

  // Inactive mapping — reactivation flow
  if (existingMapping && existingMapping.is_active === 0) {
    if (existingMapping.dispatcharr_user_id == null) {
      return { status: "failed", error: "Cannot reactivate: no Dispatcharr user ID" };
    }
    const dispatcharrUserId = existingMapping.dispatcharr_user_id;

    const result = await retryResult(
      () => updateUser(client, dispatcharrUserId, { is_active: true }),
      isTransientResultError,
    );

    if (!result.ok) {
      return { status: "failed", error: result.message };
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
  }

  // New user — create flow
  const allMappings = getAllUserMappings();
  const existingUsernames = allMappings
    .map((m: UserMapping) => m.dispatcharr_username)
    .filter((u): u is string => u != null);
  const sanitizedUsername = sanitizeUsername(request.plexIdentity.username, existingUsernames);

  const password = generateXcPassword();

  const createResult = await retryResult(
    () =>
      createUser(client, {
        username: sanitizedUsername,
        password,
        is_staff: request.mode === "staff",
        is_active: true,
        groups: request.groupIds,
      }),
    isTransientResultError,
  );

  if (!createResult.ok) {
    return { status: "failed", error: createResult.message };
  }

  const dispatcharrUser = createResult.data;

  const encryptedPassword =
    request.mode === "automatic" ? await encrypt(password, CREDENTIAL_PURPOSE) : null;

  const newMapping = createUserMapping({
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

  appendAuditLog({
    action: AuditAction.USER_PROVISIONED,
    detail: {
      plex_username: request.plexIdentity.username,
      dispatcharr_username: dispatcharrUser.username ?? sanitizedUsername,
      mode: request.mode,
    },
  });

  return { status: "provisioned", mapping: newMapping };
}
