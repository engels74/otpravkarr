<script lang="ts">
import { enhance } from "$app/forms";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import * as Select from "$lib/components/ui/select";

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
    };
    sync: {
      intervalMinutes: string;
    };
    provisioning: {
      defaultMode: string;
      defaultGroupId: string;
      defaultProfileId: string;
    };
    security: {
      allowedOrigins: string;
    };
    audit: {
      retentionDays: string;
    };
    groups: { id: number; name: string }[];
    profiles: { id: number; name: string }[];
  };
}

let { data }: Props = $props();

let sectionSubmitting = $state<Record<string, boolean>>({});

function makeEnhance(section: string) {
  return () => {
    sectionSubmitting[section] = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      sectionSubmitting[section] = false;
    };
  };
}

// Track select values for provisioning section (need hidden inputs for form submission)
let provisioningMode = $derived(data.provisioning.defaultMode);
let defaultGroupId = $derived(data.provisioning.defaultGroupId);
let defaultProfileId = $derived(data.provisioning.defaultProfileId);

function modeLabel(mode: string): string {
  if (mode === "automatic") return "Automatic";
  if (mode === "self_managed") return "Self-managed";
  if (mode === "staff") return "Staff";
  return mode;
}
</script>

<svelte:head>
  <title>Settings — otpravkarr</title>
</svelte:head>

<div class="space-y-6">
  <h1 class="text-lg font-semibold">Settings</h1>

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
          <Input id="plex_server_url" name="plex_server_url" value={data.plex.serverUrl} placeholder="http://localhost:32400" />
        </div>

        <div class="grid gap-1.5">
          <Label>Token Status</Label>
          <div>
            {#if data.plex.hasToken}
              <Badge variant="default">Token configured</Badge>
            {:else}
              <Badge variant="destructive">Not configured</Badge>
            {/if}
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="plex_admin_token">New token (leave blank to keep current)</Label>
          <Input id="plex_admin_token" name="plex_admin_token" type="password" placeholder="Enter new Plex token..." />
        </div>

        {#if data.plex.machineId}
          <div class="grid gap-1.5">
            <Label>Machine ID</Label>
            <p class="font-mono text-sm text-muted-foreground">{data.plex.machineId}</p>
          </div>
        {/if}
      </Card.Content>
      <Card.Footer>
        <Button type="submit" disabled={sectionSubmitting["plex"]}>
          {sectionSubmitting["plex"] ? "Saving..." : "Save"}
        </Button>
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
          <Input id="dispatcharr_url" name="dispatcharr_url" value={data.dispatcharr.url} placeholder="http://localhost:8000" />
        </div>

        <div class="grid gap-1.5">
          <Label>API Key Status</Label>
          <div>
            {#if data.dispatcharr.hasApiKey}
              <Badge variant="default">Key configured</Badge>
            {:else}
              <Badge variant="destructive">Not configured</Badge>
            {/if}
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="dispatcharr_api_key">New API key (leave blank to keep current)</Label>
          <Input id="dispatcharr_api_key" name="dispatcharr_api_key" type="password" placeholder="Enter new API key..." />
        </div>
      </Card.Content>
      <Card.Footer>
        <Button type="submit" disabled={sectionSubmitting["dispatcharr"]}>
          {sectionSubmitting["dispatcharr"] ? "Saving..." : "Save"}
        </Button>
      </Card.Footer>
    </form>
  </Card.Root>

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
            <Input id="sync_interval_minutes" name="sync_interval_minutes" type="number" min="1" value={data.sync.intervalMinutes} class="w-[120px]" />
            <span class="text-sm text-muted-foreground">minutes</span>
          </div>
        </div>
      </Card.Content>
      <Card.Footer>
        <Button type="submit" disabled={sectionSubmitting["sync"]}>
          {sectionSubmitting["sync"] ? "Saving..." : "Save"}
        </Button>
      </Card.Footer>
    </form>
  </Card.Root>

  <!-- Default Provisioning -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Default Provisioning</Card.Title>
      <Card.Description>Set defaults for newly provisioned users.</Card.Description>
    </Card.Header>
    <form method="POST" action="?/updateDefaultProvisioning" use:enhance={makeEnhance("provisioning")}>
      <input type="hidden" name="default_provisioning_mode" value={provisioningMode} />
      <input type="hidden" name="default_group_id" value={defaultGroupId} />
      <input type="hidden" name="default_profile_id" value={defaultProfileId} />

      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label>Default mode</Label>
          <Select.Root
            type="single"
            value={provisioningMode}
            onValueChange={(v) => (provisioningMode = v ?? "automatic")}
          >
            <Select.Trigger class="w-[200px]">
              <span data-slot="select-value">{modeLabel(provisioningMode)}</span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="automatic" label="Automatic">Automatic</Select.Item>
              <Select.Item value="self_managed" label="Self-managed">Self-managed</Select.Item>
              <Select.Item value="staff" label="Staff">Staff</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>

        <div class="grid gap-1.5">
          <Label>Default group</Label>
          {#if data.groups.length > 0}
            <Select.Root
              type="single"
              value={defaultGroupId}
              onValueChange={(v) => (defaultGroupId = v ?? "")}
            >
              <Select.Trigger class="w-[200px]">
                <span data-slot="select-value">
                  {defaultGroupId
                    ? data.groups.find((g) => String(g.id) === defaultGroupId)?.name ?? "Select group"
                    : "None"}
                </span>
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="" label="None">None</Select.Item>
                {#each data.groups as group (group.id)}
                  <Select.Item value={String(group.id)} label={group.name}>{group.name}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
            <p class="text-sm text-muted-foreground">No groups available. Configure Dispatcharr first.</p>
          {/if}
        </div>

        <div class="grid gap-1.5">
          <Label>Default profile</Label>
          {#if data.profiles.length > 0}
            <Select.Root
              type="single"
              value={defaultProfileId}
              onValueChange={(v) => (defaultProfileId = v ?? "")}
            >
              <Select.Trigger class="w-[200px]">
                <span data-slot="select-value">
                  {defaultProfileId
                    ? data.profiles.find((p) => String(p.id) === defaultProfileId)?.name ?? "Select profile"
                    : "None"}
                </span>
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="" label="None">None</Select.Item>
                {#each data.profiles as profile (profile.id)}
                  <Select.Item value={String(profile.id)} label={profile.name}>{profile.name}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
            <p class="text-sm text-muted-foreground">No profiles available. Configure Dispatcharr first.</p>
          {/if}
        </div>
      </Card.Content>
      <Card.Footer>
        <Button type="submit" disabled={sectionSubmitting["provisioning"]}>
          {sectionSubmitting["provisioning"] ? "Saving..." : "Save"}
        </Button>
      </Card.Footer>
    </form>
  </Card.Root>

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
      <Card.Footer>
        <Button type="submit" disabled={sectionSubmitting["security"]}>
          {sectionSubmitting["security"] ? "Saving..." : "Save"}
        </Button>
      </Card.Footer>
    </form>
  </Card.Root>

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
            <Input id="audit_retention_days" name="audit_retention_days" type="number" min="1" value={data.audit.retentionDays} class="w-[120px]" />
            <span class="text-sm text-muted-foreground">days</span>
          </div>
          <p class="text-xs text-muted-foreground">Audit log entries older than this will be automatically purged.</p>
        </div>
      </Card.Content>
      <Card.Footer>
        <Button type="submit" disabled={sectionSubmitting["audit"]}>
          {sectionSubmitting["audit"] ? "Saving..." : "Save"}
        </Button>
      </Card.Footer>
    </form>
  </Card.Root>
</div>
