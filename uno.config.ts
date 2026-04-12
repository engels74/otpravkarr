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
      sm: "0.5rem",
      md: "0.625rem",
      lg: "0.75rem",
    },
    fontFamily: {
      sans: '"Geist", "Geist Mono", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      display: '"Instrument Serif", ui-serif, Georgia, serif',
    },
  },

  shortcuts: [
    ["page-shell", "min-h-screen bg-background text-foreground"],
    ["card", "rounded-[var(--radius)] border border-border bg-card text-card-foreground shadow-sm"],
    ["surface", "rounded-lg border border-border bg-card text-card-foreground shadow-sm"],
    [
      "surface-elevated",
      "rounded-lg border border-border bg-card text-card-foreground shadow-md ring-1 ring-inset ring-white/5",
    ],
    ["glass-header", "sticky top-0 z-30 backdrop-blur-md bg-background/70 border-b border-border"],
    ["kpi-tile", "surface p-5 flex flex-col gap-2"],
    ["eyebrow", "text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground font-medium"],
    ["display-hero", "font-display text-4xl md:text-5xl font-normal tracking-tight leading-[1.05]"],
    [
      "hero-glow-bg",
      "bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,hsl(var(--primary)/0.18),transparent_70%)]",
    ],
    [
      "cta-glow",
      "shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.55)] hover:shadow-[0_12px_32px_-10px_hsl(var(--primary)/0.7)] transition-shadow",
    ],
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
