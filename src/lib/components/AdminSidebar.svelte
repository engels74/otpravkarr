<script lang="ts">
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import LogOutIcon from "@lucide/svelte/icons/log-out";
import PuzzleIcon from "@lucide/svelte/icons/puzzle";
import ScrollTextIcon from "@lucide/svelte/icons/scroll-text";
import SettingsIcon from "@lucide/svelte/icons/settings";
import UsersIcon from "@lucide/svelte/icons/users";
import type { Snippet } from "svelte";
import { page } from "$app/state";
import AppLogo from "$lib/components/AppLogo.svelte";
import { Separator } from "$lib/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "$lib/components/ui/sidebar";
import { cn } from "$lib/utils";

interface Props {
  username: string;
  children: Snippet;
  class?: string;
}

let { username, children, class: className }: Props = $props();

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { label: "Users", href: "/users", icon: UsersIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
  { label: "Plugins", href: "/plugins", icon: PuzzleIcon },
  { label: "Audit Log", href: "/audit", icon: ScrollTextIcon },
] as const;
</script>

<SidebarProvider>
  <!-- Skip link must be the FIRST focusable element (WCAG 2.4.1): render it
       before the sidebar nav so the initial Tab reaches it. -->
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-primary"
  >
    Skip to main content
  </a>
  <Sidebar>
    <SidebarHeader>
      <div class="flex flex-col gap-1 px-2 py-2">
        <AppLogo size="sm" />
        <span class="eyebrow pl-8">Admin console</span>
      </div>
    </SidebarHeader>

    <SidebarSeparator />

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Navigation</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Admin navigation">
            <SidebarMenu>
              {#each navItems as item (item.href)}
                {@const isActive = page.url.pathname === item.href}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    {isActive}
                    tooltipContent={item.label}
                    class={cn(
                      "relative",
                      isActive &&
                        "bg-sidebar-accent/60 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r before:bg-primary [&_svg]:text-primary",
                    )}
                  >
                    {#snippet child({ props })}
                      <a href={item.href} {...props}>
                        <item.icon />
                        <span>{item.label}</span>
                      </a>
                    {/snippet}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              {/each}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarSeparator />
      <div class="flex items-center justify-between px-2 py-1.5">
        <span class="truncate text-xs text-muted-foreground">{username}</span>
        <form method="POST" action="/api/internal/signout">
          <button
            type="submit"
            class="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="Sign out"
          >
            <LogOutIcon class="h-4 w-4" />
          </button>
        </form>
      </div>
    </SidebarFooter>
  </Sidebar>

  <SidebarInset>
    <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" class="mr-2 !h-4" />
      <span class="text-sm font-medium text-muted-foreground">Admin</span>
    </header>
    <main id="main-content" tabindex="-1" class={cn("flex-1 p-6", className)}>
      {@render children()}
    </main>
  </SidebarInset>
</SidebarProvider>
