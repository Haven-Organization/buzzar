import { useCallback } from "react";
import { useSetAtom } from "jotai";

import { overlayVisibilityAtom } from "../state/overlayVisibility";
import { overlayWindowAtom, OverlayWindowValue } from "../state/overlayWindow";
import { worldChatVisibilityAtom } from "../state/worldChatVisibility";

/** Buzzar: opens the overlay on a given screen, from inside a world too (frees the mouse, closes world chat). */
export function useOpenOverlayWindow() {
  const setOverlayWindow = useSetAtom(overlayWindowAtom);
  const setOverlayVisibility = useSetAtom(overlayVisibilityAtom);
  const setWorldChatVisibility = useSetAtom(worldChatVisibilityAtom);
  return useCallback(
    (value: OverlayWindowValue) => {
      if (document.pointerLockElement) document.exitPointerLock();
      setWorldChatVisibility(false);
      setOverlayWindow(value);
      setOverlayVisibility(true);
    },
    [setOverlayWindow, setOverlayVisibility, setWorldChatVisibility]
  );
}
