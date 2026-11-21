/**
 * Buzzar: how long start-up takes, step by step. Each call logs the time since the page started loading, e.g.
 * `[startup] sync ready +4210 ms`, so a slow start can be read off the console.
 */
const seen = new Set<string>();

export function markStartup(label: string) {
  // Only the first time: later world loads and re-syncs aren't start-up.
  if (seen.has(label)) return;
  seen.add(label);
  console.info(`[startup] ${label} +${Math.round(performance.now())} ms`);
}
