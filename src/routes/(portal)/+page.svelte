<script lang="ts">
import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
import DownloadIcon from "@lucide/svelte/icons/download";
import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
import type { ActionResult } from "@sveltejs/kit";
import { toast } from "svelte-sonner";
import { enhance } from "$app/forms";
import { invalidateAll } from "$app/navigation";
import { page } from "$app/state";
import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
import CopyableField from "$lib/components/CopyableField.svelte";
import QRCodeDisplay from "$lib/components/QRCodeDisplay.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import * as Tabs from "$lib/components/ui/tabs";
import { userSession } from "$lib/state/user-session.svelte";
import type {
  InstallMethod,
  Platform,
  PlatformInfo,
  PlatformUrlResult,
  SupportedOS,
} from "$lib/url/platforms";

interface PlatformEntry {
  id: Platform;
  name: string;
  description: string;
  tier: PlatformInfo["tier"];
  supportedOS: SupportedOS[];
  homepageUrl: string;
  setupInstructions: string;
  installMethods: InstallMethod[];
  result: PlatformUrlResult;
}

const OS_LABELS: Record<SupportedOS, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
};

const REVEAL_CLASSES = ["reveal-1", "reveal-2", "reveal-3", "reveal-3"] as const;

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
        xmltvUrl: string;
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
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many sign-in attempts. Please wait and try again.",
  plex_error: "Unable to connect to Plex. Please try again later.",
  plex_unreachable:
    "We're having trouble reaching Plex services. This is usually temporary—please wait a moment and try again.",
  refresh_failed: "Failed to refresh credentials. Please try again.",
};

let { data, form }: Props = $props();
let submitting = $state(false);
let refreshing = $state(false);
let confirmRefreshOpen = $state(false);

let errorMessage = $derived(
  form?.error ? (form.message ?? ERROR_MESSAGES[form.error] ?? "An error occurred.") : null,
);

let activeStatus = $derived(
  page.data.user?.isActive
    ? { label: "Active", class: "bg-primary/15 text-primary border border-primary/20" }
    : {
        label: "Inactive",
        class: "bg-destructive/15 text-destructive border border-destructive/20",
      },
);

function enhanceSignIn() {
  submitting = true;
  return async ({ update }: { update: () => Promise<void> }) => {
    submitting = false;
    await update();
  };
}

