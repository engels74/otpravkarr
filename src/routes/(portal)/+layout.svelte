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
    <PortalHeader plexUsername={data.user.plexUsername} plexThumb={data.user.plexThumb} />
    <main class="flex-1 p-6">
      {@render children()}
    </main>
  </div>
{:else}
  {@render children()}
{/if}
