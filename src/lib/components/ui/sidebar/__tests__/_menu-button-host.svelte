<script lang="ts">
import { setSidebar } from "../context.svelte.js";
import SidebarMenuButton from "../sidebar-menu-button.svelte";

interface Props {
  isActive?: boolean;
}

let { isActive = false }: Props = $props();

setSidebar({
  open: () => true,
  setOpen: () => {},
});
</script>

<SidebarMenuButton {isActive}>Dashboard</SidebarMenuButton>
