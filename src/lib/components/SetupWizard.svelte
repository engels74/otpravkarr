<script lang="ts">
import { cn } from "$lib/utils";

interface Props {
  steps: readonly string[];
  currentStep: number;
  class?: string;
}

let { steps, currentStep, class: className }: Props = $props();
</script>

<nav aria-label="Setup progress" class={cn("w-full", className)}>
  <ol class="flex items-center justify-between">
    {#each steps as label, i}
      {@const isCompleted = i < currentStep}
      {@const isCurrent = i === currentStep}
      <li class="flex flex-col items-center gap-1.5 relative flex-1">
        {#if i > 0}
          <div
            class={cn(
              'absolute top-3.5 right-1/2 w-full h-px -translate-y-1/2',
              i <= currentStep ? 'bg-primary' : 'bg-border'
            )}
            aria-hidden="true"
          ></div>
        {/if}
        <div
          class={cn(
            'relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors',
            isCompleted && 'bg-primary border-primary text-primary-foreground',
            isCurrent && 'border-primary bg-background text-primary',
            !isCompleted && !isCurrent && 'border-muted bg-muted/30 text-muted-foreground'
          )}
          aria-current={isCurrent ? 'step' : undefined}
        >
          {#if isCompleted}
            <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="sr-only">Completed:</span>
          {:else}
            {i + 1}
          {/if}
        </div>
        <span
          class={cn(
            'text-xs hidden sm:block',
            isCurrent && 'text-foreground font-medium',
            !isCurrent && 'text-muted-foreground'
          )}
        >
          {label}
        </span>
      </li>
    {/each}
  </ol>
</nav>
