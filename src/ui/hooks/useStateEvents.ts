import { useEffect, useState } from "react";

import { ObservableMap, Room, StateEvent } from "../../matrix";
import { useIsMounted } from "./useIsMounted";
import { useObservableMap } from "./useObservableMap";

export function useStateEvents(room: Room, eventType: string) {
  const [eventObservable, setEventObservable] = useState(new ObservableMap<string, StateEvent>());
  const isMounted = useIsMounted();

  const events = useObservableMap(() => eventObservable, [eventObservable]);

  useEffect(() => {
    room.observeStateType(eventType).then((stateObserver) => {
      if (!isMounted()) return;
      setEventObservable(stateObserver);
    });
  }, [eventType, room, isMounted]);

  return events;
}
