import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import HealthBadge from "$lib/components/HealthBadge.svelte";

describe("HealthBadge", () => {
  describe("plex type", () => {
    it("shows 'Healthy' for status='healthy'", () => {
      render(HealthBadge, { props: { type: "plex", status: "healthy" } });
      expect(screen.getByText("Healthy")).toBeInTheDocument();
    });

    it("shows 'Unauthorized' for status='unauthorized'", () => {
      render(HealthBadge, { props: { type: "plex", status: "unauthorized" } });
      expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    });

    it("shows 'Server Changed' for status='server_changed'", () => {
      render(HealthBadge, { props: { type: "plex", status: "server_changed" } });
      expect(screen.getByText("Server Changed")).toBeInTheDocument();
    });

    it("shows 'Unreachable' for unknown status", () => {
      render(HealthBadge, { props: { type: "plex", status: "down" } });
      expect(screen.getByText("Unreachable")).toBeInTheDocument();
    });

    it("uses green styling for healthy", () => {
      const { container } = render(HealthBadge, {
        props: { type: "plex", status: "healthy" },
      });
      const badge = container.querySelector("span");
      expect(badge?.className).toContain("green");
    });

    it("uses red styling for errors", () => {
      const { container } = render(HealthBadge, {
        props: { type: "plex", status: "unauthorized" },
      });
      const badge = container.querySelector("span");
      expect(badge?.className).toContain("red");
    });

    it("uses amber styling for server_changed", () => {
      const { container } = render(HealthBadge, {
        props: { type: "plex", status: "server_changed" },
      });
      const badge = container.querySelector("span");
      expect(badge?.className).toContain("amber");
    });
  });

  describe("dispatcharr type", () => {
    it("shows 'Healthy' when reachable and authValid", () => {
      render(HealthBadge, {
        props: { type: "dispatcharr", status: "", reachable: true, authValid: true },
      });
      expect(screen.getByText("Healthy")).toBeInTheDocument();
    });

    it("shows 'Auth Invalid' when reachable but not authValid", () => {
      render(HealthBadge, {
        props: { type: "dispatcharr", status: "", reachable: true, authValid: false },
      });
      expect(screen.getByText("Auth Invalid")).toBeInTheDocument();
    });

    it("shows 'Unreachable' when not reachable", () => {
      render(HealthBadge, {
        props: { type: "dispatcharr", status: "", reachable: false, authValid: false },
      });
      expect(screen.getByText("Unreachable")).toBeInTheDocument();
    });
  });

  describe("database type", () => {
    it("shows 'Healthy' for status='healthy'", () => {
      render(HealthBadge, { props: { type: "database", status: "healthy" } });
      expect(screen.getByText("Healthy")).toBeInTheDocument();
    });

    it("shows 'Unhealthy' for non-healthy status", () => {
      render(HealthBadge, { props: { type: "database", status: "error" } });
      expect(screen.getByText("Unhealthy")).toBeInTheDocument();
    });

    it("uses green styling for healthy database", () => {
      const { container } = render(HealthBadge, {
        props: { type: "database", status: "healthy" },
      });
      const badge = container.querySelector("span");
      expect(badge?.className).toContain("green");
    });

    it("uses red styling for unhealthy database", () => {
      const { container } = render(HealthBadge, {
        props: { type: "database", status: "error" },
      });
      const badge = container.querySelector("span");
      expect(badge?.className).toContain("red");
    });
  });
});
