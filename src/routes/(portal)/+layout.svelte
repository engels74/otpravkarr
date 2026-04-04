<script lang="ts">
import LogOutIcon from "lucide-svelte/icons/log-out";
import { Avatar, AvatarFallback, AvatarImage } from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";

let { data, children } = $props();
</script>

{#if data.user}
  <div class="page-shell">
    <header class="flex h-14 items-center justify-between border-b border-[hsl(var(--border))] px-4">
      <span class="text-sm font-semibold tracking-tight">otpravkarr</span>

      <div class="flex items-center gap-3">
        <Avatar class="h-8 w-8">
          {#if data.user.plexThumb}
            <AvatarImage src={data.user.plexThumb} alt={data.user.plexUsername} />
          {/if}
          <AvatarFallback>{data.user.plexUsername.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span class="text-sm text-[hsl(var(--muted-foreground))]">{data.user.plexUsername}</span>

        <form method="POST" action="/api/internal/signout">
          <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
            <LogOutIcon class="h-4 w-4" />
          </Button>
        </form>
      </div>
    </header>

    <main class="flex-1 p-6">
      {@render children()}
    </main>
  </div>
{:else}
  {@render children()}
{/if}
