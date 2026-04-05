<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { cn } from "$lib/utils";

interface Props {
  open?: boolean;
  title: string;
  description: string;
  cancelLabel?: string;
  confirm: Snippet;
  trigger?: Snippet<[{ props: Record<string, unknown> }]>;
  class?: string;
}

let {
  open = $bindable(false),
  title,
  description,
  cancelLabel = "Cancel",
  confirm,
  trigger,
  class: className,
}: Props = $props();
</script>

<Dialog.Root bind:open>
  {#if trigger}
    <Dialog.Trigger>
      {#snippet child({ props })}
        {@render trigger({ props })}
      {/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Content class={cn(className)}>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>
        {cancelLabel}
      </Button>
      {@render confirm()}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
