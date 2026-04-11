import { redirect } from "@sveltejs/kit";
import { getConfig } from "$lib/db/repositories/config";
import { getAccount } from "$lib/plex/client";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, "/");
  }

  const plexAdminToken = await getConfig("plex_admin_token");
  if (!plexAdminToken) {
    throw redirect(303, "/");
  }

  const account = await getAccount(plexAdminToken);
  if (account.id !== locals.user.plex_account_id) {
    throw redirect(303, "/");
  }

  return {
    plexUsername: locals.user.plex_username,
  };
};
