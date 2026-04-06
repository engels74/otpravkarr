<script lang="ts">
import "../app.css";

let { children } = $props();
</script>

<div class="page-shell">
  {@render children()}
</div>
