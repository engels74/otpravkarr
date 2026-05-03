<script lang="ts">
import { toast } from "svelte-sonner";
import { invalidateAll } from "$app/navigation";
import HealthBadge from "$lib/components/HealthBadge.svelte";
import * as Avatar from "$lib/components/ui/avatar";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Separator } from "$lib/components/ui/separator";
import * as Table from "$lib/components/ui/table";
import type { AuditEntry, ProvisioningMode } from "$lib/db/types";
import type { PlexFriend } from "$lib/plex/types";
import type { HealthStatus } from "$lib/scheduler/jobs/health";
import type { JobStatus } from "$lib/scheduler/runner";
import { setHealthStatus } from "$lib/state/health.svelte";
import { normalizeSqliteDatetime } from "$lib/utils/datetime";

interface Props {
  data: {
    userStats: {
      total: number;
      active: number;
      inactive: number;
      orphaned: number;
      byMode: Record<ProvisioningMode, number>;
    };
    health: HealthStatus;
    syncJob: JobStatus | null;
    healthJob: JobStatus | null;
    recentAudit: AuditEntry[];
    availableFriends: PlexFriend[] | null;
  };
}

let { data }: Props = $props();

let plexHealthy = $derived(data.health.plex.status === "healthy");
let dispatcharrHealthy = $derived(
  data.health.dispatcharr.reachable && data.health.dispatcharr.authValid,
);
let dbHealthy = $derived(data.health.database.status === "healthy");

$effect(() => {
  setHealthStatus(data.health);
});

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const date = new Date(normalizeSqliteDatetime(isoString));
  if (Number.isNaN(date.getTime())) return "unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(ts: number | null): string {
  if (ts == null) return "never";
  return formatRelativeTime(new Date(ts).toISOString());
}

function auditActionBadge(action: string): {
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (action.includes("failed") || action.includes("disabled")) return { variant: "destructive" };
  if (action.includes("completed") || action.includes("login") || action.includes("provisioned"))
    return { variant: "default" };
  return { variant: "secondary" };
}

function friendInitials(f: PlexFriend): string {
  const name = f.username ?? f.friendlyName ?? f.title ?? f.email;
  return name.slice(0, 2).toUpperCase();
}

let triggeringSync = $state(false);
let syncRunning = $derived(triggeringSync || (data.syncJob?.running ?? false));

async function runSyncNow() {
  if (triggeringSync) return;
  triggeringSync = true;
  try {
    const response = await fetch("/api/internal/sync", { method: "POST" });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
      report?: { errors?: unknown[] };
    } | null;
    if (response.status === 409) {
      toast.error("Sync already in progress.");
    } else if (response.status === 503 && body?.error === "missing_config") {
      toast.error("Sync cannot run: missing configuration.");
    } else if (!response.ok) {
      toast.error(body?.message ?? "Sync failed.");
    } else if (Array.isArray(body?.report?.errors) && body.report.errors.length > 0) {
      toast.warning(`Sync completed with ${body.report.errors.length} error(s). See audit log.`);
    } else {
      toast.success("Sync completed.");
    }
  } catch {
    toast.error("Sync request failed.");
  } finally {
    // invalidate first so data.syncJob.running reflects the post-sync state
    // before we re-enable the button — otherwise a fast double-click could
    // fire a second POST in the brief window between flag flip and reload.
    await invalidateAll();
    triggeringSync = false;
  }
}
</script>

<svelte:head>
  <title>Dashboard — otpravkarr</title>
</svelte:head>

