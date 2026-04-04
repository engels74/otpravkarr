<script lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from "$lib/components/ui/avatar";
import { cn } from "$lib/utils";

interface Props {
  thumbUrl: string | null;
  username: string;
  size?: "sm" | "default";
  class?: string;
}

let { thumbUrl, username, size = "default", class: className }: Props = $props();

let fallbackText = $derived(username.slice(0, 2).toUpperCase());
</script>

<Avatar {size} class={cn(className)}>
  {#if thumbUrl}
    <AvatarImage src={thumbUrl} alt={username} />
  {/if}
  <AvatarFallback>{fallbackText}</AvatarFallback>
</Avatar>
