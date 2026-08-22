<script lang="ts">
import QrCodeIcon from "@lucide/svelte/icons/qr-code";
import { Button } from "$lib/components/ui/button";
import { cn } from "$lib/utils";

interface Props {
  value: string;
  alt?: string;
  size?: number;
  class?: string;
}

let { value, alt = "QR Code", size = 200, class: className }: Props = $props();
let dataUri = $state<string | null>(null);
let generating = $state(false);
let error = $state<string | null>(null);

$effect(() => {
  value;
  dataUri = null;
  error = null;
});

async function generateQrCode() {
  generating = true;
  error = null;

  try {
    const QRCode = await import("qrcode");
    dataUri = await QRCode.toDataURL(value, { margin: 1, width: size });
  } catch {
    error = "Couldn't generate the QR code. Try copying the URL instead.";
  } finally {
    generating = false;
  }
}
</script>

<div class={cn("inline-flex flex-col items-center gap-3 rounded-lg border border-border bg-white p-3", className)}>
  {#if dataUri}
    <img src={dataUri} {alt} width={size} height={size} class="rounded" />
  {:else}
    <Button variant="outline" onclick={generateQrCode} disabled={generating}>
      <QrCodeIcon class="mr-2 h-4 w-4" />
      {generating ? "Generating QR code…" : "Generate QR code"}
    </Button>
  {/if}
  {#if error}
    <p class="max-w-48 text-center text-xs text-destructive" role="status">{error}</p>
  {/if}
</div>
