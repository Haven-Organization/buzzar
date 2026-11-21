import { useEffect } from "react";

import { Room } from "../../../../matrix";
import { ChatTimeline } from "./ChatTimeline";
import { ChatComposer } from "./ChatComposer";
import { useTombstone } from "../../../hooks/useTombstone";
import { RoomUpgradedBanner } from "./RoomUpgradedBanner";

interface ChatViewContentProps {
  room: Room;
}

export function ChatViewContent({ room }: ChatViewContentProps) {
  useEffect(() => {
    const timer = setTimeout(() => room.clearUnread(), 1000);
    return () => clearTimeout(timer);
  }, [room]);
  // Buzzar: an upgraded room is read-only; point to the room that replaced it instead of the composer.
  const tombstone = useTombstone(room);

  return (
    <>
      <div className="grow">
        <ChatTimeline room={room} />
      </div>
      <div className="shrink-0">{tombstone ? <RoomUpgradedBanner room={room} /> : <ChatComposer room={room} />}</div>
    </>
  );
}
