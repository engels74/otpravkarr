<script lang="ts">
import { page } from "$app/state";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
</script>

<svelte:head>
  <title>Error {page.status} — otpravkarr</title>
</svelte:head>

<div class="page-shell flex items-center justify-center p-6">
  <Card.Root class="w-full max-w-md">
    <Card.Header>
      <Card.Title class="text-lg">Error {page.status}</Card.Title>
      <Card.Description>Something went wrong.</Card.Description>
    </Card.Header>
    <Card.Content>
      <p class="text-sm text-muted-foreground">
        {page.error?.message ?? "An unexpected error occurred."}
      </p>
    </Card.Content>
    <Card.Footer>
      <a href="/" class="w-full">
        <Button variant="outline" class="w-full">Go home</Button>
      </a>
    </Card.Footer>
  </Card.Root>
</div>
