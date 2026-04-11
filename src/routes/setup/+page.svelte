<script lang="ts">
import { untrack } from "svelte";
import { enhance } from "$app/forms";
import SetupWizard from "$lib/components/SetupWizard.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import * as Select from "$lib/components/ui/select";
import { Separator } from "$lib/components/ui/separator";
import { cn } from "$lib/utils";

type SetupPageData = {
  claimActive: boolean;
  resumePhase: 1 | 2 | 3 | 4 | 5;
  tokenProvided: boolean;
  tokenFromUrl: string | null;
  dispatcharrGroups: Array<{ id: number; name: string }>;
  dispatcharrProfiles: Array<{ id: number; name: string }>;
  oauthCallback: boolean;
};

type StepErrors = Record<string, string>;
const ERROR_CODE_PATTERN = /^[a-z0-9_]+$/;

let { data }: { data: SetupPageData } = $props();
const initialStep = untrack(() => {
  if (!data.claimActive) {
    return 0;
  }
  return data.resumePhase;
});
const initialDispatcharrGroups = untrack(() => data.dispatcharrGroups);
const initialDispatcharrProfiles = untrack(() => data.dispatcharrProfiles);

// ── Wizard state ────────────────────────────────────────────────
let step = $state(initialStep);
let submitting = $state(false);
let stepErrors = $state<StepErrors>({});

// ── Step data ───────────────────────────────────────────────────
let adminUsername = $state("");
let plexServerInfo = $state<{
  friendlyName: string;
  machineIdentifier: string;
  version: string;
} | null>(null);
let dispatcharrGroups = $state<Array<{ id: number; name: string }>>(initialDispatcharrGroups);
let dispatcharrProfiles = $state<Array<{ id: number; name: string }>>(initialDispatcharrProfiles);
let xcProbeResult = $state<{ found: boolean; template?: string } | null>(null);
let currentOrigin = $state("");

// Plex OAuth flow
let plexMode = $state<"token" | "oauth">("token");
let plexOAuthId = $state("");
let plexOAuthWaiting = $state(false);
let plexOAuthPopupBlocked = $state(false);
let plexOAuthPopup: Window | null = null;
let plexOAuthMessageHandler: ((e: MessageEvent) => void) | null = null;

// Password visibility
let showPassword = $state(false);
let showConfirmPassword = $state(false);

// Password strength
let password = $state("");
let confirmPassword = $state("");

// Step 5 defaults
let defaultGroupId = $state<string>("");
let defaultProfileId = $state<string>("");
let syncInterval = $state("15");
let provisioningMode = $state<string>("automatic");

// ── Derived values ──────────────────────────────────────────────
const steps = ["Claim", "Admin", "Plex", "Dispatcharr", "Origin", "Defaults"] as const;

let passwordStrength = $derived.by(() => {
  if (!password) return { level: 0, label: "", color: "" };
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { level: 1, label: "Weak", color: "bg-destructive" };
  if (score <= 2) return { level: 2, label: "Fair", color: "bg-orange-500" };
  if (score <= 3) return { level: 3, label: "Good", color: "bg-yellow-500" };
  if (score <= 4) return { level: 4, label: "Strong", color: "bg-green-500" };
  return { level: 5, label: "Very strong", color: "bg-green-400" };
});

let passwordsMatch = $derived(confirmPassword.length > 0 && password === confirmPassword);

let hasError = $derived(Object.keys(stepErrors).length > 0);

// ── Lifecycle ───────────────────────────────────────────────────
$effect(() => {
  if (typeof window !== "undefined") {
    currentOrigin = window.location.origin;
  }
});

// Only treat this page as a popup callback on the client when window.opener
// is present.  Returning false during SSR avoids a hydration mismatch when
// someone navigates directly to /setup?oauthCallback=1 (no popup context).
let isOAuthPopupCallback = $derived(
  data.oauthCallback && typeof window !== "undefined" && !!window.opener,
);

// On the client, signal the opener window and close the popup
$effect(() => {
  if (data.oauthCallback && typeof window !== "undefined" && window.opener) {
    window.opener.postMessage({ type: "plex-oauth-complete" }, window.location.origin);
    setTimeout(() => window.close(), 500);
  }
});