<div class="space-y-6">
  <!-- ─── Page header ────────────────────────────────────── -->
  <div>
    <p class="eyebrow">DASHBOARD</p>
    <h1 class="font-display text-4xl font-normal tracking-tight leading-[1.05] mt-1">Overview.</h1>
  </div>

  <!-- ─── Health Status ──────────────────────────────────── -->
  <div class="grid gap-4 sm:grid-cols-3">
    <!-- Plex -->
    <div class="kpi-tile">
      <div class="flex min-w-0 items-center justify-between">
        <span class="eyebrow truncate">Plex</span>
        <span
          class={`ml-2 h-2 w-2 shrink-0 rounded-full ${plexHealthy ? "bg-green-500" : "bg-destructive"}`}
          aria-hidden="true"
        ></span>
      </div>
      <HealthBadge type="plex" status={data.health.plex.status} class="w-fit" />
      <span class="text-xs text-muted-foreground">
        Checked {formatRelativeTime(data.health.plex.lastChecked)}
      </span>
    </div>

    <!-- Dispatcharr -->
    <div class="kpi-tile">
      <div class="flex min-w-0 items-center justify-between">
        <span class="eyebrow truncate">Dispatcharr</span>
        <span
          class={`ml-2 h-2 w-2 shrink-0 rounded-full ${dispatcharrHealthy ? "bg-green-500" : "bg-destructive"}`}
          aria-hidden="true"
        ></span>
      </div>
      <HealthBadge
        type="dispatcharr"
        status=""
        reachable={data.health.dispatcharr.reachable}
        authValid={data.health.dispatcharr.authValid}
        class="w-fit"
      />
      <span class="text-xs text-muted-foreground">
        Checked {formatRelativeTime(data.health.dispatcharr.lastChecked)}
      </span>
    </div>

    <!-- SQLite -->
    <div class="kpi-tile">
      <div class="flex min-w-0 items-center justify-between">
        <span class="eyebrow truncate">SQLite</span>
        <span
          class={`ml-2 h-2 w-2 shrink-0 rounded-full ${dbHealthy ? "bg-green-500" : "bg-destructive"}`}
          aria-hidden="true"
        ></span>
      </div>
      <HealthBadge type="database" status={data.health.database.status} class="w-fit" />
      <span class="text-xs text-muted-foreground">
        Checked {formatRelativeTime(data.health.database.lastChecked)}
      </span>
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- ─── User Stats ──────────────────────────────────── -->
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">Users</Card.Title>
      </Card.Header>
      <Card.Content>
        <div class="grid grid-cols-4 gap-4 text-center">
          <div>
            <div class="text-2xl font-semibold">{data.userStats.total}</div>
            <div class="text-xs text-muted-foreground">Total</div>
          </div>
          <div>
            <div class="text-2xl font-semibold text-green-600 dark:text-green-400">{data.userStats.active}</div>
            <div class="text-xs text-muted-foreground">Active</div>
          </div>
          <div>
            <div class="text-2xl font-semibold text-muted-foreground">{data.userStats.inactive}</div>
            <div class="text-xs text-muted-foreground">Inactive</div>
          </div>
          <div>
            <div class={`text-2xl font-semibold ${data.userStats.orphaned > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{data.userStats.orphaned}</div>
            <div class="text-xs text-muted-foreground">Orphaned</div>
          </div>
        </div>

        <Separator class="my-4" />

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Automatic</span>
            <span class="font-medium">{data.userStats.byMode.automatic}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Self-managed</span>
            <span class="font-medium">{data.userStats.byMode.self_managed}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Staff</span>
            <span class="font-medium">{data.userStats.byMode.staff}</span>
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- ─── Sync Status ─────────────────────────────────── -->
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">Sync Status</Card.Title>
      </Card.Header>
      <Card.Content>
        {#if data.syncJob}
          <div class="space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Status</span>
              {#if syncRunning}
                <Badge variant="default">Running</Badge>
              {:else}
                <Badge variant="secondary">Idle</Badge>
              {/if}
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Last Run</span>
              <span class="font-medium">{formatTimestamp(data.syncJob.lastRunAt)}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Duration</span>
              <span class="font-medium">
                {data.syncJob.lastDurationMs != null ? `${data.syncJob.lastDurationMs}ms` : "—"}
              </span>
            </div>
          </div>

          <Separator class="my-4" />

          <div class="flex items-center justify-between gap-3">
            <div class="text-xs text-muted-foreground">
              Health check: {#if data.healthJob}
                {data.healthJob.running ? "running" : formatTimestamp(data.healthJob.lastRunAt)}
              {:else}
                not registered
              {/if}
            </div>
            <Button
              size="sm"
              onclick={runSyncNow}
              disabled={syncRunning}
            >
              {syncRunning ? "Syncing…" : "Run sync now"}
            </Button>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">Sync job not registered.</p>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- ─── Recent Activity ─────────────────────────────── -->
    <Card.Root>
      <Card.Header class="flex flex-row items-center justify-between">
        <Card.Title class="text-base">Recent Activity</Card.Title>
        <a
          href="/audit"
          class="text-xs text-muted-foreground hover:text-foreground"
        >
          View all →
        </a>
      </Card.Header>
      <Card.Content class="px-0">
        {#if data.recentAudit.length > 0}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="pl-6">Time</Table.Head>
                <Table.Head>Actor</Table.Head>
                <Table.Head>Action</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each data.recentAudit as entry (entry.id)}
                {@const actionBadge = auditActionBadge(entry.action)}
                <Table.Row>
                  <Table.Cell class="pl-6 text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelativeTime(entry.timestamp)}
                  </Table.Cell>
                  <Table.Cell class="text-sm">
                    {entry.actor ?? "system"}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={actionBadge.variant} class="text-[10px]">
                      {entry.action}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {:else}
          <p class="px-6 text-sm text-muted-foreground">No recent activity.</p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- ─── Available Plex Friends ──────────────────────── -->
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">Available Plex Friends</Card.Title>
        <Card.Description>Accepted friends not yet mapped</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if data.availableFriends == null}
          <p class="text-sm text-muted-foreground">
            Friends cache is empty. Data will populate after the next sync.
          </p>
        {:else if data.availableFriends.length === 0}
          <p class="text-sm text-muted-foreground">
            All accepted friends are already mapped.
          </p>
        {:else}
          <p class="mb-3 text-sm text-muted-foreground">
            Friends listed here will be automatically provisioned when they sign in to the portal via Plex.
          </p>
          <ul class="space-y-3">
            {#each data.availableFriends as friend (friend.id)}
              <li class="flex items-center gap-3">
                <Avatar.Root size="sm">
                  {#if friend.thumb}
                    <Avatar.Image src={friend.thumb} alt={friend.username ?? friend.email} />
                  {/if}
                  <Avatar.Fallback class="text-[10px]">{friendInitials(friend)}</Avatar.Fallback>
                </Avatar.Root>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate">
                    {friend.username ?? friend.friendlyName ?? friend.title ?? "Unknown"}
                  </div>
                  <div class="text-xs text-muted-foreground truncate">{friend.email}</div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>
