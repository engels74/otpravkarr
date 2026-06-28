import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// bits-ui's body-scroll-lock schedules a ~24ms `setTimeout` to restore body
// styles after an overlay (Dialog/DropdownMenu/Select/…) closes. In jsdom-backed
// component tests, if the test file's environment is torn down within that
// window, the timer later fires against a dead `document` ("document is not
// defined") and surfaces as a flaky cross-file unhandled error. Flushing pending
// timers after each jsdom test lets that cleanup run while `document` is still
// alive. Node-env (server) tests have no `document` and skip this entirely.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/svelte");
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
});
