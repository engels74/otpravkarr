<script lang="ts">
import CheckIcon from "lucide-svelte/icons/check";
import CopyIcon from "lucide-svelte/icons/copy";
import EyeIcon from "lucide-svelte/icons/eye";
import EyeOffIcon from "lucide-svelte/icons/eye-off";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { cn } from "$lib/utils";

interface Props {
  label: string;
  value: string;
  secret?: boolean;
  class?: string;
}

let { label, value, secret = false, class: className }: Props = $props();
const inputId = $props.id();
const COPY_FEEDBACK_TIMEOUT_MS = 2000;
let revealed = $state(false);
let copied = $state(false);
let copyStatus = $state<{ type: "success" | "error"; message: string } | null>(null);

$effect(() => {
  if (!copied && !copyStatus) return;
  const timer = setTimeout(() => {
    copied = false;
    copyStatus = null;
  }, COPY_FEEDBACK_TIMEOUT_MS);
  return () => clearTimeout(timer);
});
const displayValue = $derived(secret && !revealed ? "••••••••••••••••" : value);

function toggleReveal() {
  revealed = !revealed;
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(value);
    const message = `Copied ${label} to clipboard`;
    copied = true;
    copyStatus = { type: "success", message };
    toast.success(message);
  } catch {
    copied = false;
    copyStatus = { type: "error", message: "Couldn't copy to clipboard" };
    toast.error("Couldn't copy to clipboard");
  }
}
</script>

<div class={cn("grid gap-1.5", className)}>
  <label for={inputId} class="text-sm font-medium text-muted-foreground">{label}</label>
  <div class="flex items-center gap-2">
    <Input id={inputId} readonly value={displayValue} class="font-mono text-xs" />
    {#if secret}
      <Button
        variant="ghost"
        size="icon"
        class="shrink-0"
        onclick={toggleReveal}
        aria-label={(revealed ? "Hide " : "Reveal ") + label}
      >
        {#if revealed}
          <EyeOffIcon class="h-4 w-4" />
        {:else}
          <EyeIcon class="h-4 w-4" />
        {/if}
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class="shrink-0"
      onclick={copyToClipboard}
      aria-label={"Copy " + label + " to clipboard"}
    >
      {#if copied}
        <CheckIcon class="h-4 w-4 text-green-500" />
      {:else}
        <CopyIcon class="h-4 w-4" />
      {/if}
    </Button>
  </div>
  {#if copyStatus}
    <p
      class={cn(
        "text-xs",
        copyStatus.type === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      role="status"
      aria-live="polite"
    >
      {copyStatus.message}
    </p>
  {/if}
</div>
