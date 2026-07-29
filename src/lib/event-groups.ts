/** Group/profile names whose visibility is owned by Event Channel Managarr. */
export function isEcmManagedGroupName(name: string): boolean {
  return name.endsWith(" — PPV/Events") || name.endsWith(" — Unscheduled Events");
}

/** Whether a profile name can round-trip through ECM's comma-separated scope field. */
export function isEcmCsvSafeProfileName(name: string): boolean {
  return !name.includes(",");
}
