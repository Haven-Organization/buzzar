import { Room, Session } from "../../matrix";
import { aliasToRoomId } from "../utils/matrixUtils";
import { useObservableMapValue } from "./useObservableMapValue";

export function useRoom(session: Session, roomIdOrAlias: string | undefined): Room | undefined {
  const isAlias = !!roomIdOrAlias?.startsWith("#");
  return useObservableMapValue(
    session.rooms,
    roomIdOrAlias,
    isAlias
      ? (rooms) => {
          const roomId = aliasToRoomId(session.rooms, roomIdOrAlias as string);
          return roomId ? rooms.get(roomId) : undefined;
        }
      : undefined
  );
}
