import { render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import PortalHeader from "../PortalHeader.svelte";

// ISSUE-009: the portal "My channels" link must expose aria-current="page" when
// the user is on /subscription.

const pageState = vi.hoisted(() => ({ url: new URL("http://localhost/") }));

vi.mock("$app/state", () => ({ page: pageState }));

afterEach(() => {
  pageState.url = new URL("http://localhost/");
});

describe("PortalHeader active nav (ISSUE-009)", () => {
  it("marks 'My channels' as aria-current=page on /subscription", () => {
    pageState.url = new URL("http://localhost/subscription");
    const { getByRole } = render(PortalHeader, {
      props: { plexUsername: "alice", plexThumb: null },
    });
    const link = getByRole("link", { name: "My channels" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark 'My channels' as current on other routes", () => {
    pageState.url = new URL("http://localhost/somewhere-else");
    const { getByRole } = render(PortalHeader, {
      props: { plexUsername: "alice", plexThumb: null },
    });
    const link = getByRole("link", { name: "My channels" });
    expect(link.getAttribute("aria-current")).toBeNull();
  });
});
