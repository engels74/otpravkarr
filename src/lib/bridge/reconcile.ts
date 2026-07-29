import type { DispatcharrClient } from "$lib/dispatcharr/client";
import { reconcileEcmScope } from "./ecm-scope";
import { reconcileSync } from "./lifecycle";
import { reconcileQuarantineGroups } from "./quarantine-sync";
import { reconcileSubscriptions } from "./subscription-sync";

/**
 * Outcome of a full reconcile cycle. Each post-friend-sync step is captured
 * independently; a failure in one is recorded as `{ error }` rather than
 * aborting the others.
 */
export interface FullReconcileResult {
  report: Awaited<ReturnType<typeof reconcileSync>>;
  quarantine: Awaited<ReturnType<typeof reconcileQuarantineGroups>> | { error: string };
  subscriptions: Awaited<ReturnType<typeof reconcileSubscriptions>> | { error: string };
  /** Read-only ECM scope analysis; it never changes plugin configuration. */
  ecmScope: Awaited<ReturnType<typeof reconcileEcmScope>> | { error: string };
}

/**
 * Run the complete post-sync reconcile sequence used by BOTH the scheduled job
 * and the manual "Run Sync Now" route, so the two paths can never diverge again
 * (ISSUE-005):
 *
 *   reconcileSync → reconcileQuarantineGroups → reconcileSubscriptions → reconcileEcmScope
 *
 * Contract:
 * - `reconcileSync` owns the single `sync.completed` audit write; this helper
 *   does NOT write it (de-dupes ISSUE-006/007).
 * - Each step after the friend sync runs in its own try/catch so one failure
 *   never aborts the rest. Quarantine runs before subscriptions so renamed junk
 *   groups stay hidden this cycle; ECM runs last to report the scope of freshly
 *   created group profiles without changing ECM.
 * - This helper MUST NOT acquire the scheduler lock. Callers already own the
 *   `plex-dispatcharr-sync` exclusivity (the manual route wraps it in
 *   `scheduler.runExclusive`; the scheduled path is serialized by the runner).
 *   Double-locking would deadlock / self-409.
 */
export async function runFullReconcile(
  client: DispatcharrClient,
  plexAdminToken: string,
): Promise<FullReconcileResult> {
  const report = await reconcileSync(client, plexAdminToken);

  let quarantine: FullReconcileResult["quarantine"];
  try {
    quarantine = await reconcileQuarantineGroups(client);
  } catch (error) {
    quarantine = { error: error instanceof Error ? error.message : String(error) };
  }

  let subscriptions: FullReconcileResult["subscriptions"];
  try {
    subscriptions = await reconcileSubscriptions(client);
  } catch (error) {
    subscriptions = { error: error instanceof Error ? error.message : String(error) };
  }

  let ecmScope: FullReconcileResult["ecmScope"];
  try {
    ecmScope = await reconcileEcmScope(client);
  } catch (error) {
    ecmScope = { error: error instanceof Error ? error.message : String(error) };
  }

  return { report, quarantine, subscriptions, ecmScope };
}
