/**
 * Buzzar: the chat window's messages (React, since plan 02). Text with replies,
 * images and stickers, video/audio/files, 3D-model and world-link embeds, membership notes and date headers.
 */
import { memo, useCallback, useRef } from "react";
import classNames from "classnames";

import { Room, TimelineEntry } from "../../../../matrix";
import { ChatItem, useChat } from "../../../hooks/useChat";
import { useMatrix } from "../../../hooks/useMatrix";
import { EncryptedFile, useMediaUrl } from "../../../hooks/useMediaUrl";
import { getIdentifierColorNumber } from "../../../utils/avatar";
import { extractRoomLinks, isModelFile } from "../../../utils/chatEmbeds";
import { messagePreviewText } from "../../../utils/formattedBody";
import { Dots } from "../../../atoms/loading/Dots";
import { FormattedBody } from "../../components/formatted-body/FormattedBody";
import { TimelineScroller } from "../../components/timeline-scroller/TimelineScroller";
import { useChatEmbedPortals } from "./ChatEmbeds";
import { mediaCaption } from "./tiles/messageParts";
import "./ChatTimeline.css";
import "./tiles/ChatBaseMessage.css";
import "./tiles/ChatMessage.css";
import "./tiles/ChatImage.css";
import "./tiles/ChatMedia.css";
import "./tiles/ChatAnnouncement.css";
import "./tiles/ChatDate.css";
import "./tiles/ChatGap.css";

type MessageItem = Extract<ChatItem, { entry: TimelineEntry; continuation: boolean }>;

type MediaContent = {
  body?: string;
  filename?: string;
  url?: string;
  file?: EncryptedFile;
  msgtype?: string;
  info?: { size?: number; mimetype?: string; thumbnail_url?: string; w?: number; h?: number };
};

/** Image formats that may be animated: show the original file, since server thumbnails are still frames. */
const ANIMATED = new Set(["image/gif", "image/webp", "image/apng"]);
const REPLY_CLASS = "ChatMessage__reply Text Text-b3 Text--surface-low Text--regular";

function formatSize(bytes?: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function useResolveMxc() {
  const { session } = useMatrix(true);
  return useCallback((mxc: string) => session.mediaRepository.mxcUrl(mxc), [session]);
}

/** "↳ Name: quoted text" above a reply, like Element's reply quote. */
export function ReplyQuote({ item, className = REPLY_CLASS }: { item: MessageItem; className?: string }) {
  if (!item.isReply) return null;
  if (!item.reply) return <div className={className}>Replying to a message</div>;
  const preview = messagePreviewText(item.reply.content) || "a message";
  return (
    <div className={className}>
      <strong>{item.reply.displayName}</strong> {preview}
    </div>
  );
}

function MessageAvatar({ entry, small }: { entry: TimelineEntry; small: boolean }) {
  const { session } = useMatrix(true);
  const avatarUrl = entry.avatarUrl
    ? session.mediaRepository.mxcUrlThumbnail(entry.avatarUrl, 80, 80, "crop") ?? undefined
    : undefined;
  const name = entry.displayName;
  return (
    <div
      className={classNames(
        `ChatBaseMessage__avatar ChatBaseMessage__avatar-${getIdentifierColorNumber(entry.sender)} shrink-0`,
        { "ChatBaseMessage__avatar--sm": small }
      )}
      aria-label={name}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" />
      ) : (
        <span className="Text Text-b2 Text--medium">{(name.replace(/^@/, "").charAt(0) || "?").toUpperCase()}</span>
      )}
    </div>
  );
}

function TextBody({ item }: { item: MessageItem }) {
  const resolveMxc = useResolveMxc();
  const { entry } = item;
  const content = entry.content;
  const isEmote = content.msgtype === "m.emote";
  return (
    <div className="ChatMessage__body flex flex-column">
      <ReplyQuote item={item} />
      <div className="Text Text-b2 Text--surface Text--regular">
        {isEmote ? `* ${entry.displayName} ` : ""}
        <FormattedBody className="ChatMessage__text" content={content} resolveMxc={resolveMxc} />
      </div>
      {/* Rooms it links to; useChatEmbedPortals turns the ones that are worlds into tiles (ChatWorldEmbed). */}
      <div className="ChatMessage__embeds">
        {extractRoomLinks(content).map((link) => (
          <div
            key={link.target}
            className="ChatEmbed"
            data-world-link={link.target}
            data-world-via={link.via.join(",")}
          />
        ))}
      </div>
    </div>
  );
}

