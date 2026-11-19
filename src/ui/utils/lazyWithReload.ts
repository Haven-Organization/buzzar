import { ComponentType, lazy } from "react";

/** sessionStorage key: when we last reloaded for a missing chunk (ms since epoch). */
const RELOADED_AT = "buzzar.chunkReloadAt";
/** Don't reload again within this long (ms) of the last time, so a chunk that is really broken can't loop. */
const RELOAD_GUARD = 30_000;

/**
 * Buzzar: React.lazy that reloads the page when the chunk is gone. Each build names its chunks by content hash and a
 * deploy replaces the old ones, so an app still running the previous build failed to load a view it hadn't loaded yet
 * (the main menu after disconnecting, say) and React unmounted everything: a blank white screen. Reloading picks up
 * the new build. Throws as before if it reloaded for this very recently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound as React.lazy
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      if (shouldReload()) {
        window.location.reload();
        // Never settles: the page is going away.
        return new Promise<{ default: T }>(() => undefined);
      }
      throw error;
    }
  });
}

function shouldReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < RELOAD_GUARD) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    return true;
  } catch {
    // No sessionStorage: reload once is still better than a white screen, but we can't guard a loop, so don't.
    return false;
  }
}
