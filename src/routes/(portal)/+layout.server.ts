import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) {
    return { user: null };
  }

  return {
    user: {
      plexUsername: locals.user.plex_username,
      plexThumb: locals.user.plex_thumb,
      provisioningMode: locals.user.provisioning_mode,
    },
  };
};
