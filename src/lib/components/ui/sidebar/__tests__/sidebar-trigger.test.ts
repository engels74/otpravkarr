import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { setSidebar } from "../context.svelte.js";
import TriggerHost from "./_trigger-host.svelte";

// ISSUE-002: the mobile sidebar trigger must report the contextually-correct
// open state. On mobile the drawer is driven by openMobile (not the desktop
// `open` flag), and aria-controls must not dangle to the unmounted Sheet content
// while the drawer is closed.

type SidebarState = ReturnType<typeof setSidebar>;

function installMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
  return () => {
    if (original) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    } else {
      delete (window as Partial<Window>).matchMedia;
    }
  };
}

interface Harness {
  sidebar: SidebarState;
  button: HTMLElement;
  cleanup: () => void;
}

function createHarness(open = true): Harness {
  const target = document.createElement("div");
  document.body.appendChild(target);
  let captured: SidebarState | null = null;
  const app = mount(TriggerHost, {
    target,
    props: {
      open,
      onReady: (state: SidebarState) => {
        captured = state;
      },
    },
  });
  if (!captured) {
    throw new Error("SidebarState was not captured during mount");
  }
  const button = target.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]');
  if (!button) {
    throw new Error("SidebarTrigger button was not rendered");
  }
  return {
    sidebar: captured,
    button,
    cleanup: () => {
      unmount(app);
      target.remove();
    },
  };
}

describe("SidebarTrigger aria state (ISSUE-002)", () => {
  let restoreMatchMedia: (() => void) | undefined;

  afterEach(() => {
    restoreMatchMedia?.();
    restoreMatchMedia = undefined;
  });

  it("reflects the desktop open flag and keeps a stable aria-controls", () => {
    restoreMatchMedia = installMatchMedia(false);
    const { sidebar, button, cleanup } = createHarness(true);
    try {
      expect(sidebar.isMobile).toBe(false);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      // The desktop panel carrying id="sidebar-main" is always mounted.
      expect(button.getAttribute("aria-controls")).toBe("sidebar-main");
    } finally {
      cleanup();
    }
  });

  it("reports collapsed on desktop when the sidebar is closed", () => {
    restoreMatchMedia = installMatchMedia(false);
    const { button, cleanup } = createHarness(false);
    try {
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(button.getAttribute("aria-controls")).toBe("sidebar-main");
    } finally {
      cleanup();
    }
  });

  it("tracks openMobile (not the desktop flag) and drops the dangling aria-controls on mobile", () => {
    restoreMatchMedia = installMatchMedia(true);
    // open=true would have made the buggy trigger report expanded forever.
    const { sidebar, button, cleanup } = createHarness(true);
    try {
      expect(sidebar.isMobile).toBe(true);

      // Drawer closed: collapsed, and no aria-controls (the Sheet content is unmounted).
      expect(sidebar.openMobile).toBe(false);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(button.getAttribute("aria-controls")).toBeNull();

      // Drawer open: expanded, and aria-controls now points at the mounted content.
      sidebar.setOpenMobile(true);
      flushSync();
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(button.getAttribute("aria-controls")).toBe("sidebar-main");
    } finally {
      cleanup();
    }
  });
});
