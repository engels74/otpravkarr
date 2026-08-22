<script lang="ts">
import SearchIcon from "@lucide/svelte/icons/search";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";

export interface PickerGroup {
  id: number;
  name: string;
  channelCount: number | null;
}

interface Props {
  groups: PickerGroup[];
  /** Bindable set of selected group ids. */
  selected: Set<number>;
  /** Cap on rows rendered at once so the list stays responsive at scale. */
  renderCap?: number;
  disabled?: boolean;
  /**
   * When false, the list grows to its natural height and the caller owns
   * scrolling — used by the users Change Group dialog so there is a single
   * scroll region plus a sticky Save footer (ISSUE-001). Defaults to true,
   * which keeps the self-contained max-height scroll the full-page call sites
   * (settings, subscription, onboarding) rely on.
   */
  scrollList?: boolean;
}

let {
  groups,
  selected = $bindable(),
  renderCap = 300,
  disabled = false,
  scrollList = true,
}: Props = $props();

let query = $state("");

const normalizedQuery = $derived(query.trim().toLowerCase());
const filtered = $derived(
  normalizedQuery ? groups.filter((g) => g.name.toLowerCase().includes(normalizedQuery)) : groups,
);
const visible = $derived(filtered.slice(0, renderCap));
const hiddenCount = $derived(filtered.length - visible.length);

const listClass = $derived(
  scrollList
    ? "max-h-[28rem] overflow-y-auto rounded-md border border-border"
    : "rounded-md border border-border",
);

// Roving tabindex (ISSUE-002): the whole list is a single tab stop instead of
// one stop per checkbox, so Save stays a bounded number of Tabs away regardless
// of group count. `activeIndex` is the row the user last landed on; `activeRow`
// clamps it into range so a valid tab stop always exists as the filtered list
// shrinks. Space toggles natively; Enter and Arrow keys are handled below.
let activeIndex = $state(0);
let listEl = $state<HTMLElement | null>(null);
const activeRow = $derived(
  visible.length > 0 ? Math.min(Math.max(activeIndex, 0), visible.length - 1) : 0,
);

// When the search query changes the collection, reset the active row to the
// first visible row so the tab stop never lands on a filtered-out item
// (Critic MAJOR: no lost tab stop / focus trap).
$effect(() => {
  normalizedQuery;
  activeIndex = 0;
});

function focusRow(index: number): void {
  const inputs = listEl?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  inputs?.[index]?.focus();
}

function onRowKeydown(event: KeyboardEvent): void {
  if (disabled || visible.length === 0) return;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusRow(Math.min(activeRow + 1, visible.length - 1));
      break;
    case "ArrowUp":
      event.preventDefault();
      focusRow(Math.max(activeRow - 1, 0));
      break;
    case "Home":
      event.preventDefault();
      focusRow(0);
      break;
    case "End":
      event.preventDefault();
      focusRow(visible.length - 1);
      break;
    case "Enter": {
      // A native checkbox toggles on Space but not Enter; make Enter match.
      event.preventDefault();
      const group = visible[activeRow];
      if (group) toggle(group.id);
      break;
    }
  }
}

function toggle(id: number): void {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selected = next;
}

function selectFiltered(): void {
  const next = new Set(selected);
  for (const g of filtered) next.add(g.id);
  selected = next;
}

function clearFiltered(): void {
  const next = new Set(selected);
  for (const g of filtered) next.delete(g.id);
  selected = next;
}
</script>

<div class="min-w-0 space-y-3">
  <div class="relative">
    <SearchIcon
      class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      type="search"
      placeholder="Search channel groups…"
      bind:value={query}
      class="pl-8"
      aria-label="Search channel groups"
      {disabled}
    />
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="min-w-0 text-sm text-muted-foreground">
      {selected.size} selected · {groups.length} available
    </p>
    {#if !disabled}
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onclick={selectFiltered}>
          Select {normalizedQuery ? "filtered" : "all"}
        </Button>
        <Button type="button" variant="outline" size="sm" onclick={clearFiltered}>
          Clear {normalizedQuery ? "filtered" : "all"}
        </Button>
      </div>
    {/if}
  </div>

  <div class={listClass}>
    {#if filtered.length === 0}
      <p class="px-3 py-6 text-center text-sm text-muted-foreground">
        {groups.length === 0 ? "No channel groups available." : `No groups match “${query}”.`}
      </p>
    {:else}
      <ul bind:this={listEl} role="group" aria-label="Channel groups">
        {#each visible as group, i (group.id)}
          <li class="border-b border-border last:border-b-0">
            <label
              class="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40"
              class:cursor-pointer={!disabled}
            >
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-border accent-primary"
                checked={selected.has(group.id)}
                tabindex={i === activeRow ? 0 : -1}
                onchange={() => toggle(group.id)}
                onfocus={() => (activeIndex = i)}
                onkeydown={onRowKeydown}
                {disabled}
              />
              <span class="min-w-0 flex-1 truncate text-sm text-foreground">{group.name}</span>
              {#if group.channelCount != null}
                <span class="shrink-0 text-xs text-muted-foreground">
                  {group.channelCount}
                  {group.channelCount === 1 ? "channel" : "channels"}
                </span>
              {/if}
            </label>
          </li>
        {/each}
      </ul>
      {#if hiddenCount > 0}
        <p class="px-3 py-2.5 text-center text-xs text-muted-foreground">
          Showing {visible.length} of {filtered.length}. Refine your search to see the rest.
        </p>
      {/if}
    {/if}
  </div>
</div>
