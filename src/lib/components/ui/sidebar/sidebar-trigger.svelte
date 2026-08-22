<script lang="ts">
import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
import type { ComponentProps } from "svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { cn } from "$lib/utils.js";
import { useSidebar } from "./context.svelte.js";

let {
  ref = $bindable(null),
  class: className,
  onclick,
  ...restProps
}: ComponentProps<typeof Button> & {
  onclick?: (e: MouseEvent) => void;
} = $props();

const _sidebar = useSidebar();

// ISSUE-002: report the contextually-correct open state. On mobile the drawer is
// driven by `openMobile`, not the desktop `open` flag (which defaults to true and
// would leave aria-expanded stuck at "true" on phones).
const expanded = $derived(_sidebar.isMobile ? _sidebar.openMobile : _sidebar.open);

// The mobile Sheet content carrying id="sidebar-main" is only mounted while the
// drawer is open; on desktop the panel is always mounted. Only advertise
// aria-controls when that target actually exists, otherwise it dangles.
const controls = $derived(
  _sidebar.isMobile ? (_sidebar.openMobile ? "sidebar-main" : undefined) : "sidebar-main",
);
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn("cn-sidebar-trigger", className)}
	type="button"
	aria-expanded={expanded}
	aria-controls={controls}
	onclick={(e) => {
		onclick?.(e);
		_sidebar.toggle();
	}}
	{...restProps}
>
	<PanelLeftIcon  />
	<span class="sr-only">Toggle Sidebar</span>
</Button>
