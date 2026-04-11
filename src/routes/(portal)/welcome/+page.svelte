<script lang="ts">
import LayoutDashboardIcon from "lucide-svelte/icons/layout-dashboard";
import MonitorSmartphoneIcon from "lucide-svelte/icons/monitor-smartphone";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";

interface Props {
  data: {
    plexUsername: string;
  };
}

const { data }: Props = $props();
</script>

<svelte:head>
  <title>Welcome — otpravkarr</title>
</svelte:head>

<main
  class="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-background text-foreground"
>
  <div class="mb-8 text-center">
    <h1 class="text-2xl font-semibold tracking-tight">Welcome, {data.plexUsername}</h1>
    <p class="mt-1 text-sm text-muted-foreground">Where would you like to go?</p>
  </div>

  <div class="w-full max-w-lg grid grid-cols-1 sm:grid-cols-2 gap-4">
    <a href="/dashboard" class="no-underline">
      <Card.Root class="h-full transition-colors hover:border-primary">
        <Card.Header class="text-center">
          <LayoutDashboardIcon class="mx-auto h-8 w-8 text-primary" />
          <Card.Title class="text-lg">Admin Dashboard</Card.Title>
          <Card.Description>Manage users, settings, and sync</Card.Description>
        </Card.Header>
      </Card.Root>
    </a>

    <a href="/" class="no-underline">
      <Card.Root class="h-full transition-colors hover:border-primary">
        <Card.Header class="text-center">
          <MonitorSmartphoneIcon class="mx-auto h-8 w-8 text-primary" />
          <Card.Title class="text-lg">Setup Guide</Card.Title>
          <Card.Description>View your streaming credentials and player setup</Card.Description>
        </Card.Header>
      </Card.Root>
    </a>
  </div>

  <form method="POST" action="/api/internal/signout" class="mt-6">
    <Button variant="ghost" type="submit" class="text-sm text-muted-foreground">Sign out</Button>
  </form>
</main>
