<script lang="ts">
import type { ActionResult } from "@sveltejs/kit";
import BanIcon from "lucide-svelte/icons/ban";
import CheckCircle2Icon from "lucide-svelte/icons/check-circle-2";
import EllipsisIcon from "lucide-svelte/icons/ellipsis";
import InfoIcon from "lucide-svelte/icons/info";
import KeyRoundIcon from "lucide-svelte/icons/key-round";
import LayersIcon from "lucide-svelte/icons/layers";
import UsersIcon from "lucide-svelte/icons/users";
import { toast } from "svelte-sonner";
import { applyAction, enhance } from "$app/forms";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
import StatusBadge from "$lib/components/StatusBadge.svelte";
import * as Avatar from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { Input } from "$lib/components/ui/input";
import * as Select from "$lib/components/ui/select";
import { Separator } from "$lib/components/ui/separator";
import * as Table from "$lib/components/ui/table";
import type { ProvisioningMode, UserMapping } from "$lib/db/types";
import type { DispatcharrGroup } from "$lib/dispatcharr/types";
import { normalizeSqliteDatetime } from "$lib/utils/datetime";
import { copyOtpToClipboard } from "./otp-clipboard";

interface Props {
  data: {
    mappings: UserMapping[];
    groups: DispatcharrGroup[];
    profiles: { id: number; name: string }[];
    filters: { status: string; mode: string; search: string };
  };
}

let { data }: Props = $props();

let submitting = $state(false);

// Dialog state
let groupDialogOpen = $state(false);
let profileDialogOpen = $state(false);
let detailDialogOpen = $state(false);
let passwordDialogOpen = $state(false);
let disableDialogOpen = $state(false);
let selectedMapping = $state<UserMapping | null>(null);
let selectedGroupIds = $state<number[]>([]);
let selectedProfileId = $state<number | null>(null);
let disablingMapping = $state<UserMapping | null>(null);
let oneTimePassword = $state("");
let passwordCopyStatus = $state<"idle" | "copied" | "failed">("idle");

// Search debounce
let searchTimeout: ReturnType<typeof setTimeout> | undefined;
let searchValue = $state("");
$effect(() => {
  searchValue = data.filters.search;
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

function updateFilter(key: string, value: string) {
  const params = new URLSearchParams(page.url.searchParams);
  if (value === "all" || value === "") {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const qs = params.toString();
  goto(`/users${qs ? `?${qs}` : ""}`, { replaceState: true, keepFocus: true });
}

function onSearchInput(e: Event) {
  const val = (e.currentTarget as HTMLInputElement).value;
  searchValue = val;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => updateFilter("search", val), 300);
}

function getStatus(m: UserMapping): "active" | "inactive" | "orphaned" {
  if (m.is_active === 0) return "inactive";
  if (m.dispatcharr_user_id == null) return "orphaned";
  return "active";
}

function modeLabelText(mode: ProvisioningMode): string {
  if (mode === "automatic") return "Automatic";
  if (mode === "self_managed") return "Self-managed";
  return "Staff";
}

function openGroupDialog(m: UserMapping) {
  selectedMapping = m;
  try {
    selectedGroupIds = JSON.parse(m.dispatcharr_group_ids) as number[];
  } catch {
    selectedGroupIds = [];
  }
  groupDialogOpen = true;
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

function toggleGroupId(gid: number) {
  if (selectedGroupIds.includes(gid)) {
    selectedGroupIds = selectedGroupIds.filter((id) => id !== gid);
  } else {
    selectedGroupIds = [...selectedGroupIds, gid];
  }
}

function makeEnhanceHandler() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      try {
        if (result.type === "success") {
          toast.success("Group updated successfully.");
          await update();
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to update group.",
          );
          await update();
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
        groupDialogOpen = false;
      }
    };
  };
}

function makeProfileEnhanceHandler() {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      try {
        if (result.type === "success") {
          toast.success("Profile updated.");
          await update();
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to update profile.",
          );
          await update();
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
        profileDialogOpen = false;
      }
    };
  };
}

function makeActionEnhance(successMsg: string) {
  return () => {
    submitting = true;
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      try {
        if (result.type === "success") {
          toast.success(successMsg);
          await update();
        } else if (result.type === "failure") {
          toast.error((result.data as { error?: string } | undefined)?.error ?? "Action failed.");
          await update();
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
    return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
      try {
        if (result.type === "success") {
          const d = result.data as
            | { initialPassword?: string; reprovisioned?: boolean }
            | undefined;
          if (d?.initialPassword) {
            oneTimePassword = d.initialPassword;
            passwordCopyStatus = "idle";
            passwordDialogOpen = true;
          } else if (d?.reprovisioned) {
            toast.success("User re-enabled. New credentials will rotate on next sync.");
          } else {
            toast.success("User enabled successfully.");
          }
          await update();
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string } | undefined)?.error ?? "Failed to enable user.",
          );
          await update();
        } else {
          await applyAction(result);
        }
      } finally {
        submitting = false;
      }
    };
  };
}

async function copyOneTimePassword() {
  passwordCopyStatus = await copyOtpToClipboard(oneTimePassword);
}
</script>