function closePlexOAuthPopup() {
  if (plexOAuthMessageHandler) {
    window.removeEventListener("message", plexOAuthMessageHandler);
    plexOAuthMessageHandler = null;
  }
  if (plexOAuthPopup && !plexOAuthPopup.closed) {
    plexOAuthPopup.close();
  }
  plexOAuthPopup = null;
}

// Clean up OAuth resources on component destroy
$effect(() => {
  return () => closePlexOAuthPopup();
});

function preparePlexOAuthPopup() {
  if (typeof window === "undefined") {
    return;
  }

  const popup = window.open("about:blank", "otpravkarr-plex-oauth", "popup,width=800,height=600");
  if (!popup) {
    plexOAuthPopupBlocked = true;
    plexOAuthPopup = null;
    return;
  }

  plexOAuthPopup = popup;
  plexOAuthPopupBlocked = false;
  popup.focus();

  function onOAuthComplete(event: MessageEvent) {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "plex-oauth-complete") return;
    plexOAuthWaiting = true;
    window.removeEventListener("message", onOAuthComplete);
    plexOAuthMessageHandler = null;
  }
  plexOAuthMessageHandler = onOAuthComplete;
  window.addEventListener("message", onOAuthComplete);

  // Poll for manual popup close so the listener gets cleaned up.
  // Cap at 5 minutes to avoid running indefinitely if the popup is
  // left open on a non-callback page.
  const POLL_INTERVAL_MS = 500;
  const MAX_POLL_MS = 5 * 60 * 1000;
  let elapsed = 0;
  const pollId = setInterval(() => {
    elapsed += POLL_INTERVAL_MS;
    if (popup.closed || elapsed >= MAX_POLL_MS) {
      clearInterval(pollId);
      if (plexOAuthMessageHandler) {
        window.removeEventListener("message", plexOAuthMessageHandler);
        plexOAuthMessageHandler = null;
      }
      if (!popup.closed) {
        // Timed out — popup still open but we stop polling
        popup.close();
      }
      plexOAuthWaiting = false;
      plexOAuthPopup = null;
    }
  }, POLL_INTERVAL_MS);
}

// ── Form enhancement ────────────────────────────────────────────
function normalizeStepErrors(data: Record<string, unknown>): StepErrors {
  const normalized: StepErrors = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }

  const error = typeof data.error === "string" ? data.error : undefined;
  const field = typeof data.field === "string" ? data.field : undefined;

  if (error) {
    if (!ERROR_CODE_PATTERN.test(error)) {
      normalized.message ??= error;
    }
    if (field) {
      normalized[field] = error;
    }
  }

  return normalized;
}

function enhanceHandler(nextStep?: number) {
  return () => {
    submitting = true;
    stepErrors = {};
    return async ({ result, update }: { result: any; update: () => Promise<void> }) => {
      submitting = false;
      if (result.type === "success" && result.data) {
        const d = result.data as Record<string, any>;

        // Step 0: Claim success
        if (step === 0 && d.success) {
          step = data.resumePhase;
          return;
        }

        // Step 1 → 2: Admin created
        if (step === 1 && d.success) {
          step = 2;
          return;
        }

        // Step 2: Plex
        if (step === 2) {
          // OAuth initiate → waiting
          if (d.oauthId && d.oauthUri) {
            plexOAuthId = d.oauthId;
            if (plexOAuthPopup && !plexOAuthPopup.closed) {
              plexOAuthPopup.location.href = d.oauthUri;
              plexOAuthPopup.focus();
              plexOAuthWaiting = true;
              plexOAuthPopupBlocked = false;
            } else {
              plexOAuthWaiting = false;
              plexOAuthPopupBlocked = true;
              stepErrors = {
                message:
                  "Your browser blocked the Plex sign-in window. Allow popups for this site and try again.",
              };
            }
            return;
          }
          // Plex configured (token or oauth_complete)
          if (d.success && d.friendlyName) {
            plexServerInfo = {
              friendlyName: d.friendlyName,
              machineIdentifier: d.machineIdentifier,
              version: d.version,
            };
            closePlexOAuthPopup();
            plexOAuthWaiting = false;
            step = 3;
            return;
          }
        }

        // Step 3: Dispatcharr
        if (step === 3 && d.success) {
          dispatcharrGroups = d.groups ?? [];
          dispatcharrProfiles = d.profiles ?? [];
          xcProbeResult = d.xcProbe ?? null;
          step = 4;
          return;
        }

        // Step 4: Origin
        if (step === 4 && d.success) {
          step = 5;
          return;
        }

        // Step 5: Defaults set — let SvelteKit handle redirect
        if (step === 5) {
          await update();
          return;
        }

        // Fallback advance
        if (nextStep !== undefined) step = nextStep;
      } else if (result.type === "failure" && result.data) {
        if (step === 2 && !plexOAuthWaiting) {
          closePlexOAuthPopup();
        }
        stepErrors = normalizeStepErrors(result.data as Record<string, unknown>);
      } else if (result.type === "redirect") {
        await update();
      }
    };
  };
}
</script>

