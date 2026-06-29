import { mount, unmount } from "svelte";
import { beforeAll, describe, expect, it } from "vitest";
import MenuButtonHost from "./_menu-button-host.svelte";

// SidebarMenuButton pulls in the sidebar context (IsMobile → matchMedia), so a
// matchMedia stub must exist before any mount.
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    });
  }
});

// ISSUE-009: the active sidebar nav item must expose aria-current="page" to
// assistive technology, not only the visual data-active styling hook.

function render(isActive: boolean) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const app = mount(MenuButtonHost, { target, props: { isActive } });
  const button = target.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"]');
  if (!button) {
    throw new Error("SidebarMenuButton was not rendered");
  }
  return {
    button,
    cleanup: () => {
      unmount(app);
      target.remove();
    },
  };
}

describe("SidebarMenuButton aria-current (ISSUE-009)", () => {
  it("emits aria-current=page when active", () => {
    const { button, cleanup } = render(true);
    try {
      expect(button.getAttribute("aria-current")).toBe("page");
      // Existing styling hook must remain.
      expect(button.getAttribute("data-active")).toBe("true");
    } finally {
      cleanup();
    }
  });

  it("omits aria-current when inactive", () => {
    const { button, cleanup } = render(false);
    try {
      expect(button.getAttribute("aria-current")).toBeNull();
      expect(button.getAttribute("data-active")).toBeNull();
    } finally {
      cleanup();
    }
  });
});
