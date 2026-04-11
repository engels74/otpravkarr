import { redirect } from "@sveltejs/kit";
import { getConfig } from "$lib/db/repositories/config";
import { getAccount } from "$lib/plex/client";
import { PlexAuthError, PlexConnectionError } from "$lib/plex/types";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, "/");
  }

  if (locals.user.is_active === 0) {
    throw redirect(303, "/");
  }

  const plexAdminToken = await getConfig("plex_admin_token");
  if (!plexAdminToken) {
    throw redirect(303, "/");
  }

  let account: Awaited<ReturnType<typeof getAccount>>;
  try {
    account = await getAccount(plexAdminToken);
  } catch (error: unknown) {
    if (error instanceof PlexAuthError || error instanceof PlexConnectionError) {
      throw redirect(303, "/");
    }
    throw error;
  }

  if (account.id !== locals.user.plex_account_id) {
    throw redirect(303, "/");
  }

  return {
    plexUsername: locals.user.plex_username,
  };
};
