import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "$lib/db/types";

const mocks = vi.hoisted(() => ({
  goto: vi.fn(async () => undefined),
}));

vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
}));

vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/audit"),
  },
}));

const entryWithDetail: AuditEntry = {
  id: 1,
  timestamp: "2025-01-01T10:00:00Z",
  actor: "admin",
  action: "admin.login",
  detail: JSON.stringify({ scope: "settings", changed: true }),
  ip_address: "127.0.0.1",
};

const defaultData = {
  entries: [entryWithDetail],
  total: 1,
  filters: {
    action: null,
    actor: null,
    after: null,
    before: null,
    page: 1,
    limit: 25,
  },
  totalPages: 1,
  auditActions: ["admin.login"],
};

describe("admin audit page", () => {
  beforeEach(() => {
    mocks.goto.mockClear();
  });

  it("renders a 24px detail expand control and expands formatted JSON", async () => {
    const { default: AuditPage } = await import("./+page.svelte");

    render(AuditPage, { props: { data: defaultData } });

    const expandButton = screen.getByRole("button", {
      name: /Expand detail for admin\.login/,
    });
    expect(expandButton.classList.contains("size-6")).toBe(true);

    await fireEvent.click(expandButton);

    expect(screen.getByText(/"scope": "settings"/)).toBeTruthy();
    expect(expandButton.getAttribute("aria-expanded")).toBe("true");
  });
});
