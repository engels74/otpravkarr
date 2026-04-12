<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  size?: "sm" | "default";
  class?: string;
}

let { size = "default", class: className }: Props = $props();
</script>

<div class={cn("flex items-center gap-2", className)}>
  <span
    class={cn(
      "inline-flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary",
      size === "sm" ? "h-6 w-6" : "h-7 w-7",
    )}
    aria-hidden="true"
  >
    <svg
      class={cn(size === "sm" ? "h-4 w-4" : "h-5 w-5")}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- Broadcast iris: two offset arcs forming an "O" with a stylised aperture -->
      <path
        d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M12 20.5a8.5 8.5 0 0 1-8.5-8.5"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" />
    </svg>
  </span>
  <span class={cn("font-semibold tracking-tight", size === "sm" ? "text-xs" : "text-sm")}>
    otpravkarr
  </span>
</div>
