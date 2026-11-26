import { useSetAtom } from "jotai";

import { overlayVisibilityAtom } from "../state/overlayVisibility";
import { useMainThreadContext } from "./useMainThread";
import { markGameResumed, requestGamePointerLock } from "../utils/pointerLock";

/** Closes the overlay and takes the pointer back while the click still counts as a gesture. */
export function useReturnToWorld() {
  const mainThread = useMainThreadContext();
  const setOverlayVisibility = useSetAtom(overlayVisibilityAtom);
  return () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    markGameResumed();
    requestGamePointerLock(mainThread.canvas);
    setOverlayVisibility(false);
  };
}
