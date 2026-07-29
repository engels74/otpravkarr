<script lang="ts">
import type { ActionResult } from "@sveltejs/kit";
import { untrack } from "svelte";
import { toast } from "svelte-sonner";
import { applyAction, enhance } from "$app/forms";
import GroupPicker from "$lib/components/GroupPicker.svelte";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";

interface Props {
  data: {
    plex: {
      serverUrl: string;
      hasToken: boolean;
      machineId: string;
    };
    dispatcharr: {
      url: string;
      hasApiKey: boolean;
      externalUrl: string;
    };
    sync: {
      intervalMinutes: string;
    };
    security: {
      allowedOrigins: string;
    };
    audit: {
      retentionDays: string;
    };
    subscription: {
      allowSelfSelect: boolean;
      selectableGroupIds: number[];
      channelGroups: { id: number; name: string; channelCount: number | null }[];
      defaultPolicy: "fixed" | "core_bundles" | "approved_selection";
      fixedGroupIds: number[];
      coreGroupIds: number[];
      bundleCatalogVersion: number;
      bundles: {
        id: string;
        slug: string;
        displayName: string;
        enabled: boolean;
        groupIds: number[];
      }[];
    };
  };
}

let { data }: Props = $props();

// Local state for the lineup-policy group pickers.
const initialSubscription = untrack(() => data.subscription);
let approvedGroups = $state(new Set<number>(initialSubscription.selectableGroupIds));
let fixedGroups = $state(new Set<number>(initialSubscription.fixedGroupIds));
let coreGroups = $state(new Set<number>(initialSubscription.coreGroupIds));
let defaultPolicy = $state(initialSubscription.defaultPolicy);
let bundleGroups = $state<Record<string, Set<number>>>(
  Object.fromEntries(
    initialSubscription.bundles.map((bundle) => [bundle.id, new Set(bundle.groupIds)]),
  ),
);
let bundleEnabled = $state<Record<string, boolean>>(
  Object.fromEntries(initialSubscription.bundles.map((bundle) => [bundle.id, bundle.enabled])),
);
let newBundleGroups = $state(new Set<number>());
let newBundleEnabled = $state(true);
let catalogVersion = $state(String(initialSubscription.bundleCatalogVersion || 1));
const approvedGroupsJson = $derived(JSON.stringify([...approvedGroups]));
const fixedGroupsJson = $derived(JSON.stringify([...fixedGroups]));
const coreGroupsJson = $derived(JSON.stringify([...coreGroups]));

let sectionSubmitting = $state<Record<string, boolean>>({});
let sectionMessage = $state<Record<string, { type: "success" | "error"; text: string }>>({});
const syncIntervalFeedbackId = "sync_interval_minutes_feedback";
let syncIntervalError = $derived(
  sectionMessage.sync?.type === "error" ? sectionMessage.sync.text : "",
);

