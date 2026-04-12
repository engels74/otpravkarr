<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  steps: readonly string[];
  currentStep: number;
  class?: string;
}

let { steps, currentStep, class: className }: Props = $props();

// Progress percentage along the connector line. With N steps, the line spans
// from the centre of step 0 to the centre of step N-1. We fill it relative
// to the current step (0..N-1).
let progressPct = $derived(steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0);
</script>

<nav aria-label="Setup progress" class={cn("w-full", className)}>
  <!-- Connector track + fill -->
  <div class="relative">
    <div
      class="absolute left-0 right-0 top-3.5 h-px -translate-y-1/2 bg-border"
      aria-hidden="true"
    ></div>
    <div
      class="absolute left-0 top-3.5 h-px -translate-y-1/2 bg-primary transition-[width] duration-300"
      style="width: {progressPct}%"
      aria-hidden="true"
    ></div>

    <ol class="relative flex items-start justify-between">
      {#each steps as label, i}
        {@const isCompleted = i < currentStep}
        {@const isCurrent = i === currentStep}
        <li class="flex flex-col items-center gap-1.5">
          <div
            class={cn(
              "relative z-10 inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 px-2 text-xs font-medium transition-colors",
              isCompleted && "bg-primary border-primary text-primary-foreground",
              isCurrent && "border-primary bg-background text-primary animate-pulse",
              !isCompleted && !isCurrent && "border-border bg-background text-muted-foreground",
            )}
            aria-current={isCurrent ? "step" : undefined}
          >
            {#if isCompleted}
              <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M3 8.5l3.5 3.5L13 4.5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="sr-only">Completed:</span>
            {:else}
              {i + 1}
            {/if}
          </div>
          <span
            class={cn(
              "text-xs hidden sm:block",
              isCurrent && "text-foreground font-medium",
              !isCurrent && "text-muted-foreground",
            )}
          >
            {label}
          </span>
        </li>
      {/each}
    </ol>
  </div>
</nav>
