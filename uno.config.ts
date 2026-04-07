import { presetWind4 } from "@unocss/preset-wind4";
import { createRemToPxProcessor } from "@unocss/preset-wind4/utils";
import { defineConfig, presetIcons, presetTypography } from "unocss";
import presetAnimations from "unocss-preset-animations";
import presetShadcn from "unocss-preset-shadcn";

export default defineConfig({
  presets: [
    presetWind4(),
    presetTypography(),
    presetIcons({
      scale: 1,
    }),
    presetShadcn({
      darkSelector: ".dark",
    }),
    presetAnimations(),
  ],

  postprocess: createRemToPxProcessor(),

  theme: {
    radius: {
      sm: "0.375rem",
      md: "0.5rem",
      lg: "0.75rem",
    },
    fontFamily: {
      sans: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
  },

  shortcuts: [
    ["page-shell", "min-h-screen bg-background text-foreground"],
    ["card", "rounded-[var(--radius)] border border-border bg-card text-card-foreground shadow-sm"],
  ],

  rules: [
    [
      /^hstack-(\d+)$/,
      ([, n]) => ({
        display: "flex",
        "align-items": "center",
        gap: `${Number(n) * 0.25}rem`,
      }),
    ],
  ],

  content: {
    pipeline: {
      include: [/\.svelte$/, /\.svelte\.ts$/, /\.svelte\.js$/, /\.ts$/, /\.js$/],
    },
  },
});
