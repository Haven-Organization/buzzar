import { useCallback, useRef } from "react";

import { Room } from "../../matrix";
import { getMxIdUsername } from "../utils/matrixUtils";
import { useRoomMembers } from "./useRoomMembers";

/**
 * Buzzar: a stable lookup from a Matrix user ID to their display name in `room`, falling back to the username.
 * The world call's members come from Hydrogen without display names (Third Room #404, #348), so names come from
 * the room's member list instead, the same as the nametags.
 */
export function useMemberDisplayName(room: Room) {
  const { joined } = useRoomMembers(room) ?? {};
  const joinedRef = useRef(joined);
  joinedRef.current = joined;
  return useCallback(
    (userId: string) =>
      joinedRef.current?.find((member) => member.userId === userId)?.displayName || getMxIdUsername(userId),
    []
  );
}
