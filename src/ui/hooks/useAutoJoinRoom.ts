import { useEffect } from "react";

import { Session } from "../../matrix";
import { useRoom } from "./useRoom";

export function useAutoJoinRoom(session: Session, roomIdOrAlias: string) {
  const room = useRoom(session, roomIdOrAlias);

  useEffect(() => {
    if (room === undefined) {
      session.joinRoom(roomIdOrAlias);
    }
  }, [session, roomIdOrAlias, room]);

  return room;
}
