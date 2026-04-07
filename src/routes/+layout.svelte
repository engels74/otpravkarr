<script lang="ts">
import "../app.css";
import { Toaster } from "$lib/components/ui/sonner";

let { children } = $props();
</script>

<div class="page-shell">
  {@render children()}
</div>

<Toaster richColors />
