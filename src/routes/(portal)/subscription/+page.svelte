<script lang="ts">
import CheckIcon from "lucide-svelte/icons/check";
import LockIcon from "lucide-svelte/icons/lock";
import TriangleAlertIcon from "lucide-svelte/icons/triangle-alert";
import GroupPicker from "$lib/components/GroupPicker.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";

interface OfferedGroup {
  id: number;
  name: string;
  channelCount: number | null;
}

interface Props {
  data: {
    plexUsername: string;
    offered: OfferedGroup[];
    selected: number[];
    locked: boolean;
    saved: boolean;
  };
  form?: { error?: string } | null;
}

let { data, form }: Props = $props();

// svelte-ignore state_referenced_locally
let selected = $state(new Set<number>(data.selected));

const selectedJson = $derived(JSON.stringify([...selected]));

const lockedSelectedNames = $derived(
  data.offered.filter((g) => data.selected.includes(g.id)).map((g) => g.name),
);
</script>

<svelte:head>
  <title>My Channels — otpravkarr</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-10">
  <div class="mb-6">
    <p class="eyebrow">SUBSCRIPTION</p>
    <h1 class="text-2xl font-semibold tracking-tight">My channel groups</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Choose which channel groups appear in your player. Changes apply right away.
    </p>
  </div>

  {#if data.saved}
    <Alert.Root class="mb-4 border-primary/40">
      <CheckIcon class="h-4 w-4" />
      <Alert.Title>Saved</Alert.Title>
      <Alert.Description>Your channel selection has been updated.</Alert.Description>
    </Alert.Root>
  {/if}

  {#if form?.error}
    <Alert.Root variant="destructive" class="mb-4">
      <TriangleAlertIcon class="h-4 w-4" />
      <Alert.Title>Couldn't save</Alert.Title>
      <Alert.Description>{form.error}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if data.locked}
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <LockIcon class="h-4 w-4 text-muted-foreground" />
          <Card.Title class="text-base">Managed by your administrator</Card.Title>
        </div>
        <Card.Description>
          Your channel groups are assigned for you and can't be changed here. Contact the
          administrator to request a change.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if lockedSelectedNames.length > 0}
          <ul class="flex flex-wrap gap-2">
            {#each lockedSelectedNames as name (name)}
              <li
                class="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-sm text-foreground"
              >
                {name}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">No channel groups are currently assigned.</p>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else if data.offered.length === 0}
    <Card.Root>
      <Card.Content class="py-10 text-center text-sm text-muted-foreground">
        No channel groups are available to choose from right now. Please check back later or contact
        the administrator.
      </Card.Content>
    </Card.Root>
  {:else}
    <form method="POST" action="?/save">
      <input type="hidden" name="group_ids" value={selectedJson} />

      <Card.Root>
        <Card.Content class="pt-6">
          {#if selected.size === 0}
            <Alert.Root variant="destructive" class="mb-3">
              <TriangleAlertIcon class="h-4 w-4" />
              <Alert.Title>No channels selected</Alert.Title>
              <Alert.Description>
                Saving with zero groups means your player will show no channels. Pick at least one
                group, or save anyway to hide everything.
              </Alert.Description>
            </Alert.Root>
          {/if}

          <GroupPicker groups={data.offered} bind:selected />
        </Card.Content>

        <Card.Footer class="justify-end">
          <Button type="submit">Save selection</Button>
        </Card.Footer>
      </Card.Root>
    </form>
  {/if}
</div>
