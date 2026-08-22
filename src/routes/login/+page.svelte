<script lang="ts">
import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
import { enhance } from "$app/forms";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";

interface Props {
  form?: {
    error?: string;
    resetAt?: number;
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_credentials: "Username and password are required.",
  invalid_credentials: "Invalid username or password.",
  rate_limited: "Too many login attempts. Please wait and try again.",
};

let { form }: Props = $props();
let submitting = $state(false);
let countdownSeconds = $state(0);
let rateLimitCleared = $state(false);

$effect(() => {
  if (form?.error !== "rate_limited" || !form.resetAt) {
    countdownSeconds = 0;
    rateLimitCleared = false;
    return;
  }

  const resetAt = form.resetAt;
  rateLimitCleared = false;

  let interval: ReturnType<typeof setInterval>;

  function tick() {
    const remaining = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
    countdownSeconds = remaining;
    if (remaining <= 0) {
      rateLimitCleared = true;
      clearInterval(interval);
    }
  }

  interval = setInterval(tick, 1000);
  tick();
  return () => clearInterval(interval);
});

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

let errorMessage = $derived(
  form?.error === "rate_limited" && rateLimitCleared
    ? "You can now try again."
    : form?.error === "rate_limited" && countdownSeconds > 0
      ? `Too many login attempts. Try again in ${formatCountdown(countdownSeconds)}.`
      : form?.error
        ? (ERROR_MESSAGES[form.error] ?? "Unable to sign in.")
        : null,
);

let errorVariant = $derived<"default" | "destructive">(
  form?.error === "rate_limited" && rateLimitCleared ? "default" : "destructive",
);
let errorTitle = $derived(
  form?.error === "rate_limited" && rateLimitCleared ? "Ready to retry" : "Authentication failed",
);

function enhanceHandler() {
  submitting = true;
  return async ({ update }: { update: () => Promise<void> }) => {
    submitting = false;
    await update();
  };
}
</script>

<svelte:head>
  <title>Login — otpravkarr</title>
</svelte:head>

<a
  href="#main-content"
  class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-primary"
>
  Skip to main content
</a>
<main id="main-content" tabindex="-1" class="hero-glow-bg min-h-screen flex flex-col items-center justify-center px-4 py-12 text-foreground">
  <div class="reveal reveal-1 mb-8 text-center">
    <p class="eyebrow">OTPRAVKARR</p>
    <h1 class="display-hero mt-2">Welcome back.</h1>
    <p class="mt-3 text-sm text-muted-foreground">Sign in to the admin console.</p>
  </div>

  <div class="reveal reveal-2 w-full max-w-sm">
    <Card.Root class="surface-elevated">
      <Card.Header>
        <Card.Title class="text-lg">Sign in</Card.Title>
        <Card.Description>
          Enter your credentials to access the dashboard.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if errorMessage}
          <Alert.Root variant={errorVariant} class="mb-4">
            <Alert.Title>{errorTitle}</Alert.Title>
            <Alert.Description>{errorMessage}</Alert.Description>
          </Alert.Root>
        {/if}

        <form method="POST" novalidate use:enhance={enhanceHandler}>
          <div class="reveal reveal-3 grid gap-4">
            <div class="grid gap-2">
              <Label for="login-username">Username</Label>
              <Input
                id="login-username"
                name="username"
                type="text"
                autocomplete="username"
                required
              />
            </div>

            <div class="grid gap-2">
              <Label for="login-password">Password</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autocomplete="current-password"
                required
              />
            </div>

            <Button type="submit" disabled={submitting} class="cta-glow w-full">
              {#if submitting}
                <LoaderCircleIcon class="mr-2 h-4 w-4 animate-spin" />
                Signing in…
              {:else}
                Sign In
              {/if}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card.Root>
  </div>
</main>
