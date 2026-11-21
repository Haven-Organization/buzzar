/**
 * Buzzar's Matrix layer: the "faster sync" (sliding sync, MSC4186) setting. Off by default while it's experimental.
 * Kept per browser, and read when a session starts, so changing it needs a reload.
 */
const SLIDING_SYNC_KEY = "buzzar.slidingSync";
/** Set when the setting changes: the next start clears the local sync cache, which the two kinds of sync can't share. */
const RESET_SYNC_STORE_KEY = "buzzar.resetSyncStore";

function read(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function isSlidingSyncEnabled(): boolean {
  return read(SLIDING_SYNC_KEY);
}

export function setSlidingSyncEnabled(enabled: boolean) {
  if (enabled === isSlidingSyncEnabled()) return;
  try {
    if (enabled) localStorage.setItem(SLIDING_SYNC_KEY, "1");
    else localStorage.removeItem(SLIDING_SYNC_KEY);
    localStorage.setItem(RESET_SYNC_STORE_KEY, "1");
  } catch {
    // storage unavailable: the setting can't be kept
  }
}

/** Whether the local sync cache has to be cleared before this start (and forgets the request). */
export function takeSyncStoreReset(): boolean {
  const wanted = read(RESET_SYNC_STORE_KEY);
  try {
    localStorage.removeItem(RESET_SYNC_STORE_KEY);
  } catch {
    // ignore
  }
  return wanted;
}
