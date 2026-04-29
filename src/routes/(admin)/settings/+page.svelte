<script lang="ts">
import type { ActionResult } from "@sveltejs/kit";
import { toast } from "svelte-sonner";
import { applyAction, enhance } from "$app/forms";
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
  };
}

let { data }: Props = $props();

let sectionSubmitting = $state<Record<string, boolean>>({});
let sectionMessage = $state<Record<string, { type: "success" | "error"; text: string }>>({});
const syncIntervalFeedbackId = "sync_interval_minutes_feedback";
let syncIntervalError = $derived(
  sectionMessage.sync?.type === "error" ? sectionMessage.sync.text : "",
);

function makeEnhance(section: string) {
  return () => {
    sectionSubmitting[section] = true;
    delete sectionMessage[section];
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      sectionSubmitting[section] = false;
      if (result.type === "success") {
        await update();
        const msg =
          (result.data as { message?: string } | undefined)?.message ??
          "Settings saved successfully.";
        sectionMessage[section] = { type: "success", text: msg };
        toast.success(msg);
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
    <form method="POST" action="?/updateSecurity" use:enhance={makeEnhance("security")}>
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
</div>
