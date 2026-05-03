import type { Config } from "@sveltejs/kit";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "svelte-adapter-bun";

const isDev = process.env.NODE_ENV !== "production";

const config: Config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      out: "build",
      serveAssets: true,
      precompress: true,
      envPrefix: "",
    }),
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        // All inline `style="..."` attributes were refactored out of the codebase;
        // dynamic widths and CSS custom properties live in component <style> blocks
        // (which SvelteKit auto-nonces) or in data-attribute-driven CSS rules.
        "style-src": ["self"],
        "style-src-elem": ["self"],
        "img-src": ["self", "data:", "https://plex.tv", "https://*.plex.direct"],
        "connect-src": ["self", "https://plex.tv", "https://*.plex.direct"],
        "font-src": ["self"],
        "worker-src": isDev ? ["self", "blob:"] : ["self"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"],
        "frame-ancestors": ["none"],
      },
    },
  },
};

export default config;
