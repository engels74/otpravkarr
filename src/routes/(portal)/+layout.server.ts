import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  // Revoked users still get portal chrome and an "Inactive" badge, so fall
  // back to the inactive mapping when locals.user is absent.
  const mapping = locals.user ?? locals.revokedUser;
  if (!mapping) {
    return { user: null };
  }

  return {
    user: {
      plexUsername: mapping.plex_username,
      plexThumb: mapping.plex_thumb,
      provisioningMode: mapping.provisioning_mode,
      isActive: mapping.is_active === 1,
    },
  };
};
