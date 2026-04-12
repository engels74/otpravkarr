<script lang="ts">
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif";
import "../app.css";
import { ModeWatcher } from "mode-watcher";
import { Toaster } from "$lib/components/ui/sonner";

let { children } = $props();
</script>

<div class="page-shell">
  {@render children()}
</div>

<ModeWatcher defaultMode="dark" />
<Toaster richColors />
