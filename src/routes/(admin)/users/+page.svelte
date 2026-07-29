<script lang="ts">
import type { ActionResult } from "@sveltejs/kit";
import BanIcon from "lucide-svelte/icons/ban";
import CheckCircle2Icon from "lucide-svelte/icons/check-circle-2";
import EllipsisIcon from "lucide-svelte/icons/ellipsis";
import InfoIcon from "lucide-svelte/icons/info";
import KeyRoundIcon from "lucide-svelte/icons/key-round";
import LayersIcon from "lucide-svelte/icons/layers";
import Trash2Icon from "lucide-svelte/icons/trash-2";
import UsersIcon from "lucide-svelte/icons/users";
import { toast } from "svelte-sonner";
import { applyAction, enhance } from "$app/forms";
import { invalidateAll } from "$app/navigation";

import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
import GroupPicker from "$lib/components/GroupPicker.svelte";
import StatusBadge from "$lib/components/StatusBadge.svelte";
import * as Avatar from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { Separator } from "$lib/components/ui/separator";
import * as Table from "$lib/components/ui/table";
import type { LineupPolicy, UserMapping } from "$lib/db/types";

import { normalizeSqliteDatetime } from "$lib/utils/datetime";
import { copyOtpToClipboard } from "./otp-clipboard";

type ModeFilter = "all" | "automatic" | "self-managed" | "self_managed" | "staff";
type EnhanceUpdate = (options?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;

interface PolicyResolution {
  policy: LineupPolicy;
  effectiveGroupIds: number[];
  selectedBundleIds: string[];
  selectedApprovedGroupIds: number[];
  materializedGroupIds: number[];
  assignmentDrift: boolean;
  orphanBundleIds: string[];
  orphanApprovedGroupIds: number[];
}

interface Props {
  data: {
    mappings: UserMapping[];
    groups: { id: number; name: string; channelCount: number | null }[];
    profiles: { id: number; name: string }[];
    driftByMappingId: Record<number, boolean>;
    filters: { status: string; mode: string; search: string };
    policySettings: {
      defaultPolicy: LineupPolicy;
      fixedGroupIds: number[];
      coreGroupIds: number[];
      approvedGroupIds: number[] | null;
    };
    lineupBundles: { id: string; slug: string; displayName: string; groupIds: number[] }[];
    policyByMappingId: Record<number, PolicyResolution>;
  };
}

let { data }: Props = $props();

let submitting = $state(false);
// svelte-ignore state_referenced_locally
let mappings = $state<UserMapping[]>(data.mappings);
$effect(() => {
  mappings = data.mappings;
});

// Dialog state
let groupDialogOpen = $state(false);
let profileDialogOpen = $state(false);
let detailDialogOpen = $state(false);
let passwordDialogOpen = $state(false);
let disableDialogOpen = $state(false);
let rotateDialogOpen = $state(false);
let deleteDialogOpen = $state(false);
let selectedMapping = $state<UserMapping | null>(null);
let selectedGroupSet = $state(new Set<number>());
let lockEnabled = $state(false);
let selectedPolicyOverride = $state<LineupPolicy | "">("");
let selectedBundleSet = $state(new Set<string>());
// Inline confirmation shown inside the still-open Change Group dialog after a
// successful lock save. The success toast fires too, but the dialog can inert the
// toaster's aria-live region, so this in-dialog role=status guarantees a visible +
// announced confirmation (ISSUE-005). Reset on dialog open and on any toggle.
let lockSaved = $state(false);
let selectedProfileId = $state<number | null>(null);
// Grouped subscribers (>=1 channel group) derive their Dispatcharr scope from
// those groups: subscription-sync nulls dispatcharr_profile_id for them, so a
// concrete profile set via changeProfile is reverted on the next sync/group op.
// The Change Profile control is therefore a foot-gun for them — surfaced and
// disabled below rather than silently overwritten (ISSUE-004).
let selectedMappingGroupCount = $derived.by(() => {
  if (!selectedMapping) return 0;
  try {
    const parsed: unknown = JSON.parse(selectedMapping.dispatcharr_group_ids);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "number").length : 0;
  } catch {
    return 0;
  }
});
let approvedGroups = $derived(
  data.policySettings.approvedGroupIds == null
    ? []
    : data.groups.filter((group) => data.policySettings.approvedGroupIds?.includes(group.id)),
);
let disablingMapping = $state<UserMapping | null>(null);
let rotatingMapping = $state<UserMapping | null>(null);
let deletingMapping = $state<UserMapping | null>(null);
let oneTimePassword = $state("");
let passwordCopyStatus = $state<"idle" | "copied" | "failed">("idle");
// Drives the OTP dialog copy: false = first-time provisioning (owner subscribe /
// automatic), true = re-provisioning (disable→enable). Set in BOTH enhance handlers
// so a prior re-enable can't leave a stale `true` for a later owner subscribe (ISSUE-002).
let passwordReprovisioned = $state(false);

