import type { Handle } from "@sveltejs/kit";
import { validateEnv } from "$lib/server/env";

// Validate required environment variables on server startup
validateEnv();

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
