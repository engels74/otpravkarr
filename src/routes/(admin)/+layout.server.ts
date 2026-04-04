import { requireAdmin } from "$lib/server/auth";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async (event) => {
  const admin = await requireAdmin(event);

  return {
    username: admin.username,
  };
};
