import type { Handle } from "@sveltejs/kit";
import { initializeDatabase } from "$lib/db/connection";
import { validateEnv } from "$lib/server/env";

// Validate required environment variables on server startup
validateEnv();

// Initialize database and run pending migrations
await initializeDatabase();

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
