<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
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
