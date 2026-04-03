import type { RequestEvent } from "@sveltejs/kit";
import { requireAdmin } from "$lib/server/auth";

export const load = async (event: RequestEvent) => {
  const admin = await requireAdmin(event);

  return {
    username: admin.username,
  };
};
