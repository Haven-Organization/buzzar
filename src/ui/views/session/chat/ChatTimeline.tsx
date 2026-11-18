import { useRef } from "react";
import { TimelineViewModel } from "@thirdroom/hydrogen-view-sdk";

import "./ChatTimeline.css";
import { useEmbedTimeline } from "../../../hooks/useEmbedTimeline";
import { viewClassForTile } from "./tiles";
import { useChatEmbedPortals } from "./ChatEmbeds";

interface ChatTimelineProps {
  timelineViewModel: TimelineViewModel;
}

export function ChatTimeline({ timelineViewModel }: ChatTimelineProps) {
  const chatTimelineRef = useRef<HTMLDivElement>(null);
  useEmbedTimeline(chatTimelineRef, timelineViewModel, viewClassForTile);
  // Buzzar: tiles for 3D models and world links in messages.
  const embeds = useChatEmbedPortals(chatTimelineRef);

  return (
    <>
      <div className="ChatTimeline flex" ref={chatTimelineRef} />
      {embeds}
    </>
  );
}
