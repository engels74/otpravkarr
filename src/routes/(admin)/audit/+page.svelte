<script lang="ts">
import { type DateValue, parseDate } from "@internationalized/date";
import CalendarIcon from "lucide-svelte/icons/calendar";
import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
import XIcon from "lucide-svelte/icons/x";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Calendar } from "$lib/components/ui/calendar";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import * as Popover from "$lib/components/ui/popover";
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
// svelte-ignore state_referenced_locally
let actorSearchValue = $state(data.filters.actor ?? "");
$effect(() => {
  actorSearchValue = data.filters.actor ?? "";
});
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

function actionBadgeClasses(action: string): string {
  if (action.includes("failed") || action.includes("disabled"))
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-transparent";
  if (
    action.includes("completed") ||
    action.includes("login") ||
    action.includes("provisioned") ||
    action.includes("rotated")
  )
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-transparent";
  if (action.includes("started"))
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-transparent";
  return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border-transparent";
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatTimestamp(ts: string): string {
  const d = new Date(normalizeSqliteDatetime(ts));
  if (Number.isNaN(d.getTime())) return ts;
  const parts = TIMESTAMP_FORMATTER.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function formatDetail(detail: string | null): string {
  if (!detail) return "";
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

function detailToggleLabel(entry: AuditEntry, isExpanded: boolean): string {
  const action = isExpanded ? "Collapse" : "Expand";
  return `${action} detail for ${entry.action} at ${formatTimestamp(entry.timestamp)}`;
}

let rangeStart = $derived((data.filters.page - 1) * data.filters.limit + 1);
let rangeEnd = $derived(Math.min(data.filters.page * data.filters.limit, data.total));

function parseDateOrUndefined(value: string | null): DateValue | undefined {
  if (!value || !DATE_ONLY_RE.test(value)) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}

let afterPopoverOpen = $state(false);
let beforePopoverOpen = $state(false);
let afterDate = $derived(parseDateOrUndefined(data.filters.after));
let beforeDate = $derived(parseDateOrUndefined(data.filters.before));

function formatDateLabel(value: DateValue | undefined): string {
  if (!value) return "";
  // ISO YYYY-MM-DD; toString returns "YYYY-MM-DD" for CalendarDate.
  return value.toString();
}
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
      <Label for="audit-action-filter" class="text-xs text-foreground">Action</Label>
      <Select.Root
        type="single"
        value={data.filters.action ?? "all"}
        onValueChange={(v) => updateFilter("action", v === "all" ? null : v)}
      >
        <Select.Trigger id="audit-action-filter" aria-label="Filter by action type" class="w-48 text-foreground">
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
      <Label for="audit-actor-filter" class="text-xs text-foreground">Actor</Label>
      <Input
        id="audit-actor-filter"
        aria-label="Filter by actor"
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
      <Label for="audit-limit-filter" class="text-xs text-foreground">Per page</Label>
      <Select.Root
        type="single"
        value={String(data.filters.limit)}
        onValueChange={(v) => updateFilter("limit", v)}
      >
        <Select.Trigger id="audit-limit-filter" aria-label="Entries per page" class="w-24 text-foreground">
          <span data-slot="select-value">
            {data.filters.limit}
          </span>
        </Select.Trigger>
        <Select.Content>
          {#each [10, 25, 50, 100] as n (n)}
            <Select.Item value={String(n)} label={String(n)} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="grid gap-1.5">
      <div class="flex items-center justify-between">
        <Label class="text-xs text-foreground">After</Label>
        {#if afterDate}
          <Button
            variant="ghost"
            size="sm"
            class="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear after date filter"
            onclick={() => {
              afterPopoverOpen = false;
              updateFilter("after", null);
            }}
          >
            <XIcon class="h-3 w-3" />
          </Button>
        {/if}
      </div>
      <Popover.Root bind:open={afterPopoverOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              variant="outline"
              size="sm"
              class={cn("h-8 w-36 justify-start font-normal", !afterDate && "text-muted-foreground")}
              aria-label="Filter after date"
              {...props}
            >
              <CalendarIcon class="mr-2 h-3.5 w-3.5" />
              {afterDate ? formatDateLabel(afterDate) : "Pick date"}
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-auto p-0" align="start">
          <Calendar
            type="single"
            value={afterDate as never}
            onValueChange={(v) => {
              updateFilter("after", v ? formatDateLabel(v) : null);
              afterPopoverOpen = false;
            }}
          />
        </Popover.Content>
      </Popover.Root>
    </div>

    <div class="grid gap-1.5">
      <div class="flex items-center justify-between">
        <Label class="text-xs text-foreground">Before</Label>
        {#if beforeDate}
          <Button
            variant="ghost"
            size="sm"
            class="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear before date filter"
            onclick={() => {
              beforePopoverOpen = false;
              updateFilter("before", null);
            }}
          >
            <XIcon class="h-3 w-3" />
          </Button>
        {/if}
      </div>
      <Popover.Root bind:open={beforePopoverOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              variant="outline"
              size="sm"
              class={cn("h-8 w-36 justify-start font-normal", !beforeDate && "text-muted-foreground")}
              aria-label="Filter before date"
              {...props}
            >
              <CalendarIcon class="mr-2 h-3.5 w-3.5" />
              {beforeDate ? formatDateLabel(beforeDate) : "Pick date"}
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-auto p-0" align="start">
          <Calendar
            type="single"
            value={beforeDate as never}
            onValueChange={(v) => {
              updateFilter("before", v ? formatDateLabel(v) : null);
              beforePopoverOpen = false;
            }}
          />
        </Popover.Content>
      </Popover.Root>
    </div>
  </div>

  <!-- ─── Table ────────────────────────────────────────── -->
  <div class="scroll-hint-x overflow-x-auto rounded-lg border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="w-8"><span class="sr-only">Details</span></Table.Head>
          <Table.Head class="whitespace-nowrap font-mono text-xs">Timestamp</Table.Head>
          <Table.Head class="hidden lg:table-cell text-xs">Actor</Table.Head>
          <Table.Head class="text-xs">Action</Table.Head>
          <Table.Head class="hidden md:table-cell text-xs">IP Address</Table.Head>
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
              {#if entry.detail}
                <Table.Cell class="w-8 px-2">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center bg-transparent border-none p-0 cursor-pointer"
                    aria-expanded={isExpanded}
                    aria-label={detailToggleLabel(entry, isExpanded)}
                    onclick={(e: MouseEvent) => { e.stopPropagation(); toggleRow(entry.id); }}
                  >
                    <ChevronDownIcon
                      class={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        isExpanded && "rotate-0",
                        !isExpanded && "-rotate-90"
                      )}
                    />
                  </button>
                </Table.Cell>
              {:else}
                <Table.Cell class="w-8 px-2" aria-hidden="true" />
              {/if}
              <Table.Cell class="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {formatTimestamp(entry.timestamp)}
              </Table.Cell>
              <Table.Cell class="hidden lg:table-cell text-sm text-foreground">
                {entry.actor ?? "system"}
              </Table.Cell>
              <Table.Cell>
                <Badge variant="outline" class={cn("text-[10px]", actionBadgeClasses(entry.action))}>
                  {entry.action}
                </Badge>
              </Table.Cell>
              <Table.Cell class="hidden md:table-cell font-mono text-xs text-muted-foreground">
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
