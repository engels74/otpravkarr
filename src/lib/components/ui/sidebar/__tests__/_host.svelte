<script lang="ts">
import { untrack } from "svelte";
import { setSidebar } from "../context.svelte.js";

interface Props {
  onReady: (state: ReturnType<typeof setSidebar>) => void;
  setOpen: (value: boolean) => void;
  open?: boolean;
}

let { onReady, setOpen, open = false }: Props = $props();

const state = setSidebar({
  open: () => open,
  setOpen: (value) => {
    open = value;
    setOpen(value);
  },
});

untrack(() => onReady(state));
</script>
