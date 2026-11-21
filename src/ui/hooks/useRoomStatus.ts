import { ObservableValue, RoomStatus, Session } from "../../matrix";
import { useAsyncObservableValue } from "./useAsyncObservableValue";

export function useRoomStatus(session: Session, roomId?: string) {
  return useAsyncObservableValue<RoomStatus>(
    () => (roomId ? session.observeRoomStatus(roomId) : Promise.resolve(new ObservableValue(undefined))),
    [session, roomId]
  );
}
