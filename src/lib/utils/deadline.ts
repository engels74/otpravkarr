/**
 * Race `work` against a wall-clock deadline, resolving to `fallback` if the
 * deadline wins OR if `work` rejects. Never rejects.
 *
 * Used to bound multi-phase interactive loads (e.g. the `/users` Dispatcharr
 * block: parallel groups+profiles then a sequential paginated drift fetch) that
 * a per-request timeout cannot bound. On timeout the caller renders its
 * already-available data (DB rows) with the degraded value, well within the
 * adapter's idle-socket window.
 *
 * The pending `work` promise is left to settle on its own (its underlying
 * request timeouts still fire); we simply stop awaiting it. The timer is
 * cleared when `work` settles first so it never holds the event loop open.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);

    work.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}
