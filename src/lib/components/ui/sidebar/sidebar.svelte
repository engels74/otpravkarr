<script lang="ts">
import type { HTMLAttributes } from "svelte/elements";
import * as Sheet from "$lib/components/ui/sheet/index.js";
import { cn, type WithElementRef } from "$lib/utils.js";
import { useSidebar } from "./context.svelte.js";

let {
  ref = $bindable(null),
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  class: className,
  children,
  ...restProps
}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
} = $props();

const _sidebar = useSidebar();
</script>

{#if collapsible === "none"}
	<div
		id="sidebar-main"
		class={cn(
			"bg-sidebar text-sidebar-foreground flex h-full w-[var(--sidebar-width)] flex-col",
			className
		)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
{:else if _sidebar.isMobile}
	<Sheet.Root
		bind:open={() => _sidebar.openMobile, (v) => _sidebar.setOpenMobile(v)}
		{...restProps}
	>
		<Sheet.Content
			id="sidebar-main"
			bind:ref
			data-sidebar="sidebar"
			data-slot="sidebar"
			data-mobile="true"
			class={cn(
				"bg-sidebar text-sidebar-foreground sidebar-mobile-width w-[var(--sidebar-width)] p-0 [&>button]:hidden",
				className
			)}
			{side}
		>
			<Sheet.Header class="sr-only">
				<Sheet.Title>Sidebar</Sheet.Title>
				<Sheet.Description>Displays the mobile sidebar.</Sheet.Description>
			</Sheet.Header>
			<div class="flex h-full w-full flex-col">
				{@render children?.()}
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<div
		id="sidebar-main"
		bind:this={ref}
		class="text-sidebar-foreground group peer hidden md:block"
		data-state={_sidebar.state}
		data-collapsible={_sidebar.state === "collapsed" ? collapsible : ""}
		data-variant={variant}
		data-side={side}
		data-slot="sidebar"
	>
		<!-- This is what handles the sidebar gap on desktop -->
		<div
			data-slot="sidebar-gap"
			class={cn(
				"transition-[width] duration-200 ease-linear relative w-[var(--sidebar-width)] bg-transparent",
				"group-data-[collapsible=offcanvas]:w-0",
				"group-data-[side=right]:rotate-180",
				variant === "floating" || variant === "inset"
					? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_var(--spacing)_*_4)]"
					: "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]"
			)}
		></div>
		<div
			data-slot="sidebar-container"
			class={cn(
				"fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
				side === "left"
					? "start-0 group-data-[collapsible=offcanvas]:start-[calc(var(--sidebar-width)_*_-1)]"
					: "end-0 group-data-[collapsible=offcanvas]:end-[calc(var(--sidebar-width)_*_-1)]",
				// Adjust the padding for floating and inset variants.
				variant === "floating" || variant === "inset"
					? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_var(--spacing)_*_4_+_2px)]"
					: "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-e group-data-[side=right]:border-s",
				className
			)}
			{...restProps}
		>
			<div
				data-sidebar="sidebar"
				data-slot="sidebar-inner"
				class="bg-sidebar group-data-[variant=floating]:ring-sidebar-border group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 flex size-full flex-col"
			>
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.sidebar-mobile-width) {
		--sidebar-width: 18rem;
	}
</style>
