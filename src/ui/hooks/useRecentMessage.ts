import { useEffect, useState } from "react";

import { Room } from "../../matrix";

/**
 * The room's newest message, for list previews. Reads what sync already has and redraws when the room changes; it
 * doesn't open the room's timeline (that subscribed every listed room to its full history and state).
 */
export function useRecentMessage(room?: Room) {
  const [, setVersion] = useState(0);
  useEffect(() => room?.disposableOn("change", () => setVersion((v) => v + 1)), [room]);
  return room?.recentMessage;
}
