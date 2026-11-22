/**
 * Buzzar: tell apart the browser releasing pointer lock (the user pressed Escape, which the browser handles itself
 * and never delivers to the page) from Buzzar's own code calling document.exitPointerLock() (opening chat, menus…).
 * One Escape then both frees the mouse and opens the overlay.
 */
import { touchControlsEnabled } from "../../engine/input/touchControls";

let lastCodeExit = -Infinity;
let lastResume = -Infinity;
let installed = false;
let pendingLock: { canvas: HTMLCanvasElement; at: number } | undefined;

export function installPointerLockTracking() {
  if (installed) return;
  installed = true;
  const original = document.exitPointerLock.bind(document);
  document.exitPointerLock = () => {
    lastCodeExit = performance.now();
    // Buzzar: our own code letting go of the mouse (overlay, chat, Tab…) cancels any pending retry.
    pendingLock = undefined;
    original();
  };
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) pendingLock = undefined;
  });
}

/**
 * Marks that the player just went back to the game (closing the overlay with Escape). A held Escape repeats, and the
 * browser spends the repeat on releasing the new lock: that release must not count as "Escape pressed, open the
 * overlay", which made the overlay pop straight back up.
 */
export function markGameResumed() {
  lastResume = performance.now();
}

export function resumedRecently(withinMs = 1000) {
  return performance.now() - lastResume < withinMs;
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
  // Buzzar (Third Room #156): with touch controls you look by dragging; there's no pointer to lock.
  if (touchControlsEnabled()) return;
  // Buzzar: browsers refuse the lock without a user gesture (Escape, which closes the overlay, doesn't count as one)
  // and for a moment after the user released it with Escape. Remember the request until it succeeds, so the desktop
  // app can retry it as a gesture (see buzzarResumePointerLock below).
  pendingLock = { canvas, at: performance.now() };
  attemptLock(canvas, 0);
}

type LockRequest = (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;

function attemptLock(canvas: HTMLCanvasElement, attempt: number) {
  // Refused because the previous lock was released with Escape a moment ago: a click's gesture stays valid for a few
  // seconds, so try again shortly (clicking "Close Overlay" right after opening it with Escape).
  const retryIfTooSoon = (error: unknown) => {
    if (!(error instanceof DOMException) || error.name !== "SecurityError" || attempt >= 6) return;
    setTimeout(() => {
      const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
      if (pendingLock?.canvas !== canvas || document.pointerLockElement === canvas) return;
      if (activation && !activation.isActive) return;
      attemptLock(canvas, attempt + 1);
    }, 250);
  };
  const plainLock = () => {
    try {
      const result = (canvas.requestPointerLock as LockRequest).call(canvas);
      if (result && typeof result.catch === "function") result.catch(retryIfTooSoon);
    } catch (error) {
      retryIfTooSoon(error);
    }
  };
  try {
    const result = (canvas.requestPointerLock as LockRequest).call(canvas, { unadjustedMovement: true });
    if (result && typeof result.catch === "function") {
      result.catch((error: unknown) => {
        // Raw input isn't supported everywhere (e.g. Linux): fall back to a normal lock.
        if (error instanceof DOMException && error.name === "SecurityError") retryIfTooSoon(error);
        else plainLock();
      });
    }
  } catch {
    plainLock();
  }
}

/**
 * Buzzar: the desktop app (Electron) calls this as a user gesture a few times over the ~1.5 s after an Escape key is
 * released. If Escape just closed the overlay (or chat/editor) and the lock was refused (no gesture, or too soon after
 * the previous Escape released it), take it now, so the player goes straight back to looking around without
 * clicking. Does nothing once the lock is held, or when nothing asked for it.
 */
function resumePointerLockFromApp() {
  const pending = pendingLock;
  if (!pending || document.pointerLockElement === pending.canvas) return;
  if (performance.now() - pending.at > 3000 || !pending.canvas.isConnected) {
    pendingLock = undefined;
    return;
  }
  // A lock taken and then dropped again by the browser must not read as "Escape pressed, open the overlay".
  markGameResumed();
  requestGamePointerLock(pending.canvas);
  pendingLock = pending;
}

(window as Window & { buzzarResumePointerLock?: () => void }).buzzarResumePointerLock = resumePointerLockFromApp;
