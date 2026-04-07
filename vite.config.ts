import { sveltekit } from "@sveltejs/kit/vite";
import UnoCSS from "@unocss/vite";
import { defineConfig } from "vite";

const DEFAULT_DEV_PORT = 3000;

export function resolveDevPort(rawPort: string | undefined): number {
  const trimmed = rawPort?.trim();
  if (!trimmed) {
    return DEFAULT_DEV_PORT;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_DEV_PORT;
  }

  return parsed;
}

export default defineConfig({
  plugins: [sveltekit(), UnoCSS()],
  server: {
    port: resolveDevPort(process.env.PORT),
    strictPort: true,
  },
});
