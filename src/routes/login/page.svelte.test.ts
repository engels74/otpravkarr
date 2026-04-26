import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

describe("login page", () => {
  it("allows empty submits to reach the server action", async () => {
    const { default: LoginPage } = await import("./+page.svelte");

    const { container } = render(LoginPage);
    const form = container.querySelector<HTMLFormElement>('form[method="POST"]');
    if (!form) throw new Error("Login form not found");

    expect(form.noValidate).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="username"]')?.required).toBe(
      true,
    );
    expect(container.querySelector<HTMLInputElement>('input[name="password"]')?.required).toBe(
      true,
    );
  });
});
