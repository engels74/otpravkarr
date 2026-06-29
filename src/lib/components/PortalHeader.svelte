<script lang="ts">
import LogOutIcon from "lucide-svelte/icons/log-out";
import { page } from "$app/state";
import AppLogo from "$lib/components/AppLogo.svelte";
import PlexAvatar from "$lib/components/PlexAvatar.svelte";
import { Button } from "$lib/components/ui/button";

interface Props {
  plexUsername: string;
  plexThumb: string | null;
  class?: string;
}

let { plexUsername, plexThumb, class: className }: Props = $props();
</script>

<header class="glass-header flex h-14 items-center justify-between px-4 {className ?? ''}">
  <AppLogo />

  <nav aria-label="Account" class="flex items-center gap-3">
    <a
      href="/subscription"
      class="text-sm text-muted-foreground no-underline transition hover:text-foreground"
      aria-current={page.url.pathname === "/subscription" ? "page" : undefined}
    >
      My channels
    </a>
    <PlexAvatar thumbUrl={plexThumb} username={plexUsername} size="sm" />
    <span class="text-sm text-muted-foreground">{plexUsername}</span>

    <form method="POST" action="/api/internal/signout">
      <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
        <LogOutIcon class="h-4 w-4" />
      </Button>
    </form>
  </nav>
</header>
