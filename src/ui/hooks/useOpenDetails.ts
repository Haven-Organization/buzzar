import { useCallback } from "react";
import { useAtom } from "jotai";

import { DetailsItem, OverlayWindow, overlayWindowAtom } from "../state/overlayWindow";

/** Buzzar: opens the details page for a world, avatar or Item; its back button returns to the current window. */
export function useOpenDetails() {
  const [current, setOverlayWindow] = useAtom(overlayWindowAtom);
  return useCallback(
    (item: DetailsItem) =>
      setOverlayWindow({
        type: OverlayWindow.Details,
        item,
        back: current.type === OverlayWindow.Details ? current.back : current,
      }),
    [current, setOverlayWindow]
  );
}
