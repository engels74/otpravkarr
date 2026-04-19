<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  size?: "sm" | "default";
  class?: string;
}

let { size = "default", class: className }: Props = $props();

const iconSize = $derived(size === "sm" ? "h-6 w-6" : "h-7 w-7");
const labelSize = $derived(size === "sm" ? "text-xs" : "text-sm");
</script>

<div class={cn("flex items-center gap-2", className)}>
  <img
    src="/otpravkarr-icon.svg"
    alt=""
    aria-hidden="true"
    width="28"
    height="28"
    decoding="async"
    class={cn(
      "shrink-0 rounded-md ring-1 ring-border/60 shadow-sm",
      iconSize,
    )}
  />
  <span class={cn("font-semibold tracking-tight text-primary", labelSize)}>
    otpravkarr
  </span>
</div>
