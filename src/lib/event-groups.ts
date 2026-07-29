/** Group/profile names whose visibility is owned by Event Channel Managarr. */
export function isEcmManagedGroupName(name: string): boolean {
  return name.endsWith(" — PPV/Events") || name.endsWith(" — Unscheduled Events");
}
