<script lang="ts">
import LayoutDashboardIcon from "lucide-svelte/icons/layout-dashboard";
import LogOutIcon from "lucide-svelte/icons/log-out";
import ScrollTextIcon from "lucide-svelte/icons/scroll-text";
import SettingsIcon from "lucide-svelte/icons/settings";
import UsersIcon from "lucide-svelte/icons/users";
import { page } from "$app/state";
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

let { data, children } = $props();

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { label: "Users", href: "/users", icon: UsersIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
  { label: "Audit Log", href: "/audit", icon: ScrollTextIcon },
] as const;
</script>

<SidebarProvider>
  <Sidebar>
    <SidebarHeader>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <span class="text-sm font-semibold tracking-tight">otpravkarr</span>
      </div>
    </SidebarHeader>

    <SidebarSeparator />

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Navigation</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {#each navItems as item (item.href)}
              <SidebarMenuItem>
                <SidebarMenuButton isActive={page.url.pathname === item.href} tooltipContent={item.label}>
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
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarSeparator />
      <div class="flex items-center justify-between px-2 py-1.5">
        <span class="truncate text-xs text-muted-foreground">{data.username}</span>
        <form method="POST" action="/api/internal/signout">
          <button
            type="submit"
            class="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
    <div class="flex-1 p-6">
      {@render children()}
    </div>
  </SidebarInset>
</SidebarProvider>
