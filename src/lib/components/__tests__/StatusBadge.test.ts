import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import StatusBadge from "$lib/components/StatusBadge.svelte";

describe("StatusBadge", () => {
  describe("status prop", () => {
    it("renders 'active' label", () => {
      render(StatusBadge, { props: { status: "active" } });
      expect(screen.getByText("active")).toBeInTheDocument();
    });

    it("renders 'inactive' label", () => {
      render(StatusBadge, { props: { status: "inactive" } });
      expect(screen.getByText("inactive")).toBeInTheDocument();
    });

    it("renders 'orphaned' label", () => {
      render(StatusBadge, { props: { status: "orphaned" } });
      expect(screen.getByText("orphaned")).toBeInTheDocument();
    });
  });

  describe("mode prop", () => {
    it("renders 'Automatic' label for automatic mode", () => {
      render(StatusBadge, { props: { mode: "automatic" } });
      expect(screen.getByText("Automatic")).toBeInTheDocument();
    });

    it("renders 'Self-managed' label for self_managed mode", () => {
      render(StatusBadge, { props: { mode: "self_managed" } });
      expect(screen.getByText("Self-managed")).toBeInTheDocument();
    });

    it("renders 'Staff' label for staff mode", () => {
      render(StatusBadge, { props: { mode: "staff" } });
      expect(screen.getByText("Staff")).toBeInTheDocument();
    });
  });

  describe("Badge variant", () => {
    it("uses data-slot='badge' element", () => {
      const { container } = render(StatusBadge, { props: { status: "active" } });
      expect(container.querySelector("[data-slot='badge']")).toBeInTheDocument();
    });
  });
});
