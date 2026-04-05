<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  type: "plex" | "dispatcharr" | "database";
  status: string;
  reachable?: boolean;
  authValid?: boolean;
  class?: string;
}

let { type, status, reachable, authValid, class: className }: Props = $props();

let badge = $derived.by(() => {
  if (type === "plex") {
    switch (status) {
      case "healthy":
        return { label: "Healthy", class: "bg-green-500/15 text-green-700 dark:text-green-400" };
      case "unauthorized":
        return { label: "Unauthorized", class: "bg-red-500/15 text-red-700 dark:text-red-400" };
      case "server_changed":
        return {
          label: "Server Changed",
          class: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        };
      default:
        return { label: "Unreachable", class: "bg-red-500/15 text-red-700 dark:text-red-400" };
    }
  }
  if (type === "dispatcharr") {
    if (reachable && authValid) {
      return { label: "Healthy", class: "bg-green-500/15 text-green-700 dark:text-green-400" };
    }
    if (reachable && !authValid) {
      return { label: "Auth Invalid", class: "bg-red-500/15 text-red-700 dark:text-red-400" };
    }
    return { label: "Unreachable", class: "bg-red-500/15 text-red-700 dark:text-red-400" };
  }
  // database
  if (status === "healthy") {
    return { label: "Healthy", class: "bg-green-500/15 text-green-700 dark:text-green-400" };
  }
  return { label: "Unhealthy", class: "bg-red-500/15 text-red-700 dark:text-red-400" };
});
</script>

<span class={cn("inline-flex items-center rounded-md px-2 py-1 text-xs font-medium", badge.class, className)}>
  {badge.label}
</span>
