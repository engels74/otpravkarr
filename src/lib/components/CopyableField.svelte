<script lang="ts">
import CheckIcon from "lucide-svelte/icons/check";
import CopyIcon from "lucide-svelte/icons/copy";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { cn } from "$lib/utils";

interface Props {
  label: string;
  value: string;
  class?: string;
}

let { label, value, class: className }: Props = $props();
const inputId = $props.id();
let copied = $state(false);

$effect(() => {
  if (!copied) return;
  const timer = setTimeout(() => {
    copied = false;
  }, 2000);
  return () => clearTimeout(timer);
});

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(value);
    copied = true;
    toast.success(`Copied ${label} to clipboard`);
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}
</script>

<div class={cn("grid gap-1.5", className)}>
  <label for={inputId} class="text-sm font-medium text-muted-foreground">{label}</label>
  <div class="flex items-center gap-2">
    <Input id={inputId} readonly {value} class="font-mono text-xs" />
    <Button
      variant="ghost"
      size="icon"
      class="shrink-0"
      onclick={copyToClipboard}
      aria-label="Copy to clipboard"
    >
      {#if copied}
        <CheckIcon class="h-4 w-4 text-green-500" />
      {:else}
        <CopyIcon class="h-4 w-4" />
      {/if}
    </Button>
  </div>
</div>
