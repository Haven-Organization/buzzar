import { useMemo } from "react";

import { GroupCall, Session } from "../../matrix";
import { useCalls } from "./useCalls";

export function useCallsByRoom(session: Session, roomId: string): GroupCall[] {
  const calls = useCalls(session);
  return useMemo(() => Array.from(calls.values()).filter((call) => call.roomId === roomId) || [], [roomId, calls]);
}
