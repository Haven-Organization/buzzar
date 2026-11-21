import { useCallback, useReducer, useRef } from "react";

import { Room } from "../../../../matrix";
import "./WorldChat.css";
import { WorldChatTimeline } from "./WorldChatTimeline";
import { WorldChatComposer } from "./WorldChatComposer";
import { Text } from "../../../atoms/text/Text";
import { Icon } from "../../../atoms/icon/Icon";
import MessageIC from "../../../../../res/ic/message.svg";
import { useRecentMessage } from "../../../hooks/useRecentMessage";
import { usePreviousState } from "../../../hooks/usePreviousState";
import { useTombstone } from "../../../hooks/useTombstone";
import { useMatrix } from "../../../hooks/useMatrix";
import { FormattedBody } from "../../components/formatted-body/FormattedBody";

function useRecentMessages(room?: Room, maxCount = 5) {
  const eventsRef = useRef<any[]>([]);
  const [, forceUpdate] = useReducer((state) => state + 1, 0);

  const eventEntry = useRecentMessage(room);
  const prevEventEntry = usePreviousState(eventEntry);

  if (prevEventEntry && eventEntry && eventEntry !== prevEventEntry) {
    if (eventsRef.current.length >= maxCount) {
      eventsRef.current.shift();
    }
    eventsRef.current.push(eventEntry);
    setTimeout(() => {
      eventsRef.current.shift();
      forceUpdate();
    }, 5000);
  }

  if (!room) {
    eventsRef.current = [];
  }

  return eventsRef.current;
}

interface IWorldChat {
  open: boolean;
  room: Room;
}

export function WorldChat({ room, open }: IWorldChat) {
  const events = useRecentMessages(open ? undefined : room, 5);
  // Buzzar: no chatting in a world that has been upgraded (WorldUpgradedDialog offers the new one).
  const upgraded = !!useTombstone(room);
  const { session } = useMatrix(true);
  const resolveMxc = useCallback((mxc: string) => session.mediaRepository.mxcUrl(mxc), [session]);

  const renderTimeline = () => <WorldChatTimeline room={room} />;

  const renderTimelinePreview = () =>
    events.length > 0 && (
      <div className="grow flex items-end" style={{ padding: "var(--sp-xs) 0" }}>
        <div className="flex flex-column items-start justify-end gap-xs">
          {events.map((eventEntry) => (
            <li key={eventEntry.id} className="WorldChat__TextMessageView">
              <div className="Text Text-b2 Text--world Text--regular">
                <span className="WorldChat__TextMessageView-sender Text Text-b2 Text--world Text--semi-bold">
                  {eventEntry.displayName}
                </span>
                {eventEntry.content?.msgtype === "m.image" || eventEntry.event?.type === "m.sticker" ? (
                  <img
                    className="WorldChat__ImageMessageView-img"
                    src={
                      (eventEntry.content.info?.mimetype === "image/gif"
                        ? session.mediaRepository.mxcUrl(eventEntry.content.url)
                        : session.mediaRepository.mxcUrlThumbnail(eventEntry.content.url, 240, 180, "scale")) ??
                      undefined
                    }
                    alt={eventEntry.content.body ?? "image"}
                  />
                ) : (
                  <FormattedBody content={eventEntry.content} resolveMxc={resolveMxc} />
                )}
              </div>
            </li>
          ))}
        </div>
      </div>
    );

  return (
    <div className="WorldChat flex flex-column justify-end" id="WorldChat">
      {open ? renderTimeline() : renderTimelinePreview()}
      <div className="WorldChat__input flex items-center">
        <Icon color="world" src={MessageIC} size="sm" />
        {upgraded ? (
          <Text variant="b2" color="world">
            This world has been upgraded. Chat continues in the new world.
          </Text>
        ) : open ? (
          <>
            <WorldChatComposer room={room} />
            <Text variant="b3" color="world" weight="bold" className="uppercase">
              Enter
            </Text>
          </>
        ) : (
          <Text variant="b2" color="world">
            Press <b>Enter</b> to chat
          </Text>
        )}
      </div>
    </div>
  );
}