function enhanceRefresh() {
  refreshing = true;
  return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
    refreshing = false;
    confirmRefreshOpen = false;
    // Fire the toast BEFORE awaiting update(). update() runs invalidateAll and can
    // block on a slow reload, which previously delayed/swallowed the success toast
    // (ISSUE-004). The dialog is already closed and the toaster sits far above it,
    // so no z-index change is needed.
    if (result.type === "success") {
      toast.success("Credentials refreshed.");
    } else if (result.type === "failure" || result.type === "error") {
      toast.error("Couldn't refresh credentials. Try again.");
    }
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
                <LoaderCircleIcon class="mr-2 h-4 w-4 animate-spin" />
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
          <CopyableField label="Password" value={data.initialPassword} secret />
        </Card.Content>
      </Card.Root>
    {/if}

    <Alert.Root>
      <CircleAlertIcon class="h-5 w-5" />
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
        <CircleAlertIcon class="h-5 w-5" />
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
        <Badge variant="secondary" class={activeStatus.class}>
          {activeStatus.label}
        </Badge>
      </div>

      <Tabs.Root value="credentials" class="reveal reveal-2">
        <Tabs.List variant="line">
          <Tabs.Trigger value="credentials">Credentials</Tabs.Trigger>
          <Tabs.Trigger value="setup">Setup Guide</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="credentials" class="mt-4 space-y-4">
          <!-- Recommended onboarding: XC/URL -->
          <Card.Root class="surface-elevated">
            <Card.Header>
              <Card.Title class="text-base">Recommended: XC / URL setup</Card.Title>
              <Card.Description>
                Use these URLs in an XC-compatible player; use the native Dispatcharr XMLTV Guide URL for EPG. Reveal, copy, or generate a QR code only when you need it.
              </Card.Description>
            </Card.Header>
            <Card.Content class="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
              <div class="flex justify-center md:justify-start">
                <QRCodeDisplay value={data.xcUrl} alt="Playlist URL QR code" />
              </div>
              <div class="space-y-4">
                <CopyableField label="M3U Playlist URL" value={data.xcUrl} secret />
                <CopyableField label="Player API URL" value={data.playerApiUrl} secret />
                <CopyableField
                  label="XMLTV Guide URL"
                  value={data.xmltvUrl}
                  secret
                />
              </div>
            </Card.Content>
          </Card.Root>

          <!-- Actions -->
          <div class="space-y-2">
            <div class="flex flex-wrap gap-3">
              <Button href="/m3u" variant="outline" data-sveltekit-reload>
                <DownloadIcon class="mr-2 h-4 w-4" />
                Download M3U snapshot
              </Button>

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
            <p class="text-xs text-muted-foreground">
              Downloaded M3U files are best-effort snapshots and do not update automatically. Use the XC / URL setup above for ongoing updates.
            </p>
          </div>
        </Tabs.Content>

        <Tabs.Content value="setup" class="mt-4 space-y-6">
          {@const recommended = data.platformUrls.filter((p) => p.tier === "recommended")}
          {@const fallback = data.platformUrls.filter((p) => p.tier === "legacy")}

          <section class="space-y-3">
            <p class="eyebrow">RECOMMENDED</p>
            {#each recommended as platform, i (platform.id)}
              <div class="reveal {REVEAL_CLASSES[i] ?? 'reveal-3'} surface-elevated p-6 space-y-4">
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-display text-2xl font-normal tracking-tight">
                      {platform.name}
                    </h3>
                    {#each platform.supportedOS as os (os)}
                      <Badge variant="secondary">{OS_LABELS[os]}</Badge>
                    {/each}
                  </div>
                  <p class="text-sm text-muted-foreground">{platform.setupInstructions}</p>
                </div>

                {#if platform.installMethods.length > 0}
                  <div class="flex flex-wrap gap-2">
                    {#each platform.installMethods as method, mi (method.label)}
                      {@const isFirstLink =
                        method.type === "link" &&
                        platform.installMethods.slice(0, mi).every((m) => m.type !== "link")}
                      {#if method.type === "link"}
                        <Button
                          href={method.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="outline"
                          class={isFirstLink ? "cta-glow" : ""}
                        >
                          <DownloadIcon class="mr-2 h-4 w-4" aria-hidden="true" />
                          {method.label}
                        </Button>
                      {:else}
                        <div class="w-full">
                          <CopyableField label={method.label} value={method.value} />
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}

                {#if platform.id === "fredtv"}
                  <p class="text-xs text-muted-foreground">
                    A Microsoft Store build is also available, but it's paid.
                  </p>
                {/if}

                <CopyableField label="M3U Playlist URL" value={platform.result.url} secret />
              </div>
            {/each}
          </section>

          <section class="space-y-3">
            <p class="eyebrow mt-10">FALLBACK</p>
            {#each fallback as platform, i (platform.id)}
              <div class="reveal {REVEAL_CLASSES[i + recommended.length] ?? 'reveal-3'} surface p-5 space-y-3">
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-base font-medium">{platform.name}</h3>
                    <Badge variant="outline">Legacy</Badge>
                    {#each platform.supportedOS as os (os)}
                      <Badge variant="secondary">{OS_LABELS[os]}</Badge>
                    {/each}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {platform.setupInstructions}
                    {#if platform.id === "vlc"}
                      {" "}Download from
                      <a
                        href={platform.homepageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        videolan.org<ExternalLinkIcon class="h-3.5 w-3.5" aria-hidden="true" />
                      </a>.
                    {/if}
                  </p>
                </div>

                <CopyableField label="M3U Playlist URL" value={platform.result.url} secret />
              </div>
            {/each}
          </section>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  {/if}
{/if}
