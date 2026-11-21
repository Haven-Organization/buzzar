import { useMemo } from "react";

import { GroupCall } from "../../matrix";
import { getRoomCall } from "../utils/matrixUtils";

export function useRoomCall(calls: Map<string, GroupCall>, roomId: string | undefined) {
  return useMemo(() => {
    return getRoomCall(calls, roomId);
  }, [calls, roomId]);
}
