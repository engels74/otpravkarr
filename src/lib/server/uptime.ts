let startTime: number | null = null;

export function markServerStarted(): void {
  startTime = Date.now();
}

export function getServerStartTime(): number {
  return startTime ?? Date.now();
}
