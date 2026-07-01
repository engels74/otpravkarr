<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import { afterNavigate } from "$app/navigation";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { cn, type WithElementRef } from "$lib/utils.js";
import { SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_COOKIE_NAME } from "./constants.js";
import { setSidebar } from "./context.svelte.js";

let {
  ref = $bindable(null),
  open = $bindable(true),
  onOpenChange = () => {},
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = $props();

const _sidebar = setSidebar({
  open: () => open,
  setOpen: (value: boolean) => {
    open = value;
    onOpenChange(value);

    // biome-ignore lint/suspicious/noDocumentCookie: shadcn sidebar state persistence
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  },
});

// Auto-close the mobile drawer after in-drawer navigation. Must live in the
// provider: it owns the sidebar context (set during its own render), so nav
// links rendered by AdminSidebar's <script> cannot reach useSidebar(). Desktop
// is a no-op (isMobile is false). Only the (admin) group uses this provider.
afterNavigate(() => {
  if (_sidebar.isMobile) _sidebar.setOpenMobile(false);
});
</script>

<svelte:window onkeydown={_sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0}>
	<div
		data-slot="sidebar-wrapper"
		class={cn(
			"group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
			className
		)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>

<style>
	:global([data-slot="sidebar-wrapper"]) {
		--sidebar-width: 16rem;
		--sidebar-width-icon: 3rem;
	}
</style>
