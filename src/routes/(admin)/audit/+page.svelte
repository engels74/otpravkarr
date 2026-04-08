<script lang="ts">
import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import * as Select from "$lib/components/ui/select";
import * as Table from "$lib/components/ui/table";
import type { AuditEntry } from "$lib/db/types";
import { cn } from "$lib/utils";
import { normalizeSqliteDatetime } from "$lib/utils/datetime";

interface Props {
  data: {
    entries: AuditEntry[];
    total: number;
    filters: {
      action: string | null;
      actor: string | null;
      after: string | null;
      before: string | null;
      page: number;
      limit: number;
    };
    totalPages: number;
    auditActions: string[];
  };
}

let { data }: Props = $props();

let expandedRows: Record<number, boolean> = $state({});
let actorSearchTimeout: ReturnType<typeof setTimeout> | undefined;
onDestroy(() => clearTimeout(actorSearchTimeout));
let actorSearchValue = $derived(data.filters.actor ?? "");
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toggleRow(id: number) {
  if (expandedRows[id]) {
    delete expandedRows[id];
  } else {
    expandedRows[id] = true;
  }
}

function localDateStartToIso(dateOnly: string): string | null {
  if (!DATE_ONLY_RE.test(dateOnly)) return null;
  const date = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function localDateEndToIso(dateOnly: string): string | null {
  if (!DATE_ONLY_RE.test(dateOnly)) return null;
  const date = new Date(`${dateOnly}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function syncDateFilterBounds(url: URL): void {
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  if (after) {
    const afterUtc = localDateStartToIso(after);
    if (afterUtc) {
      url.searchParams.set("afterUtc", afterUtc);
    } else {
      url.searchParams.delete("afterUtc");
    }
  } else {
    url.searchParams.delete("afterUtc");
  }

  if (before) {
    const beforeUtc = localDateEndToIso(before);
    if (beforeUtc) {
      url.searchParams.set("beforeUtc", beforeUtc);
    } else {
      url.searchParams.delete("beforeUtc");
    }
  } else {
    url.searchParams.delete("beforeUtc");
  }
}

function updateFilter(key: string, value: string | null) {
  const url = new URL(page.url);
  if (value) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  syncDateFilterBounds(url);
  if (key !== "page") {
    url.searchParams.delete("page");
  }
  goto(url.toString(), { replaceState: true, keepFocus: true });
}

function actionBadgeVariant(action: string): "default" | "secondary" | "destructive" {
  if (action.includes("failed") || action.includes("disabled")) return "destructive";
  if (action.includes("completed") || action.includes("login") || action.includes("provisioned"))
    return "default";
  return "secondary";
}

function formatTimestamp(ts: string): string {
  const d = new Date(normalizeSqliteDatetime(ts));
  if (Number.isNaN(d.getTime())) return ts;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function formatDetail(detail: string | null): string {
  if (!detail) return "";
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

let rangeStart = $derived((data.filters.page - 1) * data.filters.limit + 1);
let rangeEnd = $derived(Math.min(data.filters.page * data.filters.limit, data.total));
</script>

<svelte:head>
  <title>Audit Log — otpravkarr</title>
</svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-lg font-semibold text-foreground">Audit Log</h1>
    <p class="text-sm text-muted-foreground">System event history and activity trail.</p>
  </div>

  <!-- ─── Filters ──────────────────────────────────────── -->
  <div class="flex flex-wrap items-end gap-3">
    <div class="grid gap-1.5">
      <Label class="text-xs text-foreground">Action</Label>
      <Select.Root
        type="single"
        value={data.filters.action ?? "all"}
        onValueChange={(v) => updateFilter("action", v === "all" ? null : v)}
      >
        <Select.Trigger class="w-48 text-foreground">
          <span data-slot="select-value">
            {data.filters.action ?? "All Actions"}
          </span>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="all" label="All Actions" />
          {#each data.auditActions as action (action)}
            <Select.Item value={action} label={action} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="grid gap-1.5">
      <Label class="text-xs text-foreground">Actor</Label>
      <Input
        placeholder="Filter by actor…"
        class="h-8 w-40"
        value={actorSearchValue}
        oninput={(e) => {
          const val = (e.currentTarget as HTMLInputElement).value;
          actorSearchValue = val;
          clearTimeout(actorSearchTimeout);
          actorSearchTimeout = setTimeout(() => updateFilter("actor", val.trim() || null), 300);
        }}
      />
    </div>

    <div class="grid gap-1.5">
      <Label class="text-xs text-foreground">After</Label>
      <Input
        type="date"
        class="h-8 w-36"
        aria-label="Filter after date"
        value={data.filters.after ?? ""}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          updateFilter("after", v || null);
        }}
      />
    </div>

    <div class="grid gap-1.5">
      <Label class="text-xs text-foreground">Before</Label>
      <Input
        type="date"
        class="h-8 w-36"
        aria-label="Filter before date"
        value={data.filters.before ?? ""}
        onchange={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          updateFilter("before", v || null);
        }}
      />
    </div>
  </div>

  <!-- ─── Table ────────────────────────────────────────── -->
  <div class="overflow-x-auto rounded-lg border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="w-8"></Table.Head>
          <Table.Head class="whitespace-nowrap font-mono text-xs">Timestamp</Table.Head>
          <Table.Head class="text-xs">Actor</Table.Head>
          <Table.Head class="text-xs">Action</Table.Head>
          <Table.Head class="text-xs">IP Address</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if data.entries.length === 0}
          <Table.Row>
            <Table.Cell colspan={5} class="h-24 text-center text-sm text-muted-foreground">
              No audit log entries found.
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each data.entries as entry (entry.id)}
            {@const isExpanded = expandedRows[entry.id] === true}
            <Table.Row
              class={entry.detail ? "cursor-pointer" : ""}
              onclick={() => entry.detail && toggleRow(entry.id)}
            >
              <Table.Cell class="w-8 px-2">
                {#if entry.detail}
                  <ChevronDownIcon
                    class={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform",
                      isExpanded && "rotate-0",
                      !isExpanded && "-rotate-90"
                    )}
                  />
                {:else}
                  <span class="text-xs text-muted-foreground/40">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {formatTimestamp(entry.timestamp)}
              </Table.Cell>
              <Table.Cell class="text-sm text-foreground">
                {entry.actor ?? "system"}
              </Table.Cell>
              <Table.Cell>
                <Badge variant={actionBadgeVariant(entry.action)} class="text-[10px]">
                  {entry.action}
                </Badge>
              </Table.Cell>
              <Table.Cell class="font-mono text-xs text-muted-foreground">
                {entry.ip_address ?? "—"}
              </Table.Cell>
            </Table.Row>
            {#if isExpanded && entry.detail}
              <Table.Row>
                <Table.Cell colspan={5} class="bg-muted/50 px-4 py-3">
                  <pre class="text-xs font-mono whitespace-pre-wrap break-all text-foreground">{formatDetail(entry.detail)}</pre>
                </Table.Cell>
              </Table.Row>
            {/if}
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>

  <!-- ─── Pagination ───────────────────────────────────── -->
  {#if data.total > 0}
    <div class="flex items-center justify-between text-sm">
      <span class="text-muted-foreground">
        Showing {rangeStart}–{rangeEnd} of {data.total} entries
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={data.filters.page <= 1}
          onclick={() => updateFilter("page", String(data.filters.page - 1))}
        >
          <ChevronLeftIcon class="h-4 w-4" />
          Previous
        </Button>
        <span class="px-2 text-xs text-muted-foreground">
          Page {data.filters.page} of {data.totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={data.filters.page >= data.totalPages}
          onclick={() => updateFilter("page", String(data.filters.page + 1))}
        >
          Next
          <ChevronRightIcon class="h-4 w-4" />
        </Button>
      </div>
    </div>
  {/if}
</div>