<svelte:head>
  <title>Users — otpravkarr</title>
</svelte:head>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-lg font-semibold text-foreground">Users</h1>
    <span class="text-sm text-muted-foreground">{data.mappings.length} {data.mappings.length === 1 ? "user" : "users"}</span>
  </div>

  <!-- Filters bar -->
  <div class="flex flex-wrap items-center gap-3">
    <Select.Root
      type="single"
      value={data.filters.status}
      onValueChange={(v) => updateFilter("status", v ?? "all")}
    >
      <Select.Trigger class="w-[140px] text-foreground">
        <span data-slot="select-value">
          {data.filters.status === "all" ? "All statuses" : data.filters.status.charAt(0).toUpperCase() + data.filters.status.slice(1)}
        </span>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="all" label="All statuses">All statuses</Select.Item>
        <Select.Item value="active" label="Active">Active</Select.Item>
        <Select.Item value="inactive" label="Inactive">Inactive</Select.Item>
        <Select.Item value="orphaned" label="Orphaned">Orphaned</Select.Item>
      </Select.Content>
    </Select.Root>

    <Select.Root
      type="single"
      value={data.filters.mode}
      onValueChange={(v) => updateFilter("mode", v ?? "all")}
    >
      <Select.Trigger class="w-[160px] text-foreground">
        <span data-slot="select-value">
          {data.filters.mode === "all" ? "All modes" : modeLabelText(data.filters.mode as ProvisioningMode)}
        </span>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="all" label="All modes">All modes</Select.Item>
        <Select.Item value="automatic" label="Automatic">Automatic</Select.Item>
        <Select.Item value="self_managed" label="Self-managed">Self-managed</Select.Item>
        <Select.Item value="staff" label="Staff">Staff</Select.Item>
      </Select.Content>
    </Select.Root>

    <Input
      placeholder="Search username..."
      aria-label="Search users by username"
      class="w-[200px] text-foreground"
      value={searchValue}
      oninput={onSearchInput}
    />
  </div>

  <!-- Table -->
  <div class="scroll-hint-x overflow-x-auto rounded-lg border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="pl-4">User</Table.Head>
          <Table.Head class="hidden sm:table-cell">Dispatcharr</Table.Head>
          <Table.Head>Mode</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="hidden whitespace-nowrap lg:table-cell">Last Accessed</Table.Head>
          <Table.Head class="w-[50px]"><span class="sr-only">Actions</span></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if data.mappings.length === 0}
          <Table.Row>
            <Table.Cell colspan={6} class="py-8 text-center text-sm text-muted-foreground">
              No users found.
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each data.mappings as m (m.id)}
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
              <Table.Cell>
                <StatusBadge {status} />
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
                      <DropdownMenu.Item>
                        {#snippet child({ props })}
                          <form method="POST" action="?/rotateCredentials" use:enhance={makeActionEnhance("Credentials rotated successfully.")}>
                            <input type="hidden" name="id" value={m.id} />
                            <button type="submit" class="flex w-full items-center gap-2 text-left" disabled={submitting} {...props}>
                              <KeyRoundIcon class="h-3.5 w-3.5" />
                              Rotate Credentials
                            </button>
                          </form>
                        {/snippet}
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
                            <button type="submit" class="flex w-full items-center gap-2 text-left" disabled={submitting} {...props}>
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
  <Dialog.Content class="sm:max-w-md">
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
        <form method="POST" action="?/changeGroup" use:enhance={makeEnhanceHandler()}>
          <input type="hidden" name="id" value={selectedMapping.id} />
          <input type="hidden" name="group_ids" value={JSON.stringify(selectedGroupIds)} />
          <div class="grid gap-2 py-2">
            {#each data.groups as group (group.id)}
              <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
                <input
                  type="checkbox"
                  class="rounded"
                  checked={selectedGroupIds.includes(group.id)}
                  onchange={() => toggleGroupId(group.id)}
                />
                {group.name}
              </label>
            {/each}
          </div>
          <Dialog.Footer>
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
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        {data.profiles.length === 0 ? "Add channel profiles in Dispatcharr first" : "Change Profile"}
      </Dialog.Title>
      <Dialog.Description>
        {#if data.profiles.length === 0}
          No channel profiles exist yet. Create profiles in Dispatcharr, then return here.
        {:else}
          Select a channel profile for {selectedMapping?.plex_username ?? "user"}, or choose "All channels" for no restriction.
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
            <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
              <input
                type="radio"
                name="profile_radio"
                checked={selectedProfileId == null}
                onchange={() => (selectedProfileId = null)}
              />
              <span class="text-muted-foreground">All channels (no profile)</span>
            </label>
            {#each data.profiles as profile (profile.id)}
              <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
                <input
                  type="radio"
                  name="profile_radio"
                  checked={selectedProfileId === profile.id}
                  onchange={() => (selectedProfileId = profile.id)}
                />
                {profile.name}
              </label>
            {/each}
          </div>
          <Dialog.Footer>
            <Button type="submit" disabled={submitting} size="sm">
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
        This user was re-provisioned with a new account. Save this password — it will not be shown again.
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
