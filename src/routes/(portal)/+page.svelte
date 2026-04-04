<script lang="ts">
import AlertCircleIcon from "lucide-svelte/icons/alert-circle";
import DownloadIcon from "lucide-svelte/icons/download";
import ExternalLinkIcon from "lucide-svelte/icons/external-link";
import RefreshCwIcon from "lucide-svelte/icons/refresh-cw";
import ShieldAlertIcon from "lucide-svelte/icons/shield-alert";
import { enhance } from "$app/forms";
import { invalidateAll } from "$app/navigation";
import CopyableField from "$lib/components/CopyableField.svelte";
import QRCodeDisplay from "$lib/components/QRCodeDisplay.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import * as Dialog from "$lib/components/ui/dialog";
import * as Tabs from "$lib/components/ui/tabs";
import type { PlatformUrlResult } from "$lib/url/platforms";

interface PlatformEntry {
  id: string;
  name: string;
  description: string;
  result: PlatformUrlResult;
}

interface Props {
  data:
    | { authenticated: false }
    | { authenticated: true; revoked: true }
    | { authenticated: true; mode: "automatic"; error: string }
    | {
        authenticated: true;
        mode: "automatic";
        xcUrl: string;
        playerApiUrl: string;
        qrCodeDataUri: string;
        platformUrls: PlatformEntry[];
        dispatcharrUsername: string;
      }
    | {
        authenticated: true;
        mode: "self_managed" | "staff";
        dispatcharrUsername: string | null;
        dispatcharrUrl: string | null;
      };
  form?: {
    error?: string;
    message?: string;
    m3uContent?: string;
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many sign-in attempts. Please wait and try again.",
  plex_error: "Unable to connect to Plex. Please try again later.",
  refresh_failed: "Failed to refresh credentials. Please try again.",
  m3u_failed: "Failed to generate playlist. Please try again.",
};

const PLATFORM_INSTRUCTIONS: Record<string, string> = {
  vlc: "Open VLC, go to Media > Open Network Stream, and paste the URL below.",
  tivimate:
    "Open TiviMate, go to Add Playlist > Xtream Codes, then enter the host, username, and password shown below.",
  smarters:
    "Open IPTV Smarters, tap Login, then enter the host URL, username, and password shown below.",
  generic: "Copy the M3U playlist URL and paste it into your IPTV player's playlist settings.",
};

let { data, form }: Props = $props();
let submitting = $state(false);
let refreshing = $state(false);
let downloading = $state(false);
let confirmRefreshOpen = $state(false);

let errorMessage = $derived(
  form?.error ? (form.message ?? ERROR_MESSAGES[form.error] ?? "An error occurred.") : null,
);

// Handle M3U download when form returns content
$effect(() => {
  if (form?.m3uContent) {
    const blob = new Blob([form.m3uContent], { type: "audio/x-mpegurl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "playlist.m3u";
    a.click();
    URL.revokeObjectURL(url);
  }
});

function enhanceSignIn() {
  submitting = true;
  return async ({ update }: { update: () => Promise<void> }) => {
    submitting = false;
    await update();
  };
}

function enhanceRefresh() {
  refreshing = true;
  return async ({ update }: { update: () => Promise<void> }) => {
    refreshing = false;
    confirmRefreshOpen = false;
    await update();
  };
}

function enhanceDownload() {
  downloading = true;
  return async ({ update }: { update: () => Promise<void> }) => {
    downloading = false;
    await update();
  };
}
</script>

<svelte:head>
  <title>otpravkarr</title>
</svelte:head>

{#if !data.authenticated}
  <!-- Sign-in view -->
  <main class="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-background text-foreground">
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">otpravkarr</h1>
      <p class="mt-1 text-sm text-muted-foreground">Stream access portal</p>
    </div>

    <div class="w-full max-w-sm">
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Welcome</Card.Title>
          <Card.Description>
            Sign in with your Plex account to access your streaming credentials.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if errorMessage}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Sign-in failed</Alert.Title>
              <Alert.Description>{errorMessage}</Alert.Description>
            </Alert.Root>
          {/if}

          <form method="POST" action="?/signInWithPlex" use:enhance={enhanceSignIn}>
            <Button type="submit" disabled={submitting} class="w-full">
              {#if submitting}
                <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                </svg>
                Redirecting to Plex…
              {:else}
                Sign in with Plex
              {/if}
            </Button>
          </form>
        </Card.Content>
      </Card.Root>
    </div>
  </main>
{:else if "revoked" in data && data.revoked}
  <!-- Revoked view -->
  <div class="max-w-lg mx-auto">
    <Alert.Root variant="destructive">
      <ShieldAlertIcon class="h-5 w-5" />
      <Alert.Title>Access Revoked</Alert.Title>
      <Alert.Description>
        Your access to this server has been revoked. Contact the server admin if you believe this is an error.
      </Alert.Description>
    </Alert.Root>

    <form method="POST" action="/api/internal/signout" class="mt-4">
      <Button variant="outline" type="submit" class="w-full">Sign out</Button>
    </form>
  </div>
{:else if "mode" in data && (data.mode === "self_managed" || data.mode === "staff")}
  <!-- Self-managed / staff view -->
  <div class="max-w-lg mx-auto space-y-4">
    <Alert.Root>
      <AlertCircleIcon class="h-5 w-5" />
      <Alert.Title>Self-managed account</Alert.Title>
      <Alert.Description>
        Your streaming credentials are managed directly in Dispatcharr. Use the link below to access your account.
      </Alert.Description>
    </Alert.Root>

    {#if data.dispatcharrUsername}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">Your Dispatcharr Account</Card.Title>
        </Card.Header>
        <Card.Content class="space-y-3">
          <CopyableField label="Username" value={data.dispatcharrUsername} />

          {#if data.dispatcharrUrl}
            <a
              href={data.dispatcharrUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Open Dispatcharr
              <ExternalLinkIcon class="h-3.5 w-3.5" />
            </a>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
{:else if "mode" in data && data.mode === "automatic"}
  <!-- Automatic mode -->
  {#if "error" in data && typeof data.error === "string"}
    <!-- Not yet provisioned -->
    <div class="max-w-lg mx-auto">
      <Alert.Root variant="destructive">
        <AlertCircleIcon class="h-5 w-5" />
        <Alert.Title>Provisioning Issue</Alert.Title>
        <Alert.Description>{data.error}</Alert.Description>
      </Alert.Root>
    </div>
  {:else if "xcUrl" in data}
    <!-- Full streaming UI -->
    <div class="max-w-2xl mx-auto space-y-6">
      {#if errorMessage}
        <Alert.Root variant="destructive">
          <Alert.Title>Error</Alert.Title>
          <Alert.Description>{errorMessage}</Alert.Description>
        </Alert.Root>
      {/if}

      <Tabs.Root value="credentials">
        <Tabs.List>
          <Tabs.Trigger value="credentials">Credentials</Tabs.Trigger>
          <Tabs.Trigger value="setup">Setup Guide</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="credentials" class="mt-4 space-y-4">
          <!-- Streaming URLs -->
          <Card.Root>
            <Card.Header>
              <Card.Title class="text-base">Streaming URLs</Card.Title>
              <Card.Description>
                Use these URLs to connect your IPTV player.
              </Card.Description>
            </Card.Header>
            <Card.Content class="space-y-4">
              <CopyableField label="M3U Playlist URL" value={data.xcUrl} />
              <CopyableField label="Player API URL" value={data.playerApiUrl} />
            </Card.Content>
          </Card.Root>

          <!-- QR Code -->
          <Card.Root>
            <Card.Header>
              <Card.Title class="text-base">Quick Setup</Card.Title>
              <Card.Description>
                Scan this QR code with your device to import the playlist URL.
              </Card.Description>
            </Card.Header>
            <Card.Content class="flex justify-center">
              <QRCodeDisplay dataUri={data.qrCodeDataUri} alt="Playlist URL QR code" />
            </Card.Content>
          </Card.Root>

          <!-- Actions -->
          <div class="flex flex-wrap gap-3">
            <form method="POST" action="?/downloadM3U" use:enhance={enhanceDownload}>
              <Button variant="outline" type="submit" disabled={downloading}>
                <DownloadIcon class="mr-2 h-4 w-4" />
                {downloading ? "Generating…" : "Download M3U"}
              </Button>
            </form>

            <Dialog.Root bind:open={confirmRefreshOpen}>
              <Dialog.Trigger>
                {#snippet child({ props })}
                  <Button variant="outline" {...props}>
                    <RefreshCwIcon class="mr-2 h-4 w-4" />
                    Refresh Credentials
                  </Button>
                {/snippet}
              </Dialog.Trigger>
              <Dialog.Content>
                <Dialog.Header>
                  <Dialog.Title>Refresh Credentials?</Dialog.Title>
                  <Dialog.Description>
                    This will generate a new password for your streaming account. Your current URLs will stop working and you'll need to update your players with the new credentials.
                  </Dialog.Description>
                </Dialog.Header>
                <Dialog.Footer>
                  <Button variant="outline" onclick={() => (confirmRefreshOpen = false)}>
                    Cancel
                  </Button>
                  <form method="POST" action="?/refreshCredentials" use:enhance={enhanceRefresh}>
                    <Button variant="destructive" type="submit" disabled={refreshing}>
                      {refreshing ? "Refreshing…" : "Confirm Refresh"}
                    </Button>
                  </form>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Root>
          </div>
        </Tabs.Content>

        <Tabs.Content value="setup" class="mt-4 space-y-4">
          {#each data.platformUrls as platform (platform.id)}
            <Card.Root>
              <Card.Header>
                <div class="flex items-center gap-2">
                  <Card.Title class="text-base">{platform.name}</Card.Title>
                  <Badge variant="secondary">{platform.id}</Badge>
                </div>
                <Card.Description>{platform.description}</Card.Description>
              </Card.Header>
              <Card.Content class="space-y-3">
                <p class="text-sm text-muted-foreground">
                  {PLATFORM_INSTRUCTIONS[platform.id] ?? "Copy the URL below and paste it into your player."}
                </p>

                {#if platform.result.type === "url"}
                  <CopyableField label="URL" value={platform.result.url} />
                {:else if platform.result.type === "fields"}
                  <CopyableField label="Host" value={platform.result.fields.host} />
                  <CopyableField label="Username" value={platform.result.fields.username} />
                  <CopyableField label="Password" value={platform.result.fields.password} />
                {/if}
              </Card.Content>
            </Card.Root>
          {/each}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  {/if}
{/if}
