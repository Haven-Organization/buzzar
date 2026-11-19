/**
 * Buzzar: runs one tick of a thread's systems, so that one system throwing doesn't stop the rest, or the loop.
 *
 * Upstream ran systems bare: one exception (a resource removed mid-frame, a bad world file) killed the game loop and
 * the world froze for good. Now the failing system skips the rest of its own work for that tick and everything else
 * carries on. Errors are logged the first time and then once every `LOG_EVERY` repeats, so a system failing every
 * tick doesn't flood the console.
 */
const LOG_EVERY = 600;

export interface SystemErrorLog {
  counts: Map<Function, number>;
}

export function createSystemErrorLog(): SystemErrorLog {
  return { counts: new Map() };
}

export function runSystems<Ctx>(
  ctx: Ctx,
  systems: ((ctx: Ctx) => void)[],
  log: SystemErrorLog,
  report: (message: string, error: unknown) => void = (message, error) => console.error(message, error)
) {
  for (let i = 0; i < systems.length; i++) {
    const system = systems[i];
    try {
      system(ctx);
    } catch (error) {
      const count = (log.counts.get(system) ?? 0) + 1;
      log.counts.set(system, count);
      if (count === 1 || count % LOG_EVERY === 0) {
        const repeats = count > 1 ? ` (${count} times so far)` : "";
        report(`${system.name || "A system"} failed${repeats}; the rest of the frame carried on.`, error);
      }
    }
  }
}
