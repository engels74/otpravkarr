<script lang="ts">
import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
import InfoIcon from "@lucide/svelte/icons/info";
import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import { mode } from "mode-watcher";
import type { ToasterProps as SonnerProps } from "svelte-sonner";
import { Toaster as Sonner } from "svelte-sonner";

let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current ?? "system"}
	class="cn-sonner toaster group pointer-events-none [&_li]:pointer-events-auto"
	{...restProps}
>
	{#snippet loadingIcon()}
		<LoaderCircleIcon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>

<style>
	:global(.cn-sonner) {
		--normal-bg: var(--color-popover);
		--normal-text: var(--color-popover-foreground);
		--normal-border: var(--color-border);
	}
</style>
