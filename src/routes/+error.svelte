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
      <Card.Description>
        {page.status === 404
          ? "This page doesn't exist."
          : (page.error?.message ?? "Something went wrong.")}
      </Card.Description>
    </Card.Header>
    <Card.Footer>
      <Button href="/" variant="outline" class="w-full">Go home</Button>
    </Card.Footer>
  </Card.Root>
</div>
