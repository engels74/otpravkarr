<script lang="ts">
import InfoIcon from "lucide-svelte/icons/info";
import TriangleAlertIcon from "lucide-svelte/icons/triangle-alert";
import { Badge } from "$lib/components/ui/badge";
import * as Card from "$lib/components/ui/card";

interface Advisory {
  level: "info" | "warning";
  message: string;
}
interface DetectedPlugin {
  key: string;
  name: string;
  version: string | null;
  enabled: boolean;
  adapterKey: string | null;
  description: string;
  advisories: Advisory[];
}

interface Props {
  data: {
    configured: boolean;
    reachable: boolean;
    plugins: DetectedPlugin[];
  };
}

let { data }: Props = $props();
</script>

<svelte:head>
  <title>Plugins — otpravkarr</title>
</svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-lg font-semibold text-foreground">Dispatcharr plugins</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Detected plugins and how otpravkarr coordinates with them. Everything here is optional and
      degrades gracefully when a plugin is absent or disabled.
    </p>
  </div>

  {#if !data.configured}
    <Card.Root>
      <Card.Content class="py-8 text-center text-sm text-muted-foreground">
        Configure the Dispatcharr connection in Settings to detect installed plugins.
      </Card.Content>
    </Card.Root>
  {:else if !data.reachable}
    <Card.Root>
      <Card.Content class="py-8 text-center text-sm text-muted-foreground">
        Couldn't reach the Dispatcharr plugins API. Verify the connection in Settings.
      </Card.Content>
    </Card.Root>
  {:else if data.plugins.length === 0}
    <Card.Root>
      <Card.Content class="py-8 text-center text-sm text-muted-foreground">
        No plugins are installed on this Dispatcharr instance.
      </Card.Content>
    </Card.Root>
  {:else}
    <div class="grid gap-3">
      {#each data.plugins as plugin (plugin.key)}
        <Card.Root>
          <Card.Header>
            <div class="flex flex-wrap items-center gap-2">
              <Card.Title class="text-base">{plugin.name}</Card.Title>
              {#if plugin.enabled}
                <Badge variant="secondary">Enabled</Badge>
              {:else}
                <Badge variant="outline">Disabled</Badge>
              {/if}
              {#if plugin.version}
                <span class="text-xs text-muted-foreground">v{plugin.version}</span>
              {/if}
              {#if plugin.adapterKey == null}
                <Badge variant="outline">Generic</Badge>
              {/if}
            </div>
            <Card.Description>{plugin.description}</Card.Description>
          </Card.Header>
          {#if plugin.advisories.length > 0}
            <Card.Content class="space-y-2">
              {#each plugin.advisories as advisory, i (i)}
                <div
                  class="flex items-start gap-2 rounded-md border px-3 py-2 text-sm {advisory.level ===
                  'warning'
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-border'}"
                >
                  {#if advisory.level === "warning"}
                    <TriangleAlertIcon class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  {:else}
                    <InfoIcon class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {/if}
                  <span class="text-muted-foreground">{advisory.message}</span>
                </div>
              {/each}
            </Card.Content>
          {/if}
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
