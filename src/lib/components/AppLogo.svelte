<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  size?: "sm" | "default";
  class?: string;
}

let { size = "default", class: className }: Props = $props();
</script>

<div class={cn("flex items-center gap-2", className)}>
  <svg
    class={cn("shrink-0", size === "sm" ? "h-5 w-5" : "h-6 w-6")}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- Placeholder: stylized "O" with broadcast/send motif -->
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
    <path d="M12 7v5l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  <span class={cn("font-semibold tracking-tight", size === "sm" ? "text-xs" : "text-sm")}>
    otpravkarr
  </span>
</div>