/** Width and height to draw an image at, within the chat's limits. */
export function imageSize(info: { w?: number; h?: number } | undefined, maxWidth = 340, maxHeight = 400) {
  const w = info?.w && info.w > 0 ? info.w : maxWidth;
  const h = info?.h && info.h > 0 ? info.h : Math.round(maxWidth * 0.75);
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** The picture for an image or sticker message: a thumbnail, or the original for (possibly) animated images. */
export function useImageSource(content: MediaContent, size: { width: number; height: number }) {
  const animated = !!content.info?.mimetype && ANIMATED.has(content.info.mimetype);
  return useMediaUrl(content, animated ? undefined : { width: size.width * 2, height: size.height * 2 });
}

function ImageBody({ item }: { item: MessageItem }) {
  const resolveMxc = useResolveMxc();
  const content = item.entry.content as MediaContent;
  const size = imageSize(content.info);
  const src = useImageSource(content, size);
  const full = content.url && !content.file ? resolveMxc(content.url) : undefined;
  const caption = mediaCaption(content);
  const img = (
    <img
      src={src}
      alt={content.body ?? "image"}
      title={content.body ?? ""}
      loading="lazy"
      style={{ maxWidth: 340, width: size.width, height: size.height, objectFit: "contain" }}
    />
  );
  return (
    <div className="ChatImage__body flex flex-column">
      <ReplyQuote item={item} />
      {full ? (
        <a href={full} target="_blank" rel="noopener noreferrer">
          {img}
        </a>
      ) : (
        img
      )}
      {caption && (
        <FormattedBody className="ChatMessage__text ChatImage__caption" content={caption} resolveMxc={resolveMxc} />
      )}
    </div>
  );
}

/** Videos play inline; audio and other files show as a download link. */
function MediaBody({ item }: { item: MessageItem }) {
  const resolveMxc = useResolveMxc();
  const content = item.entry.content as MediaContent;
  const url = useMediaUrl(content);
  const name = content.filename ?? content.body ?? "file";
  const label = `📎 ${name}${content.info?.size ? ` (${formatSize(content.info.size)})` : ""}`;
  let body;
  if (!url) {
    body = <p className="Text Text-b2 Text--surface-low">{content.file ? "Decrypting attachment…" : name}</p>;
  } else if (content.msgtype === "m.video") {
    const poster = content.info?.thumbnail_url ? resolveMxc(content.info.thumbnail_url) : undefined;
    body = <video className="ChatMedia__video" src={url} controls preload="metadata" poster={poster} />;
  } else if (content.url && !content.file && isModelFile(name, content.info?.mimetype)) {
    // A 3D model (avatar, world or Thing): useChatEmbedPortals renders its tile here (ChatModelEmbed).
    body = (
      <div
        className="ChatEmbed"
        data-model-mxc={content.url}
        data-model-name={name}
        data-model-size={String(content.info?.size ?? "")}
      />
    );
  } else if (content.msgtype === "m.audio") {
    body = <audio className="ChatMedia__audio" src={url} controls preload="none" />;
  } else {
    body = (
      <a
        className="ChatMedia__file Text Text-b2 Text--surface"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={name}
      >
        {label}
      </a>
    );
  }
  return (
    <div className="ChatMedia__body flex flex-column">
      <ReplyQuote item={item} />
      {body}
    </div>
  );
}

/** Whether two builds of the list describe the same message the same way (so it needn't be drawn again). */
export function sameMessage(a: { item: MessageItem }, b: { item: MessageItem }) {
  return (
    a.item.entry === b.item.entry &&
    a.item.kind === b.item.kind &&
    a.item.content === b.item.content &&
    a.item.profile === b.item.profile &&
    a.item.continuation === b.item.continuation &&
    a.item.reply === b.item.reply &&
    a.item.isReply === b.item.isReply
  );
}

const Message = memo(function Message({ item }: { item: MessageItem }) {
  const { entry } = item;
  const isEmote = entry.content.msgtype === "m.emote";
  const contentOnly = item.continuation && !isEmote;
  return (
    <li
      className={classNames(
        "ChatBaseMessage",
        { "ChatBaseMessage--contentOnly": contentOnly, "ChatBaseMessage--emote": isEmote },
        "flex"
      )}
    >
      {!contentOnly && <MessageAvatar entry={entry} small={isEmote} />}
      <div className="ChatBaseMessage__content grow">
        {!contentOnly && !isEmote && (
          <p className="ChatBaseMessage__sender Text Text-b2 Text--surface Text--bold truncate">{entry.displayName}</p>
        )}
        <div className="ChatBaseMessage__body">
          {item.kind === "image" ? (
            <ImageBody item={item} />
          ) : item.kind === "media" ? (
            <MediaBody item={item} />
          ) : item.kind === "undecrypted" ? (
            <p className="Text Text-b2 Text--surface-low Text--regular">
              🔒 Encrypted message (this device doesn&apos;t have its key yet)
            </p>
          ) : (
            <TextBody item={item} />
          )}
        </div>
      </div>
    </li>
  );
}, sameMessage);

function relativeDate(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86400000
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: days < 7 ? "long" : undefined,
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function renderItem(item: ChatItem) {
  if (item.kind === "date") {
    return (
      <p key={item.key} className="ChatDate Text Text-b2 Text--surface Text--semi-bold">
        <time dateTime={new Date(item.timestamp).toISOString()}>{relativeDate(item.timestamp)}</time>
      </p>
    );
  }
  if (item.kind === "announcement") {
    return (
      <li key={item.key} className="ChatAnnouncement flex">
        <div className="ChatAnnouncement__content">
          <p className="Text Text-b2 Text--surface-low Text--regular">{item.text}</p>
        </div>
      </li>
    );
  }
  return <Message key={item.key} item={item} />;
}

export function ChatTimeline({ room }: { room: Room }) {
  const { loading, error, items, loadMore, loadingMore } = useChat(room, { dates: true, media: true });
  const chatTimelineRef = useRef<HTMLDivElement>(null);
  // Tiles for 3D models and world links in messages.
  const embeds = useChatEmbedPortals(chatTimelineRef);

  if (error) return <div className="grow flex justify-center items-center">{error.message}</div>;
  if (loading) {
    return (
      <div className="grow flex justify-center items-center" style={{ height: "100%" }}>
        <Dots color="surface-low" />
      </div>
    );
  }

  return (
    <>
      <div className="ChatTimeline flex" ref={chatTimelineRef}>
        <TimelineScroller version={items} onReachTop={loadMore}>
          {loadingMore && (
            <li className="ChatGap flex justify-center">
              <p className="ChatGap__content Text Text-b2 Text--surface Text--semi-bold">Loading more messages...</p>
            </li>
          )}
          {items.map(renderItem)}
        </TimelineScroller>
      </div>
      {embeds}
    </>
  );
}
