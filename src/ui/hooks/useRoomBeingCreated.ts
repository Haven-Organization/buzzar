import { RoomBeingCreated, Session } from "../../matrix";
import { useObservableMap } from "./useObservableMap";

export function useRoomBeingCreated(session: Session, roomId: string | undefined): RoomBeingCreated | undefined {
  const roomsBeingCreated = useObservableMap(() => session.roomsBeingCreated, [session.roomsBeingCreated]);
  return roomId ? roomsBeingCreated.get(roomId) : undefined;
}
