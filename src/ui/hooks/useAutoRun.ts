import { useEffect } from "react";
import { useAtomValue } from "jotai";

import { autoRunAtom } from "../state/autoRun";
import { useMainThreadContext } from "./useMainThread";
import { Thread } from "../../engine/module/module.common";
import { AutoRunMessage, AutoRunMessageData } from "../../engine/player/autoRun.common";

/** Buzzar: keeps the game's movement in step with the Auto Run setting. Mounted once, in SessionView. */
export function useAutoRunSync() {
  const mainThread = useMainThreadContext();
  const enabled = useAtomValue(autoRunAtom);
  useEffect(() => {
    mainThread.sendMessage<AutoRunMessageData>(Thread.Game, { type: AutoRunMessage, enabled });
  }, [mainThread, enabled]);
}
