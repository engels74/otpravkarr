<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  dataUri: string;
  alt?: string;
  size?: number;
  class?: string;
}

let { dataUri, alt = "QR Code", size = 200, class: className }: Props = $props();
</script>

<div class={cn("inline-flex items-center justify-center rounded-lg border border-border bg-white p-3", className)}>
  <img
    src={dataUri}
    {alt}
    width={size}
    height={size}
    class="rounded"
  />
</div>