function makeEnhance(
  section: string,
  { reset = true, invalidateAll }: { reset?: boolean; invalidateAll?: boolean } = {},
) {
  return () => {
    sectionSubmitting[section] = true;
    delete sectionMessage[section];
    return async ({
      result,
      update,
    }: {
      result: ActionResult;
      update: (options?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;
    }) => {
      sectionSubmitting[section] = false;
      if (result.type === "success") {
        const msg =
          (result.data as { message?: string } | undefined)?.message ??
          "Settings saved successfully.";
        // ISSUE-008: fire the confirmation BEFORE awaiting the reload. update()
        // defaults to invalidateAll:true, which re-runs the settings load(); if
        // that load is blocked on a slow Dispatcharr call the await would delay
        // or (on a severed socket) swallow the success signal. The save already
        // succeeded server-side by the time this callback runs.
        sectionMessage[section] = { type: "success", text: msg };
        toast.success(msg);
        // ISSUE-008/ISSUE-001: forms whose fields reflect persisted (non-secret)
        // state opt out of the default reset:true so form.reset() doesn't blank
        // the saved value (the security textarea, the subscription checkbox);
        // secret "leave blank to keep current" fields keep the default reset so
        // an entered secret is cleared from the DOM after save. A severed/slow
        // reload must not throw past the confirmation we already rendered.
        const updateOptions: { reset: boolean; invalidateAll?: boolean } = { reset };
        if (invalidateAll !== undefined) {
          updateOptions.invalidateAll = invalidateAll;
        }
        try {
          await update(updateOptions);
        } catch {
          // The reload failed after a successful save — keep the confirmation.
        }
      } else if (result.type === "failure") {
        const errorMsg =
          (result.data as { error?: string } | undefined)?.error ?? "An error occurred.";
        sectionMessage[section] = { type: "error", text: errorMsg };
        toast.error(errorMsg);
      } else if (result.type === "error") {
        const errorMsg = result.error?.message ?? "An unexpected error occurred.";
        sectionMessage[section] = { type: "error", text: errorMsg };
        toast.error(errorMsg);
      } else {
        await applyAction(result);
      }
    };
  };
}
</script>

<svelte:head>
  <title>Settings — otpravkarr</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <p class="eyebrow">SETTINGS</p>
    <h1 class="font-display text-4xl font-normal tracking-tight leading-[1.05] mt-1">
      System configuration.
    </h1>
  </div>

  <!-- ─── Connections ───────────────────────────────────── -->
  <section class="space-y-4">
    <p class="eyebrow">Connections</p>

  <!-- Plex Connection -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Plex Connection</Card.Title>
      <Card.Description>Configure the connection to your Plex Media Server.</Card.Description>
    </Card.Header>
    <form method="POST" action="?/updatePlexConnection" use:enhance={makeEnhance("plex")}>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="plex_server_url">Server URL</Label>
          <Input
            id="plex_server_url"
            name="plex_server_url"
            value={data.plex.serverUrl}
            placeholder="http://localhost:32400"
            oninput={() => {
              delete sectionMessage["plex"];
            }}
          />
        </div>

        <div class="grid gap-1.5">
          <Label>Token Status</Label>
          <div>
            {#if data.plex.hasToken}
              <Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Token configured</Badge>
            {:else}
              <Badge variant="destructive">Not configured</Badge>
            {/if}
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="plex_admin_token">New token (leave blank to keep current)</Label>
          <Input id="plex_admin_token" name="plex_admin_token" type="password" placeholder="Enter new Plex token..." oninput={() => { delete sectionMessage["plex"]; }} />
        </div>

        {#if data.plex.machineId}
          <div class="grid min-w-0 gap-1.5">
            <Label>Machine ID</Label>
            <p class="min-w-0 break-all font-mono text-sm text-muted-foreground">{data.plex.machineId}</p>
          </div>
        {/if}
      </Card.Content>
      <Card.Footer class="flex items-center gap-3">
        <Button type="submit" disabled={sectionSubmitting["plex"]} aria-label="Save Plex settings">
          {sectionSubmitting["plex"] ? "Saving..." : "Save"}
        </Button>
        {#if sectionMessage["plex"]}
          <span class="text-sm {sectionMessage['plex'].type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
            {sectionMessage["plex"].text}
          </span>
        {/if}
      </Card.Footer>
    </form>
  </Card.Root>

  <!-- Dispatcharr Connection -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Dispatcharr Connection</Card.Title>
      <Card.Description>Configure the connection to your Dispatcharr instance.</Card.Description>
    </Card.Header>
    <form method="POST" action="?/updateDispatcharrConnection" use:enhance={makeEnhance("dispatcharr")}>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="dispatcharr_url">URL</Label>
          <Input id="dispatcharr_url" name="dispatcharr_url" value={data.dispatcharr.url} placeholder="http://localhost:8000" oninput={() => { delete sectionMessage["dispatcharr"]; }} />
        </div>

        <div class="grid gap-1.5">
          <Label for="dispatcharr_external_url">External/Public URL (optional)</Label>
          <Input id="dispatcharr_external_url" name="dispatcharr_external_url" value={data.dispatcharr.externalUrl} placeholder="https://tv.example.com" oninput={() => { delete sectionMessage["dispatcharr"]; }} />
          <p class="text-xs text-muted-foreground">When set, generated M3U and stream URLs will use this address instead of the connection URL above.</p>
        </div>

        <div class="grid gap-1.5">
          <Label>API Key Status</Label>
          <div>
            {#if data.dispatcharr.hasApiKey}
              <Badge variant="secondary" class="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Key configured</Badge>
            {:else}
              <Badge variant="destructive">Not configured</Badge>
            {/if}
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="dispatcharr_api_key">New API key (leave blank to keep current)</Label>
          <Input id="dispatcharr_api_key" name="dispatcharr_api_key" type="password" placeholder="Enter new API key..." oninput={() => { delete sectionMessage["dispatcharr"]; }} />
        </div>
      </Card.Content>
      <Card.Footer class="flex items-center gap-3">
        <Button
          type="submit"
          disabled={sectionSubmitting["dispatcharr"]}
          aria-label="Save Dispatcharr settings"
        >
          {sectionSubmitting["dispatcharr"] ? "Saving..." : "Save"}
        </Button>
        {#if sectionMessage["dispatcharr"]}
          <span class="text-sm {sectionMessage['dispatcharr'].type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
            {sectionMessage["dispatcharr"].text}
          </span>
        {/if}
      </Card.Footer>
    </form>
  </Card.Root>

  </section>

  <!-- ─── Sync ──────────────────────────────────────────── -->
  <section class="space-y-4">
    <p class="eyebrow">Sync</p>

  <!-- Sync Settings -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Sync Settings</Card.Title>
      <Card.Description>Control how frequently Plex friends are synced.</Card.Description>
    </Card.Header>
    <form method="POST" action="?/updateSyncSettings" use:enhance={makeEnhance("sync")}>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="sync_interval_minutes">Sync interval</Label>
          <div class="flex items-center gap-2">
            <Input
              id="sync_interval_minutes"
              name="sync_interval_minutes"
              type="number"
              value={data.sync.intervalMinutes}
              class="w-[120px]"
              aria-invalid={syncIntervalError ? "true" : undefined}
              aria-describedby={syncIntervalFeedbackId}
              oninput={() => { delete sectionMessage["sync"]; }}
            />
            <span class="text-sm text-muted-foreground">minutes</span>
          </div>
          <p
            id={syncIntervalFeedbackId}
            class="text-xs {syncIntervalError ? 'text-destructive' : 'text-muted-foreground'}"
          >
            {syncIntervalError || "Between 1 and 1440 minutes."}
          </p>
        </div>
      </Card.Content>
      <Card.Footer class="flex items-center gap-3">
        <Button type="submit" disabled={sectionSubmitting["sync"]} aria-label="Save sync settings">
          {sectionSubmitting["sync"] ? "Saving..." : "Save"}
        </Button>
        {#if sectionMessage["sync"]?.type === "success"}
          <span class="text-sm text-green-600 dark:text-green-400">
            {sectionMessage["sync"].text}
          </span>
        {/if}
      </Card.Footer>
    </form>
  </Card.Root>

  <!-- Default Provisioning -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Default Provisioning</Card.Title>
      <Card.Description>Managed during setup only.</Card.Description>
    </Card.Header>
    <Card.Content>
      <p class="text-sm text-muted-foreground">
        Provisioning default overrides are disabled in Admin because runtime provisioning does not
        currently consume these values.
      </p>
    </Card.Content>
  </Card.Root>

  </section>

  <!-- ─── Security ──────────────────────────────────────── -->
  <section class="space-y-4">
    <p class="eyebrow">Security</p>

  <!-- Security -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Security</Card.Title>
      <Card.Description>Configure CORS and origin validation.</Card.Description>
    </Card.Header>
    <form
      method="POST"
      action="?/updateSecurity"
      use:enhance={makeEnhance("security", { reset: false })}
    >
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="allowed_origins">Allowed origins</Label>
          <textarea
            id="allowed_origins"
            name="allowed_origins"
            rows="4"
            class="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 outline-none"
            placeholder="https://example.com"
          >{data.security.allowedOrigins}</textarea>
          <p class="text-xs text-muted-foreground">One origin per line (e.g. https://example.com). If empty, falls back to the ORIGIN environment variable.</p>
        </div>
      </Card.Content>
      <Card.Footer class="flex items-center gap-3">
        <Button
          type="submit"
          disabled={sectionSubmitting["security"]}
          aria-label="Save security settings"
        >
          {sectionSubmitting["security"] ? "Saving..." : "Save"}
        </Button>
        {#if sectionMessage["security"]}
          <span class="text-sm {sectionMessage['security'].type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
            {sectionMessage["security"].text}
          </span>
        {/if}
      </Card.Footer>
    </form>
  </Card.Root>

  </section>

  <!-- ─── Audit ─────────────────────────────────────────── -->
  <section class="space-y-4">
    <p class="eyebrow">Audit</p>

  <!-- Audit Log -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Audit Log</Card.Title>
      <Card.Description>Configure audit log retention.</Card.Description>
    </Card.Header>
    <form method="POST" action="?/updateAuditRetention" use:enhance={makeEnhance("audit")}>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="audit_retention_days">Retention period</Label>
          <div class="flex items-center gap-2">
            <Input id="audit_retention_days" name="audit_retention_days" type="number" value={data.audit.retentionDays} class="w-[120px]" />
            <span class="text-sm text-muted-foreground">days</span>
          </div>
          <p class="text-xs text-muted-foreground">Audit log entries older than this will be automatically purged.</p>
        </div>
      </Card.Content>
      <Card.Footer class="flex items-center gap-3">
        <Button
          type="submit"
          disabled={sectionSubmitting["audit"]}
          aria-label="Save audit retention settings"
        >
          {sectionSubmitting["audit"] ? "Saving..." : "Save"}
        </Button>
        {#if sectionMessage["audit"]}
          <span class="text-sm {sectionMessage['audit'].type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
            {sectionMessage["audit"].text}
          </span>
        {/if}
      </Card.Footer>
    </form>
  </Card.Root>
  </section>
  <!-- ─── Lineup policy ───────────────────────────────────── -->
  <section class="space-y-4">
    <p class="eyebrow">Channel subscriptions</p>

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">Instance lineup policy</Card.Title>
        <Card.Description>
          Set the least-privilege default for new and reconciled subscriber lineups.
          Core plus bundles is recommended.
        </Card.Description>
      </Card.Header>
      <form
        method="POST"
        action="?/updateLineupPolicy"
        use:enhance={makeEnhance("lineupPolicy", { reset: false })}
      >
        <input type="hidden" name="lineup_fixed_group_ids" value={fixedGroupsJson} />
        <input type="hidden" name="lineup_core_group_ids" value={coreGroupsJson} />
        <input type="hidden" name="default_selectable_groups" value={approvedGroupsJson} />
        <Card.Content class="grid gap-5">
          <div class="grid gap-1.5">
            <Label for="lineup_policy_default">Default policy</Label>
            <select
              id="lineup_policy_default"
              name="lineup_policy_default"
              bind:value={defaultPolicy}
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="core_bundles">Core plus bundles (recommended)</option>
              <option value="fixed">Fixed groups</option>
              <option value="approved_selection">Admin-approved selection</option>
            </select>
          </div>

          {#if data.subscription.channelGroups.length === 0}
            <p class="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No live non-quarantine groups found. Configure and verify Dispatcharr before changing lineup policy.
            </p>
          {:else}
            <div class="grid min-w-0 gap-1.5">
              <Label>Fixed groups</Label>
              <p class="text-xs text-muted-foreground">Used only by the fixed policy.</p>
              <GroupPicker groups={data.subscription.channelGroups} bind:selected={fixedGroups} />
            </div>
            <div class="grid min-w-0 gap-1.5">
              <Label>Core groups</Label>
              <p class="text-xs text-muted-foreground">Always included by the core plus bundles policy.</p>
              <GroupPicker groups={data.subscription.channelGroups} bind:selected={coreGroups} />
            </div>
            <div class="grid min-w-0 gap-1.5">
              <Label>Admin-approved groups</Label>
              <p class="text-xs text-muted-foreground">
                The only groups available to approved-selection users. Select none to approve none.
              </p>
              <GroupPicker groups={data.subscription.channelGroups} bind:selected={approvedGroups} />
            </div>
          {/if}
        </Card.Content>
        <Card.Footer class="flex items-center gap-3">
          <Button
            type="submit"
            disabled={sectionSubmitting["lineupPolicy"] || data.subscription.channelGroups.length === 0}
          >
            {sectionSubmitting["lineupPolicy"] ? "Saving..." : "Save policy"}
          </Button>
          {#if sectionMessage["lineupPolicy"]}
            <span class="text-sm {sectionMessage['lineupPolicy'].type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
              {sectionMessage["lineupPolicy"].text}
            </span>
          {/if}
        </Card.Footer>
      </form>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">Lineup bundle catalog</Card.Title>
        <Card.Description>
          Bundle identity and slug are permanent. Increment the catalog version when changing bundle contents.
        </Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-5">
        <div class="grid max-w-48 gap-1.5">
          <Label for="bundle_catalog_version">Catalog version</Label>
          <Input id="bundle_catalog_version" bind:value={catalogVersion} inputmode="numeric" />
        </div>

        {#each data.subscription.bundles as bundle (bundle.id)}
          {@const selectedBundleGroups = bundleGroups[bundle.id] ?? new Set<number>()}
          {@const bundleMessage = sectionMessage[`bundle-${bundle.id}`]}
          <form
            method="POST"
            action="?/saveLineupBundle"
            use:enhance={makeEnhance(`bundle-${bundle.id}`, { reset: false })}
            class="grid gap-4 rounded-md border border-border p-4"
          >
            <input type="hidden" name="bundle_id" value={bundle.id} />
            <input type="hidden" name="bundle_slug" value={bundle.slug} />
            <input type="hidden" name="bundle_enabled" value={String(bundleEnabled[bundle.id])} />
            <input type="hidden" name="bundle_group_ids" value={JSON.stringify([...selectedBundleGroups])} />
            <input type="hidden" name="bundle_catalog_version" value={catalogVersion} />
            <p class="text-sm font-medium">{bundle.id} <span class="text-muted-foreground">({bundle.slug})</span></p>
            <div class="grid gap-1.5">
              <Label for={`bundle-name-${bundle.id}`}>Display name</Label>
              <Input id={`bundle-name-${bundle.id}`} name="bundle_display_name" value={bundle.displayName} required />
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={bundleEnabled[bundle.id]} />
              Enabled
            </label>
            {#if data.subscription.channelGroups.length > 0}
              <GroupPicker
                groups={data.subscription.channelGroups}
                bind:selected={() => selectedBundleGroups, (value) => (bundleGroups[bundle.id] = value)}
              />
            {/if}
            <div class="flex items-center gap-3">
              <Button type="submit" disabled={sectionSubmitting[`bundle-${bundle.id}`] || data.subscription.channelGroups.length === 0}>
                {sectionSubmitting[`bundle-${bundle.id}`] ? "Saving..." : "Save bundle"}
              </Button>
              {#if bundleMessage}
                <span class="text-sm {bundleMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
                  {bundleMessage.text}
                </span>
              {/if}
            </div>
          </form>
        {/each}

        <form
          method="POST"
          action="?/saveLineupBundle"
          use:enhance={makeEnhance("newBundle", { reset: false })}
          class="grid gap-4 rounded-md border border-border p-4"
        >
          <input type="hidden" name="bundle_enabled" value={String(newBundleEnabled)} />
          <input type="hidden" name="bundle_group_ids" value={JSON.stringify([...newBundleGroups])} />
          <input type="hidden" name="bundle_catalog_version" value={catalogVersion} />
          <p class="text-sm font-medium">Create bundle</p>
          <div class="grid gap-1.5">
            <Label for="new-bundle-id">Stable ID</Label>
            <Input id="new-bundle-id" name="bundle_id" pattern="[A-Za-z0-9._-]+" required />
          </div>
          <div class="grid gap-1.5">
            <Label for="new-bundle-slug">Stable slug</Label>
            <Input id="new-bundle-slug" name="bundle_slug" pattern="[a-z0-9-]+" required />
          </div>
          <div class="grid gap-1.5">
            <Label for="new-bundle-name">Display name</Label>
            <Input id="new-bundle-name" name="bundle_display_name" required />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={newBundleEnabled} />
            Enabled
          </label>
          {#if data.subscription.channelGroups.length > 0}
            <GroupPicker groups={data.subscription.channelGroups} bind:selected={newBundleGroups} />
          {/if}
          <div class="flex items-center gap-3">
            <Button type="submit" disabled={sectionSubmitting["newBundle"] || data.subscription.channelGroups.length === 0}>
              {sectionSubmitting["newBundle"] ? "Creating..." : "Create bundle"}
            </Button>
            {#if sectionMessage["newBundle"]}
              <span class="text-sm {sectionMessage['newBundle'].type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}">
                {sectionMessage["newBundle"].text}
              </span>
            {/if}
          </div>
        </form>
      </Card.Content>
    </Card.Root>
  </section>

</div>
