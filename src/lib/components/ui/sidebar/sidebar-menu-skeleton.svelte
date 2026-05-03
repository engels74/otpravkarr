<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { cn, type WithElementRef } from "$lib/utils.js";

let {
  ref = $bindable(null),
  class: className,
  showIcon = false,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLElement>> & {
  showIcon?: boolean;
} = $props();

// Discretized width bucket between 50% and 90% so the visual variety stays
// while staying within the static CSS table below (CSP forbids inline style).
const _widthBucket = String((Math.floor(Math.random() * 5) + 5) * 10);
</script>

<div
	bind:this={ref}
	data-slot="sidebar-menu-skeleton"
	data-sidebar="menu-skeleton"
	class={cn("h-8 gap-2 rounded-md px-2 flex items-center", className)}
	{...restProps}
>
	{#if showIcon}
		<Skeleton class="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />
	{/if}
	<Skeleton
		class="sidebar-menu-skeleton-text h-4 flex-1"
		data-sidebar="menu-skeleton-text"
		data-width={_widthBucket}
	/>
	{@render children?.()}
</div>

<style>
	:global(.sidebar-menu-skeleton-text) { max-width: 70%; }
	:global(.sidebar-menu-skeleton-text[data-width="50"]) { max-width: 50%; }
	:global(.sidebar-menu-skeleton-text[data-width="60"]) { max-width: 60%; }
	:global(.sidebar-menu-skeleton-text[data-width="70"]) { max-width: 70%; }
	:global(.sidebar-menu-skeleton-text[data-width="80"]) { max-width: 80%; }
	:global(.sidebar-menu-skeleton-text[data-width="90"]) { max-width: 90%; }
</style>
