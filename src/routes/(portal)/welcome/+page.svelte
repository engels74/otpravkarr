<script lang="ts">
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import MonitorSmartphoneIcon from "@lucide/svelte/icons/monitor-smartphone";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";

interface Props {
  data: {
    plexUsername: string;
  };
}

let { data }: Props = $props();
</script>

<svelte:head>
  <title>Welcome — otpravkarr</title>
</svelte:head>

<div
  class="hero-glow-bg min-h-screen flex flex-col items-center justify-center px-4 py-12 text-foreground"
>
  <div class="reveal reveal-1 mb-8 text-center">
    <p class="eyebrow">WELCOME</p>
    <h1 class="display-hero mt-2">Hi, {data.plexUsername}.</h1>
    <p class="mt-3 text-sm text-muted-foreground">Where would you like to go?</p>
  </div>

  <div class="reveal reveal-2 w-full max-w-lg grid grid-cols-1 sm:grid-cols-2 gap-4">
    <a href="/login" class="no-underline">
      <Card.Root class="h-full transition hover:-translate-y-0.5 hover:shadow-md hover:border-primary">
        <Card.Header class="text-center">
          <span class="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LayoutDashboardIcon class="h-5 w-5" />
          </span>
          <Card.Title class="text-lg">Admin Dashboard</Card.Title>
          <Card.Description
            >Sign in as admin to manage users, settings, and sync</Card.Description
          >
        </Card.Header>
      </Card.Root>
    </a>

    <a href="/" class="no-underline">
      <Card.Root class="h-full transition hover:-translate-y-0.5 hover:shadow-md hover:border-primary">
        <Card.Header class="text-center">
          <span class="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <MonitorSmartphoneIcon class="h-5 w-5" />
          </span>
          <Card.Title class="text-lg">Setup Guide</Card.Title>
          <Card.Description>View your streaming credentials and player setup</Card.Description>
        </Card.Header>
      </Card.Root>
    </a>
  </div>

  <form method="POST" action="/api/internal/signout" class="mt-6">
    <Button variant="ghost" type="submit" class="text-sm text-muted-foreground">Sign out</Button>
  </form>
</div>
