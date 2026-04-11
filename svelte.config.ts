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
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "https://plex.tv", "https://*.plex.direct"],
        "connect-src": ["self", "https://plex.tv"],
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
