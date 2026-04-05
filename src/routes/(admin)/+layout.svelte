<script lang="ts">
import AdminSidebar from "$lib/components/AdminSidebar.svelte";
import { clearAdminSession, setAdminSession } from "$lib/state/admin-session.svelte";

let { data, children } = $props();

$effect(() => {
  setAdminSession({ username: data.username });
  return clearAdminSession;
});
</script>

<AdminSidebar username={data.username}>
  {@render children()}
</AdminSidebar>
