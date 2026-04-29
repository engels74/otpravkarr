import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { setSidebar } from "../context.svelte.js";
import Host from "./_host.svelte";

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
  setOpenCalls: boolean[];
  cleanup: () => void;
}

function createHarness(): Harness {
  const setOpenCalls: boolean[] = [];
  const target = document.createElement("div");
  document.body.appendChild(target);
  let captured: SidebarState | null = null;
  const app = mount(Host, {
    target,
    props: {
      onReady: (state: SidebarState) => {
        captured = state;
      },
      setOpen: (value: boolean) => setOpenCalls.push(value),
    },
  });
  if (!captured) {
    throw new Error("SidebarState was not captured during mount");
  }
  return {
    sidebar: captured,
    setOpenCalls,
    cleanup: () => {
      unmount(app);
      target.remove();
    },
  };
}

describe("SidebarState.handleShortcutKeydown", () => {
  let restoreMatchMedia: (() => void) | undefined;

  afterEach(() => {
    restoreMatchMedia?.();
    restoreMatchMedia = undefined;
  });

  it("closes the mobile drawer when Escape is pressed on mobile", () => {
    restoreMatchMedia = installMatchMedia(true);
    const { sidebar, setOpenCalls, cleanup } = createHarness();
    try {
      expect(sidebar.isMobile).toBe(true);

      sidebar.setOpenMobile(true);
      expect(sidebar.openMobile).toBe(true);

      sidebar.handleShortcutKeydown(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(sidebar.openMobile).toBe(false);
      expect(setOpenCalls).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("does not toggle the desktop sidebar when Escape is pressed on desktop", () => {
    restoreMatchMedia = installMatchMedia(false);
    const { sidebar, setOpenCalls, cleanup } = createHarness();
    try {
      expect(sidebar.isMobile).toBe(false);

      sidebar.handleShortcutKeydown(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(setOpenCalls).toEqual([]);
      expect(sidebar.openMobile).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("does nothing on mobile when the drawer is already closed", () => {
    restoreMatchMedia = installMatchMedia(true);
    const { sidebar, setOpenCalls, cleanup } = createHarness();
    try {
      expect(sidebar.openMobile).toBe(false);

      sidebar.handleShortcutKeydown(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(sidebar.openMobile).toBe(false);
      expect(setOpenCalls).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
