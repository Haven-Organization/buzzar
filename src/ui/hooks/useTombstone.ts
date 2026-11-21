import { useCallback, useState } from "react";

import { Room, StateEvent } from "../../matrix";
import { parseTombstone, Tombstone } from "../utils/roomUpgrade";
import { useStateEventKeyCallback } from "./useStateEventKeyCallback";

/** Buzzar: the room's tombstone (set when it's upgraded), live. Undefined while the room is current. */
export function useTombstone(room: Room): Tombstone | undefined {
  const [tombstone, setTombstone] = useState<Tombstone>();
  const callback = useCallback(
    (event: StateEvent | undefined) =>
      setTombstone(parseTombstone(event as { content?: Record<string, unknown>; sender?: string }, room.id)),
    [room.id]
  );
  useStateEventKeyCallback(room, "m.room.tombstone", "", callback);
  return tombstone;
}
