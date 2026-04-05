import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import PlexAvatar from "$lib/components/PlexAvatar.svelte";

describe("PlexAvatar", () => {
  it("renders an img when thumbUrl is provided", () => {
    const { container } = render(PlexAvatar, {
      props: { thumbUrl: "https://plex.tv/photo.jpg", username: "TestUser" },
    });
    // bits-ui Avatar keeps img hidden until load event fires (won't fire in jsdom)
    // so query by data attribute instead of role
    const img = container.querySelector("[data-avatar-image]") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://plex.tv/photo.jpg");
    expect(img).toHaveAttribute("alt", "TestUser");
  });

  it("shows fallback initials when thumbUrl is null", () => {
    render(PlexAvatar, { props: { thumbUrl: null, username: "JaneDoe" } });
    expect(screen.getByText("JA")).toBeInTheDocument();
  });

  it("uppercases the first 2 characters for fallback", () => {
    render(PlexAvatar, { props: { thumbUrl: null, username: "alice" } });
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("renders avatar with data-slot='avatar'", () => {
    const { container } = render(PlexAvatar, {
      props: { thumbUrl: null, username: "Bob" },
    });
    expect(container.querySelector("[data-slot='avatar']")).toBeInTheDocument();
  });

  it("applies size prop to avatar", () => {
    const { container } = render(PlexAvatar, {
      props: { thumbUrl: null, username: "Test", size: "sm" },
    });
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar).toHaveAttribute("data-size", "sm");
  });
});
