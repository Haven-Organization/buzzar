/**
 * Buzzar: tell apart the browser releasing pointer lock (the user pressed Escape, which the browser handles itself
 * and never delivers to the page) from Buzzar's own code calling document.exitPointerLock() (opening chat, menus…).
 * One Escape then both frees the mouse and opens the overlay.
 */
let lastCodeExit = -Infinity;
let installed = false;

export function installPointerLockTracking() {
  if (installed) return;
  installed = true;
  const original = document.exitPointerLock.bind(document);
  document.exitPointerLock = () => {
    lastCodeExit = performance.now();
    original();
  };
}

/** True if the most recent pointer-lock release came from Buzzar's own code rather than the browser. */
export function wasReleasedByCode(withinMs = 500) {
  return performance.now() - lastCodeExit < withinMs;
}

/**
 * Locks the pointer for play, asking for raw mouse input (no OS acceleration, no cursor re-centring warps) where the
 * browser supports it, which is the most 1:1 mouse look. Falls back to a normal lock elsewhere.
 */
export function requestGamePointerLock(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas || document.pointerLockElement === canvas) return;
  const request = canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;
  try {
    const result = request.call(canvas, { unadjustedMovement: true });
    if (result && typeof result.catch === "function") {
      result.catch(() => canvas.requestPointerLock());
    }
  } catch {
    canvas.requestPointerLock();
  }
}
