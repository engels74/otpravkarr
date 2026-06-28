<script lang="ts">
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
    picker?: boolean;
    plexUsername?: string;
    offered?: OfferedGroup[];
    selected?: number[];
  };
  form?: { error?: string } | null;
}

let { data, form }: Props = $props();

// svelte-ignore state_referenced_locally
let selected = $state(new Set<number>(data.selected ?? []));

const selectedJson = $derived(JSON.stringify([...selected]));
</script>

<svelte:head>
  <title>Choose your channels — otpravkarr</title>
</svelte:head>

{#if data.picker}
  <div class="mx-auto w-full max-w-2xl px-4 py-10">
    <div class="mb-6">
      <p class="eyebrow">WELCOME{data.plexUsername ? `, ${data.plexUsername}` : ""}</p>
      <h1 class="text-2xl font-semibold tracking-tight">Choose your channel groups</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Pick the channel groups you want before we finish setting up your account. You can change
        this anytime afterward.
      </p>
    </div>

    {#if form?.error}
      <Alert.Root variant="destructive" class="mb-4">
        <TriangleAlertIcon class="h-4 w-4" />
        <Alert.Title>Couldn't finish setup</Alert.Title>
        <Alert.Description>{form.error}</Alert.Description>
      </Alert.Root>
    {/if}

    <form method="POST" action="?/confirm">
      <input type="hidden" name="group_ids" value={selectedJson} />

      <Card.Root>
        <Card.Content class="pt-6">
          {#if selected.size === 0}
            <Alert.Root variant="destructive" class="mb-3">
              <TriangleAlertIcon class="h-4 w-4" />
              <Alert.Title>No channels selected</Alert.Title>
              <Alert.Description>
                Continuing with zero groups means your player will show no channels. Pick at least
                one group, or continue anyway to start with nothing.
              </Alert.Description>
            </Alert.Root>
          {/if}

          <GroupPicker groups={data.offered ?? []} bind:selected />
        </Card.Content>

        <Card.Footer class="justify-end">
          <Button type="submit">Continue</Button>
        </Card.Footer>
      </Card.Root>
    </form>
  </div>
{:else}
  <p class="text-center opacity-70 py-12">Completing sign-in…</p>
{/if}
