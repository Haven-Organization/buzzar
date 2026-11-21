/**
 * Buzzar: the in-world chat's messages (React, since plan 02): text, images, GIFs and
 * stickers, and membership notes, in translucent bubbles over the world.
 */
import { useCallback } from "react";
import classNames from "classnames";

import { Room } from "../../../../matrix";
import { ChatItem, useChat } from "../../../hooks/useChat";
import { useMatrix } from "../../../hooks/useMatrix";
import { Text } from "../../../atoms/text/Text";
import { FormattedBody } from "../../components/formatted-body/FormattedBody";
import { TimelineScroller } from "../../components/timeline-scroller/TimelineScroller";
import { imageSize, useImageSource } from "../chat/ChatTimeline";
import { mediaCaption } from "../chat/tiles/messageParts";
import "./WorldChatTimeline.css";
import "./tiles/TextMessageView.css";
import "./tiles/AnnouncementView.css";
import "./tiles/WorldChatGap.css";

type MessageItem = Extract<ChatItem, { continuation: boolean }>;

function ImageMessage({ item }: { item: MessageItem }) {
  const { session } = useMatrix(true);
  const resolveMxc = useCallback((mxc: string) => session.mediaRepository.mxcUrl(mxc), [session]);
  const content = item.entry.content;
  const src = useImageSource(content, imageSize(content.info, 240, 180));
  const caption = mediaCaption(content);
  return (
    <li className="WorldChat__TextMessageView">
      <div className="Text Text-b2 Text--world Text--regular">
        <span className="WorldChat__TextMessageView-sender Text Text-b2 Text--world Text--semi-bold">
          {`${item.entry.displayName}:`}
        </span>
      </div>
      <img className="WorldChat__ImageMessageView-img" src={src} alt={content.body ?? "image"} loading="lazy" />
      {caption && (
        <FormattedBody className="Text Text-b2 Text--world Text--regular" content={caption} resolveMxc={resolveMxc} />
      )}
    </li>
  );
}

function TextMessage({ item }: { item: MessageItem }) {
  const { session } = useMatrix(true);
  const resolveMxc = useCallback((mxc: string) => session.mediaRepository.mxcUrl(mxc), [session]);
  const { entry } = item;
  const isEmote = entry.content.msgtype === "m.emote";
  return (
    <li className={classNames("WorldChat__TextMessageView", { "WorldChat__TextMessageView--emote": isEmote })}>
      <div className="Text Text-b2 Text--world Text--regular">
        {!isEmote && (
          <span className="WorldChat__TextMessageView-sender Text Text-b2 Text--world Text--semi-bold">
            {`${entry.displayName}:`}
          </span>
        )}
        {isEmote ? `* ${entry.displayName} ` : ""}
        {item.kind === "undecrypted" ? (
          "🔒 Encrypted message"
        ) : (
          <FormattedBody className="WorldChat__TextMessageView-body" content={entry.content} resolveMxc={resolveMxc} />
        )}
      </div>
    </li>
  );
}

export function WorldChatTimeline({ room }: { room: Room }) {
  const { loading, error, items, loadMore, loadingMore } = useChat(room, { dates: false, media: false });

  if (error || loading) {
    return (
      <div className="grow flex justify-center items-center">
        <Text>{error ? error.message : "loading..."}</Text>
      </div>
    );
  }

  return (
    <div className="WorldChatTimeline grow flex">
      <TimelineScroller version={items} onReachTop={loadMore}>
        {loadingMore && (
          <li className="WorldChatGap flex item-center">
            <p className="Text Text-b2 Text--world Text--semi-bold">Loading more messages...</p>
          </li>
        )}
        {items.map((item) =>
          item.kind === "date" ? null : item.kind === "announcement" ? (
            <li key={item.key} className="WorldChat__AnnouncementView">
              <div className="Text Text-b2 Text--world Text--regular">{item.text}</div>
            </li>
          ) : item.kind === "image" ? (
            <ImageMessage key={item.key} item={item} />
          ) : (
            <TextMessage key={item.key} item={item} />
          )
        )}
      </TimelineScroller>
    </div>
  );
}