// svelte-ignore state_referenced_locally
let statusFilter = $state(data.filters.status);
// svelte-ignore state_referenced_locally
let modeFilter = $state<ModeFilter>(data.filters.mode as ModeFilter);
$effect(() => {
  statusFilter = data.filters.status;
});
$effect(() => {
  modeFilter = data.filters.mode as ModeFilter;
});

// Clear the pending rotate target whenever the confirm dialog closes (confirm,
// cancel, or dismiss) so a stale mapping never leaks into a later dialog.
$effect(() => {
  if (!rotateDialogOpen) {
    rotatingMapping = null;
  }
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

function filterHref(key: "status" | "mode" | "search", value: string): string {
  const params = new URLSearchParams();
  if (data.filters.status !== "all") params.set("status", data.filters.status);
  if (data.filters.mode !== "all") params.set("mode", data.filters.mode);
  const search = data.filters.search.trim();
  if (search) params.set("search", search);

  if (value === "all" || value === "") {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const qs = params.toString();
  return `/users${qs ? `?${qs}` : ""}`;
}

function filterLinkClass(active: boolean): string {
  const base =
    "inline-flex h-8 items-center rounded-lg border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return active
    ? `${base} border-primary/40 bg-primary/15 text-primary`
    : `${base} border-input bg-transparent text-foreground hover:bg-muted`;
}

const statusFilterOptions = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "orphaned", label: "Orphaned" },
];

const modeFilterOptions: { value: ModeFilter; label: string }[] = [
  { value: "all", label: "All modes" },
  { value: "automatic", label: "Automatic" },
  { value: "self-managed", label: "Self-managed" },
  { value: "staff", label: "Staff" },
];

function refreshPageData(update?: EnhanceUpdate): void {
  void update?.({ reset: false, invalidateAll: false });
  void invalidateAll();
}

function patchLocalMapping(id: number, updates: Partial<UserMapping>) {
  mappings = mappings.map((m) => (m.id === id ? { ...m, ...updates } : m));
  if (selectedMapping?.id === id) {
    selectedMapping = { ...selectedMapping, ...updates };
  }
}

function appendLocalMapping(mapping: UserMapping) {
  if (mappings.some((m) => m.id === mapping.id)) {
    patchLocalMapping(mapping.id, mapping);
    return;
  }
  mappings = [...mappings, mapping];
}

function getStatus(m: UserMapping): "active" | "inactive" | "orphaned" {
  if (m.is_active === 0) return "inactive";
  if (m.dispatcharr_user_id == null) return "orphaned";
  return "active";
}

function canDeleteLocalMapping(m: UserMapping): boolean {
  return m.dispatcharr_user_id == null && m.dispatcharr_xc_password_enc == null;
}

function openGroupDialog(m: UserMapping) {
  selectedMapping = m;
  const policy = data.policyByMappingId[m.id];
  selectedGroupSet = new Set(
    policy?.selectedApprovedGroupIds ?? parseGroupIds(m.dispatcharr_group_ids),
  );
  selectedPolicyOverride = m.lineup_policy_override ?? "";
  selectedBundleSet = new Set(policy?.selectedBundleIds ?? []);
  lockEnabled = m.group_selection_locked === 1;
  lockSaved = false;
  groupDialogOpen = true;
}

function parseGroupIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === "number")
      : [];
  } catch {
    return [];
  }
}

function openProfileDialog(m: UserMapping) {
  selectedMapping = m;
  selectedProfileId = m.dispatcharr_profile_id ?? null;
  profileDialogOpen = true;
}

function openDetailDialog(m: UserMapping) {
  selectedMapping = m;
  detailDialogOpen = true;
}

function makeEnhanceHandler() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: EnhanceUpdate }) => {
      try {
        if (result.type === "success") {
          const d = result.data as { groupIds?: number[]; profileId?: number | null } | undefined;
          if (selectedMapping && d?.groupIds) {
            patchLocalMapping(selectedMapping.id, {
              dispatcharr_group_ids: JSON.stringify(d.groupIds),
              dispatcharr_profile_id: d.profileId ?? null,
            });
          }
          toast.success("Group updated successfully.");
          groupDialogOpen = false;
          refreshPageData(update);
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to update group.",
          );
          refreshPageData(update);
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
      }
    };
  };
}