<svelte:head>
  <title>Setup — otpravkarr</title>
</svelte:head>

{#if isOAuthPopupCallback}
  <div class="flex items-center justify-center min-h-screen">
    <p class="text-sm text-muted-foreground">Plex sign-in complete. This window will close automatically.</p>
  </div>
{:else}
<main class="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-background text-foreground">
  <!-- ─── Header ──────────────────────────────────────────── -->
  <div class="mb-8 text-center">
    <h1 class="text-2xl font-semibold tracking-tight">
      otpravkarr
    </h1>
    <p class="mt-1 text-sm text-muted-foreground">
      First-time setup
    </p>
  </div>

  <!-- ─── Step indicator ──────────────────────────────────── -->
  <SetupWizard {steps} currentStep={step} class="mb-8 max-w-xl" />

  <!-- ─── Step content ────────────────────────────────────── -->
  <div class="w-full max-w-xl">
    <!-- ─────────── Step 0: Claim Instance ─────────── -->
    {#if step === 0}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Claim this instance</Card.Title>
          <Card.Description>
            Enter the bootstrap token from your server logs to prove you own this instance.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if hasError && stepErrors.error !== 'rate_limited'}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Verification failed</Alert.Title>
              <Alert.Description>
                {stepErrors.token ?? stepErrors.message ?? 'Invalid or expired token.'}
              </Alert.Description>
            </Alert.Root>
          {/if}

          {#if stepErrors.error === 'rate_limited'}
            <Alert.Root class="mb-4">
              <Alert.Title>Too many attempts</Alert.Title>
              <Alert.Description>
                Please wait a moment before trying again.
              </Alert.Description>
            </Alert.Root>
          {/if}

          <form method="POST" action="?/claimInstance" use:enhance={enhanceHandler()}>
            <div class="grid gap-4">
              <div class="grid gap-2">
                <Label for="bootstrap-token">Bootstrap token</Label>
                <Input
                  id="bootstrap-token"
                  name="token"
                  type="text"
                  placeholder="xxxx-xxxx-xxxx"
                  value={data.tokenFromUrl ?? ''}
                  autocomplete="off"
                  class="font-mono text-sm"
                  required
                />
                <p class="text-xs text-muted-foreground">
                  Find this token in your server's startup logs or environment variables.
                </p>
              </div>
              <Button type="submit" disabled={submitting} class="w-full">
                {#if submitting}
                  <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                  </svg>
                  Verifying…
                {:else}
                  Verify Token
                {/if}
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- ─────────── Step 1: Create Admin ─────────── -->
    {#if step === 1}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Create admin account</Card.Title>
          <Card.Description>
            Set up your administrator credentials for the dashboard.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if hasError}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Account creation failed</Alert.Title>
              <Alert.Description>
                {stepErrors.username ?? stepErrors.password ?? stepErrors.message ?? 'Please check your inputs.'}
              </Alert.Description>
            </Alert.Root>
          {/if}

          <form method="POST" action="?/createAdmin" use:enhance={enhanceHandler()}>
            <div class="grid gap-4">
              <div class="grid gap-2">
                <Label for="admin-username">Username</Label>
                <Input
                  id="admin-username"
                  name="username"
                  type="text"
                  placeholder="admin"
                  autocomplete="username"
                  required
                  minlength={3}
                  maxlength={32}
                  pattern="[a-zA-Z0-9_-]+"
                  bind:value={adminUsername}
                />
                <p class="text-xs text-muted-foreground">
                  3–32 characters. Letters, numbers, underscore, or dash.
                </p>
              </div>

              <div class="grid gap-2">
                <Label for="admin-password">Password</Label>
                <div class="relative">
                  <Input
                    id="admin-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    autocomplete="new-password"
                    required
                    bind:value={password}
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    onclick={() => (showPassword = !showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {#if showPassword}
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    {:else}
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    {/if}
                  </button>
                </div>

                <!-- Password strength indicator -->
                {#if password.length > 0}
                  <div class="grid gap-1.5">
                    <div class="flex gap-1 h-1">
                      {#each Array(5) as _, i}
                        <div
                          class={cn(
                            'flex-1 rounded-full transition-colors',
                            i < passwordStrength.level ? passwordStrength.color : 'bg-muted'
                          )}
                        ></div>
                      {/each}
                    </div>
                    <p class="text-xs text-muted-foreground">
                      {passwordStrength.label} — 12 characters minimum
                    </p>
                  </div>
                {/if}
              </div>

              <div class="grid gap-2">
                <Label for="admin-confirm-password">Confirm password</Label>
                <div class="relative">
                  <Input
                    id="admin-confirm-password"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    autocomplete="new-password"
                    required
                    bind:value={confirmPassword}
                  />
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    onclick={() => (showConfirmPassword = !showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {#if showConfirmPassword}
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    {:else}
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    {/if}
                  </button>
                </div>
                {#if confirmPassword.length > 0 && !passwordsMatch}
                  <p class="text-xs text-destructive">Passwords do not match.</p>
                {/if}
                {#if passwordsMatch}
                  <p class="text-xs text-green-600 dark:text-green-400">Passwords match.</p>
                {/if}
              </div>

              <Button type="submit" disabled={submitting} class="w-full">
                {#if submitting}
                  <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                  </svg>
                  Creating account…
                {:else}
                  Create Account
                {/if}
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- ─────────── Step 2: Connect Plex ─────────── -->
    {#if step === 2}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Connect your Plex server</Card.Title>
          <Card.Description>
            Link your Plex Media Server so otpravkarr can manage IPTV playlists.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if hasError}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Plex connection failed</Alert.Title>
              <Alert.Description>
                {stepErrors.plexUrl ?? stepErrors.plexToken ?? stepErrors.message ?? 'Could not connect to Plex.'}
              </Alert.Description>
            </Alert.Root>
          {/if}

          {#if plexOAuthPopupBlocked}
            <Alert.Root class="mb-4">
              <Alert.Title>Popup blocked</Alert.Title>
              <Alert.Description>
                Allow popups for this site, then click <span class="font-medium">Sign in with Plex</span> again.
              </Alert.Description>
            </Alert.Root>
          {/if}

          {#if plexServerInfo}
            <!-- Success state -->
            <div class="rounded-lg border border-green-500/20 bg-green-500/5 p-4 mb-4">
              <div class="flex items-center gap-2 mb-3">
                <svg class="h-5 w-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                <span class="font-medium text-sm">Connected</span>
                <Badge variant="secondary" class="ml-auto">Plex</Badge>
              </div>
              <dl class="grid gap-1.5 text-sm">
                <div class="flex justify-between">
                  <dt class="text-muted-foreground">Server</dt>
                  <dd class="font-medium">{plexServerInfo.friendlyName}</dd>
                </div>
                <Separator />
                <div class="flex justify-between">
                  <dt class="text-muted-foreground">Machine ID</dt>
                  <dd class="font-mono text-xs truncate max-w-48">{plexServerInfo.machineIdentifier}</dd>
                </div>
                <Separator />
                <div class="flex justify-between">
                  <dt class="text-muted-foreground">Version</dt>
                  <dd>{plexServerInfo.version}</dd>
                </div>
              </dl>
            </div>
            <Button onclick={() => (step = 3)} class="w-full">
              Continue
            </Button>
          {:else}
            <!-- Mode toggle -->
            <div class="flex rounded-lg bg-muted p-1 mb-4" role="tablist" aria-label="Plex connection method">
              <button
                type="button"
                role="tab"
                aria-selected={plexMode === 'token'}
                class={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  plexMode === 'token'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onclick={() => (plexMode = 'token')}
              >
                Direct Token
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={plexMode === 'oauth'}
                class={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  plexMode === 'oauth'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onclick={() => (plexMode = 'oauth')}
              >
                Sign in with Plex
              </button>
            </div>

            {#if plexMode === 'token'}
              <form method="POST" action="?/configurePlex" use:enhance={enhanceHandler()}>
                <input type="hidden" name="plexMode" value="token" />
                <div class="grid gap-4">
                  <div class="grid gap-2">
                    <Label for="plex-url">Plex server URL</Label>
                    <Input
                      id="plex-url"
                      name="plexServerUrl"
                      type="url"
                      placeholder="http://localhost:32400"
                      required
                    />
                  </div>
                  <div class="grid gap-2">
                    <Label for="plex-token">Plex token</Label>
                    <Input
                      id="plex-token"
                      name="plexToken"
                      type="password"
                      placeholder="Your X-Plex-Token"
                      autocomplete="off"
                      class="font-mono text-sm"
                      required
                    />
                    <p class="text-xs text-muted-foreground">
                      Find your token in Plex settings or browser developer tools.
                    </p>
                  </div>
                  <Button type="submit" disabled={submitting} class="w-full">
                    {#if submitting}
                      <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                      </svg>
                      Testing connection…
                    {:else}
                      Test Connection
                    {/if}
                  </Button>
                  <p class="text-xs text-muted-foreground mt-2 text-center">
                    Automatically retries with backoff if the server is temporarily unavailable.
                  </p>
                </div>
              </form>
            {:else}
              <!-- OAuth flow -->
              {#if plexOAuthWaiting}
                <div class="text-center py-6">
                  <svg class="mx-auto h-8 w-8 animate-spin text-primary mb-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                  </svg>
                  <p class="text-sm font-medium mb-1">Waiting for Plex authentication…</p>
                  <p class="text-xs text-muted-foreground mb-4">
                    Complete the sign-in in the popup window.
                  </p>

                  <form method="POST" action="?/configurePlex" use:enhance={enhanceHandler()}>
                    <input type="hidden" name="plexMode" value="oauth_complete" />
                    <input type="hidden" name="oauthId" value={plexOAuthId} />
                    <div class="grid gap-3">
                      <div class="grid gap-2">
                        <Label for="plex-url-oauth">Plex server URL</Label>
                        <Input
                          id="plex-url-oauth"
                          name="plexServerUrl"
                          type="url"
                          placeholder="http://localhost:32400"
                          required
                        />
                      </div>
                      <Button type="submit" disabled={submitting} class="w-full">
                        {#if submitting}
                          <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                            <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                          </svg>
                          Completing…
                        {:else}
                          Complete Connection
                        {/if}
                      </Button>
                    </div>
                  </form>
                </div>
              {:else}
                <form method="POST" action="?/configurePlex" use:enhance={enhanceHandler()} onsubmit={preparePlexOAuthPopup}>
                  <input type="hidden" name="plexMode" value="oauth_initiate" />
                  <div class="grid gap-4">
                    <div class="text-center py-2">
                      <p class="text-sm text-muted-foreground mb-4">
                        Sign in with your Plex account to automatically link your server.
                      </p>
                      <Button type="submit" disabled={submitting} class="w-full">
                        {#if submitting}
                          <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                            <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                          </svg>
                          Starting Plex sign-in…
                        {:else}
                          <svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" /></svg>
                          Sign in with Plex
                        {/if}
                      </Button>
                    </div>
                  </div>
                </form>
              {/if}
            {/if}

            <!-- Back button -->
          <Separator class="my-4" />
          <Button
            variant="ghost"
            onclick={() => {
              closePlexOAuthPopup();
              plexOAuthWaiting = false;
              step = 1;
            }}
            class="w-full text-muted-foreground"
          >
            <svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </Button>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- ─────────── Step 3: Connect Dispatcharr ─────────── -->
    {#if step === 3}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Connect Dispatcharr</Card.Title>
          <Card.Description>
            Link your Dispatcharr instance for channel management and IPTV orchestration.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if hasError}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Connection failed</Alert.Title>
              <Alert.Description>
                {stepErrors.dispatcharrUrl ?? stepErrors.apiKey ?? stepErrors.message ?? 'Could not connect to Dispatcharr.'}
              </Alert.Description>
            </Alert.Root>
          {/if}

          <form method="POST" action="?/configureDispatcharr" use:enhance={enhanceHandler()}>
            <div class="grid gap-4">
              <div class="grid gap-2">
                <Label for="dispatcharr-url">Dispatcharr URL</Label>
                <Input
                  id="dispatcharr-url"
                  name="dispatcharrUrl"
                  type="url"
                  placeholder="http://localhost:5001"
                  required
                />
              </div>
              <div class="grid gap-2">
                <Label for="dispatcharr-external-url">External URL (optional)</Label>
                <Input
                  id="dispatcharr-external-url"
                  name="dispatcharrExternalUrl"
                  type="url"
                  placeholder="https://tv.example.com"
                />
                <p class="text-xs text-muted-foreground">
                  Only needed if generated playlist URLs should point to a different address than the connection URL above (e.g., a public-facing reverse proxy).
                </p>
              </div>
              <div class="grid gap-2">
                <Label for="dispatcharr-key">API key</Label>
                <Input
                  id="dispatcharr-key"
                  name="dispatcharrApiKey"
                  type="password"
                  placeholder="Your Dispatcharr API key"
                  autocomplete="off"
                  class="font-mono text-sm"
                  required
                />
              </div>
              <Button type="submit" disabled={submitting} class="w-full">
                {#if submitting}
                  <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                  </svg>
                  Testing connection…
                {:else}
                  Test Connection
                {/if}
              </Button>
              <p class="text-xs text-muted-foreground mt-2 text-center">
                Automatically retries with backoff if the server is temporarily unavailable.
              </p>
            </div>
          </form>

          <Separator class="my-4" />
          <Button variant="ghost" onclick={() => (step = 2)} class="w-full text-muted-foreground">
            <svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- ─────────── Step 4: Configure Origins ─────────── -->
    {#if step === 4}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Security: Allowed Origins</Card.Title>
          <Card.Description>
            Configure which origins are permitted to make requests. This protects against cross-site request forgery (CSRF) attacks.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if hasError}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Configuration failed</Alert.Title>
              <Alert.Description>
                {stepErrors.origins ?? stepErrors.message ?? 'Could not save origin configuration.'}
              </Alert.Description>
            </Alert.Root>
          {/if}

          <form method="POST" action="?/configureOrigin" use:enhance={enhanceHandler()}>
            <div class="grid gap-4">
              <div class="grid gap-2">
                <Label for="allowed-origins">Allowed origins</Label>
                <Input
                  id="allowed-origins"
                  name="allowedOrigins"
                  type="text"
                  value={currentOrigin}
                  placeholder="http://localhost:3000"
                  required
                />
                <p class="text-xs text-muted-foreground">
                  Comma-separated list of allowed origins. Your current origin is pre-filled above.
                </p>
              </div>

              <Alert.Root>
                <Alert.Description>
                  The origin must match exactly — including protocol and port. For example: <code class="font-mono text-xs bg-muted px-1 py-0.5 rounded">http://192.168.1.100:3000</code>
                </Alert.Description>
              </Alert.Root>

              <Button type="submit" disabled={submitting} class="w-full">
                {#if submitting}
                  <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                  </svg>
                  Saving…
                {:else}
                  Save Origins
                {/if}
              </Button>
            </div>
          </form>

          <Separator class="my-4" />
          <Button variant="ghost" onclick={() => (step = 3)} class="w-full text-muted-foreground">
            <svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- ─────────── Step 5: Set Defaults ─────────── -->
    {#if step === 5}
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-lg">Default Settings</Card.Title>
          <Card.Description>
            Configure default preferences for channel syncing and provisioning.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {#if hasError}
            <Alert.Root variant="destructive" class="mb-4">
              <Alert.Title>Save failed</Alert.Title>
              <Alert.Description>
                {stepErrors.defaults ?? stepErrors.message ?? 'Could not save defaults.'}
              </Alert.Description>
            </Alert.Root>
          {/if}

          <form method="POST" action="?/setDefaults" use:enhance={enhanceHandler()}>
            <div class="grid gap-4">
              <!-- Default Group -->
              <div class="grid gap-2">
                <Label for="default-group">Default group</Label>
                {#if dispatcharrGroups.length > 0}
                  <Select.Root type="single" name="defaultGroupId" bind:value={defaultGroupId}>
                    <Select.Trigger id="default-group" class="w-full">
                      {dispatcharrGroups.find(g => String(g.id) === defaultGroupId)?.name ?? 'Select a group'}
                    </Select.Trigger>
                    <Select.Content preventScroll={false}>
                      {#each dispatcharrGroups as group (group.id)}
                        <Select.Item value={String(group.id)} label={group.name} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                {:else}
                  <Input
                    id="default-group"
                    name="defaultGroupId"
                    type="text"
                    placeholder="No groups loaded"
                    disabled
                  />
                  <p class="text-xs text-muted-foreground">
                    No groups were found. You can configure this later in settings.
                  </p>
                {/if}
              </div>

              <!-- Default Profile -->
              <div class="grid gap-2">
                <Label for="default-profile">Default profile</Label>
                {#if dispatcharrProfiles.length > 0}
                  <Select.Root type="single" name="defaultProfileId" bind:value={defaultProfileId}>
                    <Select.Trigger id="default-profile" class="w-full">
                      {#if defaultProfileId === ''}
                        All channels
                      {:else}
                        {dispatcharrProfiles.find(p => String(p.id) === defaultProfileId)?.name ?? 'All channels'}
                      {/if}
                    </Select.Trigger>
                    <Select.Content preventScroll={false}>
                      <Select.Item value="" label="All channels" />
                      {#each dispatcharrProfiles as profile (profile.id)}
                        <Select.Item value={String(profile.id)} label={profile.name} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                {:else}
                  <Input
                    id="default-profile"
                    name="defaultProfileId"
                    type="text"
                    value="All channels"
                    disabled
                  />
                {/if}
              </div>

              <!-- Sync Interval -->
              <div class="grid gap-2">
                <Label for="sync-interval">Sync interval (minutes)</Label>
                <Input
                  id="sync-interval"
                  name="syncInterval"
                  type="number"
                  min="1"
                  max="1440"
                  bind:value={syncInterval}
                />
                <p class="text-xs text-muted-foreground">
                  How often to sync channel data. Default: 15 minutes.
                </p>
              </div>

              <!-- Provisioning Mode -->
              <div class="grid gap-2">
                <Label for="provisioning-mode">Provisioning mode</Label>
                <Select.Root type="single" name="defaultProvisioningMode" bind:value={provisioningMode}>
                  <Select.Trigger id="provisioning-mode" class="w-full">
                    {provisioningMode === 'automatic' ? 'Automatic' : 'Self-managed'}
                  </Select.Trigger>
                  <Select.Content preventScroll={false}>
                    <Select.Item value="automatic" label="Automatic" />
                    <Select.Item value="self_managed" label="Self-managed" />
                  </Select.Content>
                </Select.Root>
                <p class="text-xs text-muted-foreground">
                  {#if provisioningMode === 'automatic'}
                    Channels will be automatically provisioned and synced.
                  {:else}
                    You manage channel assignments manually.
                  {/if}
                </p>
              </div>

              {#if xcProbeResult?.found}
                <Alert.Root>
                  <Alert.Title>XC Surface detected</Alert.Title>
                  <Alert.Description>
                    An Xtream Codes-compatible endpoint was found on your Dispatcharr instance.
                    {#if xcProbeResult.template}
                      Template: <code class="font-mono text-xs bg-muted px-1 py-0.5 rounded">{xcProbeResult.template}</code>
                    {/if}
                  </Alert.Description>
                </Alert.Root>
              {/if}

              <Separator />

              <Button type="submit" disabled={submitting} class="relative z-10 w-full">
                {#if submitting}
                  <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="opacity-75" />
                  </svg>
                  Completing setup…
                {:else}
                  Complete Setup
                {/if}
              </Button>
            </div>
          </form>

          <Separator class="my-4" />
          <Button variant="ghost" onclick={() => (step = 4)} class="w-full text-muted-foreground">
            <svg class="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}
  </div>

  <!-- ─── Footer ──────────────────────────────────────────── -->
  <p class="mt-8 text-xs text-muted-foreground">
    Step {step + 1} of {steps.length}
  </p>
</main>
{/if}
