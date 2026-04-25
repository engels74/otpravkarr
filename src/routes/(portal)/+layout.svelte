<script lang="ts">
import PortalHeader from "$lib/components/PortalHeader.svelte";
import { clearUserSession, setUserSession } from "$lib/state/user-session.svelte";

let { data, children } = $props();

$effect(() => {
  if (data.user) {
    setUserSession({
      plexUsername: data.user.plexUsername,
      plexThumb: data.user.plexThumb,
      provisioningMode: data.user.provisioningMode,
      isActive: data.user.isActive,
    });
  }
  return clearUserSession;
});
</script>

{#if data.user}
  <div class="page-shell">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-primary"
    >
      Skip to main content
    </a>
    <PortalHeader plexUsername={data.user.plexUsername} plexThumb={data.user.plexThumb} />
    <main id="main-content" class="flex-1 p-6">
      {@render children()}
    </main>
  </div>
{:else}
  {@render children()}
{/if}
