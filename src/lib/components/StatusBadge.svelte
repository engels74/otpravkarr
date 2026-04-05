<script lang="ts">
import { Badge } from "$lib/components/ui/badge";
import type { ProvisioningMode } from "$lib/db/types";
import { cn } from "$lib/utils";

interface Props {
  status?: "active" | "inactive" | "orphaned";
  mode?: ProvisioningMode;
  class?: string;
}

let { status, mode, class: className }: Props = $props();

let variant = $derived.by(() => {
  if (status) {
    if (status === "active") return "default" as const;
    if (status === "inactive") return "secondary" as const;
    return "destructive" as const;
  }
  if (mode) {
    if (mode === "automatic") return "default" as const;
    if (mode === "self_managed") return "outline" as const;
    return "secondary" as const;
  }
  return "default" as const;
});

let label = $derived.by(() => {
  if (status) return status;
  if (mode) {
    if (mode === "automatic") return "Automatic";
    if (mode === "self_managed") return "Self-managed";
    return "Staff";
  }
  return "";
});
</script>

<Badge {variant} class={cn("text-xs", status ? "capitalize" : "", className)}>
  {label}
</Badge>