function makeGroupLockEnhanceHandler() {
  return () => {
    submitting = true;
    return async ({
      result,
      update,
    }: {
      result: ActionResult;
      update: (options?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;
    }) => {
      try {
        if (result.type === "success") {
          toast.success("Lock updated.");
          // Also surface the in-dialog confirmation (ISSUE-005).
          lockSaved = true;
          // ISSUE-001: this lock <form> stays open after save (the handler does
          // not close the dialog), so the default reset:true would run form.reset()
          // and visibly revert the just-toggled `locked` checkbox to unchecked.
          // The form only holds persisted state, so reset:false keeps the saved
          // value (which equals what setGroupLock persisted verbatim).
          await update({ reset: false });
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to update lock.",
          );
          await update({ reset: false });
          // On a rejected save the attempted toggle was NOT persisted, so restore
          // the authoritative stored value instead of leaving the optimistic toggle
          // (or letting form.reset() force it unchecked). update() above keeps the
          // default invalidateAll, so mappings has just been reloaded from the
          // server — read the live row (not the once-captured openGroupDialog
          // snapshot) so this stays correct even after an earlier successful save in
          // the same still-open dialog.
          lockEnabled =
            mappings.find((mm) => mm.id === selectedMapping?.id)?.group_selection_locked === 1;
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
      }
    };
  };
}

function makeProfileEnhanceHandler() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: EnhanceUpdate }) => {
      try {
        if (result.type === "success") {
          const d = result.data as { profileId?: number | null } | undefined;
          if (selectedMapping && d?.profileId != null) {
            patchLocalMapping(selectedMapping.id, { dispatcharr_profile_id: d.profileId });
          }
          toast.success("Profile updated.");
          profileDialogOpen = false;
          refreshPageData(update);
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to update profile.",
          );
          refreshPageData(update);
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
      }
    };
  };
}

function makeOwnerEnhance() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: EnhanceUpdate }) => {
      try {
        if (result.type === "success") {
          const d = result.data as
            | { initialPassword?: string | null; mapping?: UserMapping }
            | undefined;
          if (d?.mapping) {
            appendLocalMapping(d.mapping);
          }
          if (d?.initialPassword) {
            oneTimePassword = d.initialPassword;
            passwordCopyStatus = "idle";
            passwordReprovisioned = false;
            passwordDialogOpen = true;
          } else {
            toast.success("Subscriber account created.");
          }
          refreshPageData(update);
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ??
              "Failed to create subscriber account.",
          );
          refreshPageData(update);
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
      }
    };
  };
}

function makeDisableEnhance() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      try {
        if (result.type === "success") {
          toast.success("User disabled.");
          await update();
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to disable user.",
          );
          await update();
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
        disableDialogOpen = false;
        disablingMapping = null;
      }
    };
  };
}

function makeEnableEnhance() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: EnhanceUpdate }) => {
      try {
        if (result.type === "success") {
          const d = result.data as
            | {
                initialPassword?: string;
                mappingId?: number;
                reprovisioned?: boolean;
                isActive?: number;
                dispatcharrUserId?: number | null;
                dispatcharrUsername?: string | null;
                groupIds?: number[];
                profileId?: number | null;
              }
            | undefined;
          const mappingId = selectedMapping?.id ?? d?.mappingId;
          if (mappingId) {
            const current = mappings.find((m) => m.id === mappingId) ?? selectedMapping;
            patchLocalMapping(mappingId, {
              is_active: d?.isActive ?? 1,
              dispatcharr_user_id: d?.dispatcharrUserId ?? current?.dispatcharr_user_id ?? null,
              dispatcharr_username: d?.dispatcharrUsername ?? current?.dispatcharr_username ?? null,
              dispatcharr_group_ids: JSON.stringify(d?.groupIds ?? []),
              dispatcharr_profile_id: d?.profileId ?? current?.dispatcharr_profile_id ?? null,
            });
          }
          if (d?.initialPassword) {
            oneTimePassword = d.initialPassword;
            passwordCopyStatus = "idle";
            passwordReprovisioned = true;
            passwordDialogOpen = true;
          } else if (d?.reprovisioned) {
            toast.success("User re-enabled. New credentials will rotate on next sync.");
          } else {
            toast.success("User enabled successfully.");
          }
          refreshPageData(update);
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to enable user.",
          );
          refreshPageData(update);
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
      }
    };
  };
}

function makeDeleteEnhance() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      try {
        if (result.type === "success") {
          toast.success("Local mapping deleted.");
          await update();
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ??
              "Failed to delete local mapping.",
          );
          await update();
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
        deleteDialogOpen = false;
        detailDialogOpen = false;
        deletingMapping = null;
        selectedMapping = null;
      }
    };
  };
}

