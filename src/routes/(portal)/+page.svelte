<script lang="ts">
import AlertCircleIcon from "lucide-svelte/icons/alert-circle";
import DownloadIcon from "lucide-svelte/icons/download";
import ExternalLinkIcon from "lucide-svelte/icons/external-link";
import Loader2Icon from "lucide-svelte/icons/loader-2";
import RefreshCwIcon from "lucide-svelte/icons/refresh-cw";
import ShieldAlertIcon from "lucide-svelte/icons/shield-alert";
import { enhance } from "$app/forms";
import { invalidateAll } from "$app/navigation";
import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
import CopyableField from "$lib/components/CopyableField.svelte";
import QRCodeDisplay from "$lib/components/QRCodeDisplay.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import * as Tabs from "$lib/components/ui/tabs";
import { userSession } from "$lib/state/user-session.svelte";
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
        initialPassword: string | null;
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
  channels_failed: "Failed to fetch channel list. Please try again.",
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
  <main class="hero-glow-bg min-h-screen flex flex-col items-center justify-center px-4 py-12 text-foreground">
    <div class="reveal reveal-1 mb-8 text-center">
      <p class="eyebrow">OTPRAVKARR</p>
      <h1 class="display-hero mt-2">Stream access.</h1>
      <p class="mt-3 text-sm text-muted-foreground">
        Sign in with your Plex account to view your credentials.
      </p>
    </div>

    <div class="reveal reveal-2 w-full max-w-sm">
      <Card.Root class="surface-elevated">
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
            <Button type="submit" disabled={submitting} class="cta-glow w-full">
              {#if submitting}
                <Loader2Icon class="mr-2 h-4 w-4 animate-spin" />
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
    {#if data.initialPassword}
      <Alert.Root variant="destructive">
        <ShieldAlertIcon class="h-5 w-5" />
        <Alert.Title>Temporary Dispatcharr password</Alert.Title>
        <Alert.Description>
          This password is shown only once. Sign in to Dispatcharr now and change it immediately.
        </Alert.Description>
      </Alert.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="text-base">One-time Password</Card.Title>
        </Card.Header>
        <Card.Content>
          <CopyableField label="Password" value={data.initialPassword} />
        </Card.Content>
      </Card.Root>
    {/if}

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

      <!-- Page header row -->
      <div class="reveal reveal-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="eyebrow">YOUR STREAM</p>
          <h1 class="font-display text-3xl md:text-4xl font-normal tracking-tight leading-[1.05] mt-1">
            {userSession.plexUsername ?? data.dispatcharrUsername}
          </h1>
        </div>
        <Badge variant="secondary" class="bg-primary/15 text-primary border border-primary/20">
          Active
        </Badge>
      </div>

      <Tabs.Root value="credentials" class="reveal reveal-2">
        <Tabs.List variant="line">
          <Tabs.Trigger value="credentials">Credentials</Tabs.Trigger>
          <Tabs.Trigger value="setup">Setup Guide</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="credentials" class="mt-4 space-y-4">
          <!-- Quick Setup: QR + URLs side-by-side on md+ -->
          <Card.Root class="surface-elevated">
            <Card.Header>
              <Card.Title class="text-base">Quick Setup</Card.Title>
              <Card.Description>
                Scan with your device or copy the URLs below.
              </Card.Description>
            </Card.Header>
            <Card.Content class="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
              <div class="flex justify-center md:justify-start">
                <QRCodeDisplay dataUri={data.qrCodeDataUri} alt="Playlist URL QR code" />
              </div>
              <div class="space-y-4">
                <CopyableField label="M3U Playlist URL" value={data.xcUrl} />
                <CopyableField label="Player API URL" value={data.playerApiUrl} />
              </div>
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

            <ConfirmDialog
              bind:open={confirmRefreshOpen}
              title="Refresh Credentials?"
              description="This will generate a new password for your streaming account. Your current URLs will stop working and you'll need to update your players with the new credentials."
            >
              {#snippet trigger({ props })}
                <Button variant="outline" {...props}>
                  <RefreshCwIcon class="mr-2 h-4 w-4" />
                  Refresh Credentials
                </Button>
              {/snippet}
              {#snippet confirm()}
                <form method="POST" action="?/refreshCredentials" use:enhance={enhanceRefresh}>
                  <Button variant="destructive" type="submit" disabled={refreshing}>
                    {refreshing ? "Refreshing…" : "Confirm Refresh"}
                  </Button>
                </form>
              {/snippet}
            </ConfirmDialog>
          </div>
        </Tabs.Content>

        <Tabs.Content value="setup" class="mt-4 space-y-4">
          {#each data.platformUrls as platform (platform.id)}
            <Card.Root>
              <Card.Header>
                <Card.Title class="text-base">{platform.name}</Card.Title>
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
