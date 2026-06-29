<script lang="ts">
import { untrack } from "svelte";
import { setSidebar } from "../context.svelte.js";
import SidebarTrigger from "../sidebar-trigger.svelte";

interface Props {
  onReady: (state: ReturnType<typeof setSidebar>) => void;
  open?: boolean;
}

let { onReady, open = true }: Props = $props();

const state = setSidebar({
  open: () => open,
  setOpen: (value) => {
    open = value;
  },
});

untrack(() => onReady(state));
</script>

<SidebarTrigger />
