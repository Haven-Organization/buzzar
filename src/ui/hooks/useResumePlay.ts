import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef } from "react";

import { awaitingLockAtom, mouseFreedAtom } from "../state/mouseMode";
import { worldAtom } from "../state/world";
import { markGameResumed, requestGamePointerLock } from "../utils/pointerLock";
import { useMainThreadContext } from "./useMainThread";

/**
 * Buzzar: going back to the game from the overlay, chat or editor. Takes the mouse back for looking around, unless
 * the player had freed it with Tab (that mode stays). If the browser refuses the lock (Escape isn't a user gesture),
 * "Click to play" shows until it's captured. Stable across renders, so it's safe in key handlers with fixed deps.
 */
export function useResumePlay() {
  const mainThread = useMainThreadContext();
  const setAwaitingLock = useSetAtom(awaitingLockAtom);
  const state = useRef({ mouseFreed: false, entered: false });
  state.current.mouseFreed = useAtomValue(mouseFreedAtom);
  state.current.entered = useAtomValue(worldAtom).entered;

  return useCallback(() => {
    if (!state.current.entered || state.current.mouseFreed) return;
    markGameResumed();
    if (document.pointerLockElement === mainThread.canvas) return;
    requestGamePointerLock(mainThread.canvas);
    setAwaitingLock(true);
  }, [mainThread, setAwaitingLock]);
}
