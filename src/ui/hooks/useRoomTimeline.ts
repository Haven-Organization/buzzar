import { useEffect, useState } from "react";

import { Room, Timeline, TimelineEntry } from "../../matrix";

export type TimelineType = TimelineEntry[];

/** A room's loaded history, oldest first, re-read whenever it changes. */
export function useRoomTimeline(room?: Room): TimelineType {
  const [timeline, setTimeline] = useState<TimelineType>([]);

  useEffect(() => {
    if (!room) return;
    let unSub: (() => void) | undefined;
    let cancelled = false;
    const handleLoad = (timeline: Timeline) => {
      if (cancelled) return;
      const read = () => setTimeline(timeline.events.map((event) => TimelineEntry.of(event)));
      unSub = timeline.entries.subscribe({ onReset: read });
      read();
    };
    room.openTimeline().then(handleLoad);
    return () => {
      cancelled = true;
      unSub?.();
    };
  }, [room]);

  return timeline;
}