async function rotateMappingCredentials(id: number) {
  if (submitting) return;

  submitting = true;
  try {
    const response = await fetch(`/api/internal/rotate-credentials/${id}`, {
      method: "POST",
    });

    if (response.ok) {
      toast.success("Credentials rotated successfully.");
      await invalidateAll();
      return;
    }

    let message = "Failed to rotate credentials.";
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the fallback message when the server does not return JSON.
    }
    toast.error(message);
  } catch {
    toast.error("Failed to rotate credentials.");
  } finally {
    submitting = false;
    rotateDialogOpen = false;
  }
}

async function copyOneTimePassword() {
  passwordCopyStatus = await copyOtpToClipboard(oneTimePassword);
}
</script>

<svelte:head>
  <title>Users — otpravkarr</title>
</svelte:head>

<div class="space-y-4">
  <div class="flex items-center justify-between gap-3">
    <h1 class="text-lg font-semibold text-foreground">Users</h1>
    <div class="flex items-center gap-3">
      <span class="text-sm text-muted-foreground">
        {mappings.length}
        {mappings.length === 1 ? "user" : "users"}
      </span>
      <form method="POST" action="?/subscribeOwner" use:enhance={makeOwnerEnhance()}>
        <Button type="submit" variant="outline" size="sm" disabled={submitting}>
          Subscribe myself
        </Button>
      </form>
    </div>
  </div>

  <!-- Filters bar -->
  <div class="flex flex-wrap items-center gap-3">
    <div role="group" aria-label="Filter users by status" class="flex flex-wrap gap-1.5">
      {#each statusFilterOptions as option}
        <a
          href={filterHref("status", option.value)}
          aria-current={statusFilter === option.value ? "true" : undefined}
          class={filterLinkClass(statusFilter === option.value)}
        >
          {option.label}
        </a>
      {/each}
    </div>

    <div role="group" aria-label="Filter users by provisioning mode" class="flex flex-wrap gap-1.5">
      {#each modeFilterOptions as option}
        <a
          href={filterHref("mode", option.value)}
          aria-current={modeFilter === option.value ? "true" : undefined}
          class={filterLinkClass(modeFilter === option.value)}
        >
          {option.label}
        </a>
      {/each}
    </div>

    <form
      method="GET"
      action="/users"
      role="search"
      aria-label="Search users"
      class="flex flex-wrap items-center gap-2"
    >
      {#if statusFilter !== "all"}
        <input type="hidden" name="status" value={statusFilter} />
      {/if}
      {#if modeFilter !== "all"}
        <input type="hidden" name="mode" value={modeFilter} />
      {/if}
      <input
        name="search"
        placeholder="Search users by username…"
        aria-label="Search users by username…"
        class="border-input dark:bg-input/30 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-[260px] min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base text-foreground outline-none transition-colors focus-visible:ring-3 md:text-sm"
        value={data.filters.search}
      />
      <Button type="submit" variant="outline" size="sm">Search</Button>
      {#if data.filters.search.trim()}
        <a href={filterHref("search", "")} class={filterLinkClass(false)}>Clear search</a>
      {/if}
    </form>
  </div>

  <!-- Table -->
  <div class="scroll-hint-x overflow-x-auto rounded-lg border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="pl-4">User</Table.Head>
          <Table.Head class="hidden sm:table-cell">Dispatcharr</Table.Head>
          <Table.Head>Mode</Table.Head>
          <Table.Head class="hidden md:table-cell">Policy</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="hidden whitespace-nowrap lg:table-cell">Last Accessed</Table.Head>
          <Table.Head class="w-[50px]"><span class="sr-only">Actions</span></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if mappings.length === 0}
          <Table.Row>
            <Table.Cell colspan={7} class="py-8 text-center text-sm text-muted-foreground">
              No users found.
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each mappings as m (m.id)}
            {@const status = getStatus(m)}
            <Table.Row>
              <Table.Cell class="pl-4">
                <div class="flex items-center gap-2.5">
                  <Avatar.Root class="h-7 w-7">
                    {#if m.plex_thumb}
                      <Avatar.Image src={m.plex_thumb} alt={m.plex_username} />
                    {/if}
                    <Avatar.Fallback class="text-xs">{m.plex_username.charAt(0).toUpperCase()}</Avatar.Fallback>
                  </Avatar.Root>
                  <span class="text-sm font-medium">{m.plex_username}</span>
                </div>
              </Table.Cell>
              <Table.Cell class="hidden text-sm text-muted-foreground sm:table-cell">
                {m.dispatcharr_username ?? "\u2014"}
              </Table.Cell>
              <Table.Cell>
                <StatusBadge mode={m.provisioning_mode} />
              </Table.Cell>
              <Table.Cell class="hidden md:table-cell">
                <span class="text-xs font-medium">
                  {data.policyByMappingId[m.id]?.policy ?? data.policySettings.defaultPolicy}
                </span>
              </Table.Cell>
              <Table.Cell>
                <div class="flex items-center gap-1.5">
                  <StatusBadge {status} />
                  {#if data.driftByMappingId[m.id]}
                    <span
                      class="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                      title="Dispatcharr's channel_profiles differ from the stored group selection. Re-save the groups to fix it. Sync only auto-corrects this when a group profile is recreated."
                    >
                      Drift
                    </span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell class="hidden text-xs text-muted-foreground whitespace-nowrap lg:table-cell">
                {formatRelativeTime(m.last_accessed_at)}
              </Table.Cell>
              <Table.Cell>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button variant="ghost" size="icon-sm" aria-label={`Open actions for ${m.plex_username}`} {...props}>
                        <EllipsisIcon class="h-4 w-4" />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="w-[180px]">
                    {#if m.provisioning_mode === "automatic" && m.dispatcharr_user_id != null}
                      <DropdownMenu.Item
                        disabled={submitting}
                        onclick={() => {
                          rotatingMapping = m;
                          rotateDialogOpen = true;
                        }}
                      >
                        <KeyRoundIcon class="h-3.5 w-3.5" />
                        Rotate Credentials
                      </DropdownMenu.Item>
                    {/if}
                    {#if m.is_active === 1 && m.dispatcharr_user_id != null}
                      <DropdownMenu.Item
                        onclick={() => {
                          disablingMapping = m;
                          disableDialogOpen = true;
                        }}
                      >
                        <BanIcon class="h-3.5 w-3.5" />
                        Disable
                      </DropdownMenu.Item>
                    {/if}
                    {#if m.is_active === 0}
                      <DropdownMenu.Item>
                        {#snippet child({ props })}
                          <form method="POST" action="?/enableUser" use:enhance={makeEnableEnhance()}>
                            <input type="hidden" name="id" value={m.id} />
                            <button
                              type="submit"
                              class="flex w-full items-center gap-2 text-left"
                              disabled={submitting}
                              onclick={() => (selectedMapping = m)}
                              {...props}
                            >
                              <CheckCircle2Icon class="h-3.5 w-3.5" />
                              Enable
                            </button>
                          </form>
                        {/snippet}
                      </DropdownMenu.Item>
                    {/if}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onclick={() => openGroupDialog(m)}>
                      <UsersIcon class="h-3.5 w-3.5" />
                      Change Group
                    </DropdownMenu.Item>
                    {#if m.dispatcharr_user_id != null}
                      <DropdownMenu.Item onclick={() => openProfileDialog(m)}>
                        <LayersIcon class="h-3.5 w-3.5" />
                        Change Profile
                      </DropdownMenu.Item>
                    {/if}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onclick={() => openDetailDialog(m)}>
                      <InfoIcon class="h-3.5 w-3.5" />
                      View Details
                    </DropdownMenu.Item>
                    {#if canDeleteLocalMapping(m)}
                      <DropdownMenu.Item
                        onclick={() => {
                          deletingMapping = m;
                          deleteDialogOpen = true;
                        }}
                        class="text-destructive focus:text-destructive"
                      >
                        <Trash2Icon class="h-3.5 w-3.5" />
                        Delete local mapping
                      </DropdownMenu.Item>
                    {/if}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </div>
</div>

<!-- Change Group Dialog -->
<Dialog.Root bind:open={groupDialogOpen}>
  <Dialog.Content class="sm:max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-auto">
    <Dialog.Header>
      <Dialog.Title>
        {data.groups.length === 0 ? "Add groups in Dispatcharr first" : "Change Group"}
      </Dialog.Title>
      <Dialog.Description>
        {#if data.groups.length === 0}
          No groups exist yet. Create groups in Dispatcharr, then return here.
        {:else}
          Select groups for {selectedMapping?.plex_username ?? "user"}.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    {#if selectedMapping}
      {#if data.groups.length === 0}
        <p class="py-2 text-sm text-muted-foreground">
          Open Dispatcharr → Settings → Groups, add at least one group, then refresh this page.
        </p>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onclick={() => (groupDialogOpen = false)}>
            Close
          </Button>
        </Dialog.Footer>
      {:else}
        {@const policy = data.policyByMappingId[selectedMapping.id]}
        <!-- Per-user lock toggle -->
        <form
          method="POST"
          action="?/setGroupLock"
          use:enhance={makeGroupLockEnhanceHandler()}
          class="mb-3 min-w-0 rounded-md border border-border p-3"
        >
          <input type="hidden" name="id" value={selectedMapping.id} />
          <input type="hidden" name="locked" value={String(lockEnabled)} />
          <label class="flex items-start gap-2">
            <input
              type="checkbox"
              class="mt-0.5 rounded"
              bind:checked={lockEnabled}
              onchange={() => (lockSaved = false)}
            />
            <span class="grid gap-0.5">
              <span class="text-sm font-medium">Lock selection</span>
              <span class="text-xs text-muted-foreground">
                When locked, the user can't change these groups themselves.
              </span>
            </span>
          </label>
          <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
            {#if lockSaved}
              <span role="status" class="text-xs font-medium text-primary">Lock updated.</span>
            {/if}
            <Button type="submit" variant="outline" size="sm" disabled={submitting}>
              {submitting ? "Saving..." : "Save lock"}
            </Button>
          </div>
        </form>

        <form method="POST" action="?/changeGroup" use:enhance={makeEnhanceHandler()} class="min-w-0">
          <input type="hidden" name="id" value={selectedMapping.id} />
          <input type="hidden" name="lineup_policy_override" value={selectedPolicyOverride} />
          <input type="hidden" name="selected_bundle_ids" value={JSON.stringify([...selectedBundleSet])} />
          <input type="hidden" name="group_ids" value={JSON.stringify([...selectedGroupSet])} />

          <div class="mb-3 grid gap-2 rounded-md border border-border p-3 text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium">Effective policy: {policy?.policy ?? data.policySettings.defaultPolicy}</span>
              {#if policy?.assignmentDrift}
                <span class="text-amber-700 dark:text-amber-400">Assignment differs from policy</span>
              {/if}
            </div>
            <span class="text-muted-foreground">
              Effective groups: {(policy?.effectiveGroupIds ?? []).join(", ") || "none"}
            </span>
            {#if policy && (policy.orphanBundleIds.length > 0 || policy.orphanApprovedGroupIds.length > 0)}
              <span class="text-amber-700 dark:text-amber-400">
                Unapplied intent: {[...policy.orphanBundleIds, ...policy.orphanApprovedGroupIds].join(", ")}
              </span>
            {/if}
          </div>

          <label class="grid gap-1.5 text-sm">
            <span class="font-medium">Policy override</span>
            <select
              bind:value={selectedPolicyOverride}
              class="border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="">Use instance default ({data.policySettings.defaultPolicy})</option>
              <option value="fixed">Fixed</option>
              <option value="core_bundles">Core + bundles</option>
              <option value="approved_selection">Approved selection</option>
            </select>
          </label>

          <fieldset class="mt-3 grid gap-1.5">
            <legend class="text-sm font-medium">Enabled bundles</legend>
            {#if data.lineupBundles.length === 0}
              <p class="text-xs text-muted-foreground">No enabled bundles.</p>
            {:else}
              {#each data.lineupBundles as bundle (bundle.id)}
                <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedBundleSet.has(bundle.id)}
                    onchange={(event) => {
                      const next = new Set(selectedBundleSet);
                      if (event.currentTarget.checked) next.add(bundle.id);
                      else next.delete(bundle.id);
                      selectedBundleSet = next;
                    }}
                  />
                  <span>{bundle.displayName}</span>
                </label>
              {/each}
            {/if}
          </fieldset>

          <fieldset class="mt-3 grid gap-1.5">
            <legend class="text-sm font-medium">Approved groups</legend>
            {#if data.policySettings.approvedGroupIds == null}
              <p class="text-xs text-destructive">No approved groups are configured.</p>
            {:else}
              <GroupPicker groups={approvedGroups} bind:selected={selectedGroupSet} scrollList={false} />
            {/if}
          </fieldset>

          {#if selectedGroupSet.size === 0 && (selectedPolicyOverride === "approved_selection" || (selectedPolicyOverride === "" && policy?.policy === "approved_selection"))}
            <p class="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Zero groups means this user will see no channels.
            </p>
          {/if}
          <Dialog.Footer class="sticky bottom-0 z-10 mt-3 bg-popover">
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? "Saving..." : "Save"}
            </Button>
          </Dialog.Footer>
        </form>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- Change Profile Dialog -->
<Dialog.Root bind:open={profileDialogOpen}>
  <Dialog.Content class="sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden">
    <Dialog.Header>
      <Dialog.Title>
        {data.profiles.length === 0 ? "Add channel profiles in Dispatcharr first" : "Change Profile"}
      </Dialog.Title>
      <Dialog.Description>
        {#if data.profiles.length === 0}
          No channel profiles exist yet. Create profiles in Dispatcharr, then return here.
        {:else}
          Select a concrete channel profile for {selectedMapping?.plex_username ?? "user"}.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    {#if selectedMapping}
      {#if data.profiles.length === 0}
        <p class="py-2 text-sm text-muted-foreground">
          Open Dispatcharr → Channel Profiles, add at least one profile, then refresh this page.
        </p>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onclick={() => (profileDialogOpen = false)}>
            Close
          </Button>
        </Dialog.Footer>
      {:else}
        <form method="POST" action="?/changeProfile" use:enhance={makeProfileEnhanceHandler()}>
          <input type="hidden" name="id" value={selectedMapping.id} />
          <input type="hidden" name="profile_id" value={selectedProfileId == null ? "" : String(selectedProfileId)} />
          <div class="grid gap-2 py-2">
            {#if selectedMappingGroupCount > 0}
              <p
                class="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
              >
                This subscriber's channels come from their {selectedMappingGroupCount === 1
                  ? "group"
                  : "groups"}, not a fixed profile. A profile set here is reverted on the next sync
                or group change, so saving is disabled — use Change Group instead.
              </p>
            {:else if selectedProfileId == null}
              <p class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Choose a channel profile to enable saving. Unrestricted profile clearing is not
                available for managed subscribers.
              </p>
            {/if}
            {#each data.profiles as profile (profile.id)}
              <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
                <input
                  type="radio"
                  name="profile_radio"
                  checked={selectedProfileId === profile.id}
                  disabled={selectedMappingGroupCount > 0}
                  onchange={() => (selectedProfileId = profile.id)}
                />
                {profile.name}
              </label>
            {/each}
          </div>
          <Dialog.Footer>
            <Button
              type="submit"
              disabled={submitting || selectedProfileId == null || selectedMappingGroupCount > 0}
              size="sm"
            >
              {submitting ? "Saving..." : "Save"}
            </Button>
          </Dialog.Footer>
        </form>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- View Details Dialog -->
<Dialog.Root bind:open={detailDialogOpen}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>User Details</Dialog.Title>
      <Dialog.Description>
        Full mapping information for {selectedMapping?.plex_username ?? "user"}.
      </Dialog.Description>
    </Dialog.Header>
    {#if selectedMapping}
      {@const m = selectedMapping}
      {@const policy = data.policyByMappingId[m.id]}
      <div class="grid gap-3 text-sm">
        <div class="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2">
          <span class="text-muted-foreground">Mapping ID</span>
          <span class="font-mono">{m.id}</span>

          <span class="text-muted-foreground">Plex Username</span>
          <span>{m.plex_username}</span>

          <span class="text-muted-foreground">Plex Account ID</span>
          <span class="font-mono">{m.plex_account_id}</span>

          <span class="text-muted-foreground">Plex UUID</span>
          <span class="font-mono text-xs break-all">{m.plex_uuid}</span>

          <span class="text-muted-foreground">Plex Email</span>
          <span>{m.plex_email ?? "\u2014"}</span>
        </div>

        <Separator />

        <div class="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2">
          <span class="text-muted-foreground">Dispatcharr User ID</span>
          <span class="font-mono">{m.dispatcharr_user_id ?? "\u2014"}</span>

          <span class="text-muted-foreground">Dispatcharr Username</span>
          <span>{m.dispatcharr_username ?? "\u2014"}</span>

          <span class="text-muted-foreground">Group IDs</span>
          <span class="font-mono">{m.dispatcharr_group_ids}</span>

          <span class="text-muted-foreground">Profile ID</span>
          <span class="font-mono">{m.dispatcharr_profile_id ?? "\u2014"}</span>
          <span class="text-muted-foreground">Effective Policy</span>
          <span>{policy?.policy ?? data.policySettings.defaultPolicy}</span>

          <span class="text-muted-foreground">Policy Override</span>
          <span>{m.lineup_policy_override ?? "Instance default"}</span>

          <span class="text-muted-foreground">Bundles</span>
          <span>{policy?.selectedBundleIds.join(", ") || "\u2014"}</span>

          <span class="text-muted-foreground">Approved Groups</span>
          <span>{policy?.selectedApprovedGroupIds.join(", ") || "\u2014"}</span>

          <span class="text-muted-foreground">Effective Groups</span>
          <span>{policy?.effectiveGroupIds.join(", ") || "\u2014"}</span>

          {#if policy?.assignmentDrift || (policy?.orphanBundleIds.length ?? 0) > 0 || (policy?.orphanApprovedGroupIds.length ?? 0) > 0}
            <span class="text-muted-foreground">Policy State</span>
            <span class="text-amber-700 dark:text-amber-400">
              {[
                ...(policy?.assignmentDrift ? ["assignment drift"] : []),
                ...(policy?.orphanBundleIds ?? []),
                ...(policy?.orphanApprovedGroupIds ?? []),
              ].join(", ")}
            </span>
          {/if}
        </div>

        <Separator />

        <div class="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2">
          <span class="text-muted-foreground">Provisioning Mode</span>
          <StatusBadge mode={m.provisioning_mode} class="w-fit" />

          <span class="text-muted-foreground">Active</span>
          <span>{m.is_active === 1 ? "Yes" : "No"}</span>

          <span class="text-muted-foreground">Created</span>
          <span>{formatRelativeTime(m.created_at)}</span>

          <span class="text-muted-foreground">Updated</span>
          <span>{formatRelativeTime(m.updated_at)}</span>

          <span class="text-muted-foreground">Last Synced</span>
          <span>{formatRelativeTime(m.last_synced_at)}</span>

          <span class="text-muted-foreground">Last Accessed</span>
          <span>{formatRelativeTime(m.last_accessed_at)}</span>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- One-Time Password Dialog -->
<Dialog.Root bind:open={passwordDialogOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>One-Time Password</Dialog.Title>
      <Dialog.Description>
        {passwordReprovisioned
          ? "This user was re-provisioned with a new account. Save this password — it will not be shown again."
          : "This user was provisioned with a new account. Save this password — it will not be shown again."}
      </Dialog.Description>
    </Dialog.Header>
    <div class="rounded-md bg-muted p-3 font-mono text-sm select-all">
      {oneTimePassword}
    </div>
    <Dialog.Footer>
      <Button size="sm" onclick={copyOneTimePassword}>
        Copy Password
      </Button>
      <Button
        variant="outline"
        size="sm"
        onclick={() => {
          passwordDialogOpen = false;
          passwordCopyStatus = "idle";
        }}
      >
        Close
      </Button>
    </Dialog.Footer>
    {#if passwordCopyStatus === "copied"}
      <p class="text-xs text-muted-foreground">Password copied to clipboard.</p>
    {:else if passwordCopyStatus === "failed"}
      <p class="text-xs text-destructive">Clipboard copy failed. Select and copy manually.</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- Rotate Credentials Confirmation Dialog -->
<ConfirmDialog
  bind:open={rotateDialogOpen}
  title={rotatingMapping
    ? `Rotate credentials for ${rotatingMapping.plex_username}?`
    : "Rotate credentials?"}
  description="This generates a new password and invalidates the user's current M3U / playlist URL. They will need the new URL to keep streaming."
>
  {#snippet confirm()}
    {#if rotatingMapping}
      <Button
        variant="destructive"
        disabled={submitting}
        onclick={() => {
          const target = rotatingMapping;
          if (!target) return;
          void rotateMappingCredentials(target.id);
        }}
      >
        {submitting ? "Rotating…" : "Rotate now"}
      </Button>
    {/if}
  {/snippet}
</ConfirmDialog>

<!-- Disable User Confirmation Dialog -->
<ConfirmDialog
  bind:open={disableDialogOpen}
  title={disablingMapping ? `Disable ${disablingMapping.plex_username}?` : "Disable user?"}
  description="The Dispatcharr account will be deleted and all stream URLs will stop working immediately. The local mapping is retained so the user can be re-enabled later."
>
  {#snippet confirm()}
    {#if disablingMapping}
      <form method="POST" action="?/disableUser" use:enhance={makeDisableEnhance()}>
        <input type="hidden" name="id" value={disablingMapping.id} />
        <Button variant="destructive" type="submit" disabled={submitting}>
          {submitting ? "Disabling…" : "Disable User"}
        </Button>
      </form>
    {/if}
  {/snippet}
</ConfirmDialog>

<!-- Delete Local Mapping Confirmation Dialog -->
<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={deletingMapping ? `Delete local mapping for ${deletingMapping.plex_username}?` : "Delete local mapping?"}
  description="This removes only the local otpravkarr mapping and saved metadata. It does not contact Dispatcharr. The Plex user can be provisioned again by signing in."
>
  {#snippet confirm()}
    {#if deletingMapping}
      <form method="POST" action="?/deleteMapping" use:enhance={makeDeleteEnhance()}>
        <input type="hidden" name="id" value={deletingMapping.id} />
        <Button variant="destructive" type="submit" disabled={submitting}>
          {submitting ? "Deleting…" : "Delete local mapping"}
        </Button>
      </form>
    {/if}
  {/snippet}
</ConfirmDialog>
