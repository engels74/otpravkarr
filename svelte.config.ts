import type { Config } from "@sveltejs/kit";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "svelte-adapter-bun";

const config: Config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      out: "build",
      serveAssets: true,
      precompress: true,
      envPrefix: "",
    }),
  },
};

export default config;
