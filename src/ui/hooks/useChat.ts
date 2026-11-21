/**
 * Buzzar: a room's messages as a list ready to draw (plan 02 replaced Hydrogen's timeline views with React):
 * messages, images, files, membership notes and date headers, with paging back through history.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Room, Timeline, TimelineEntry } from "../../matrix";

export type ChatItem =
  | { kind: "date"; key: string; timestamp: number }
  | { kind: "announcement"; key: string; entry: TimelineEntry; text: string }
  | {
      kind: "message" | "image" | "media" | "undecrypted";
      key: string;
      entry: TimelineEntry;
      /** Same sender as the message right above, shortly after it: drawn without avatar and name. */
      continuation: boolean;
      /** The message this one replies to, when it's loaded. */
      reply?: TimelineEntry;
      isReply: boolean;
    };

const CONTINUATION_MS = 5 * 60 * 1000;

function memberAnnouncement(entry: TimelineEntry): string | undefined {
  const { content } = entry;
  const prev = (entry.sdk.getPrevContent() ?? {}) as Record<string, unknown>;
  const target = entry.sdk.getStateKey() ?? "";
  const targetName = (content.displayname as string) || (prev.displayname as string) || target;
  const sender = entry.sender;
  const senderName = entry.displayName;
  const membership = content.membership;
  const before = prev.membership;
  if (membership === "join") {
    if (before !== "join") return `${targetName} joined the room`;
    if (content.displayname !== prev.displayname) {
      return content.displayname
        ? `${(prev.displayname as string) || target} changed their name to ${content.displayname}`
        : `${(prev.displayname as string) || target} removed their name`;
    }
    if (content.avatar_url !== prev.avatar_url) return `${targetName} changed their avatar`;
    return undefined; // some other change to the member event (e.g. their world avatar)
  }
  if (membership === "invite") return `${senderName} invited ${targetName}`;
  if (membership === "leave") {
    if (sender === target)
      return before === "invite" ? `${targetName} declined the invite` : `${targetName} left the room`;
    if (before === "ban") return `${senderName} unbanned ${targetName}`;
    if (before === "invite") return `${senderName} withdrew ${targetName}'s invite`;
    return `${senderName} removed ${targetName}${content.reason ? `: ${content.reason}` : ""}`;
  }
  if (membership === "ban") return `${senderName} banned ${targetName}${content.reason ? `: ${content.reason}` : ""}`;
  return undefined;
}

function sameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export interface ChatOptions {
  /** Date headers between days (the chat window has them; the in-world chat doesn't). */
  dates?: boolean;
  /** Video, audio and file messages (the in-world chat leaves them out). */
  media?: boolean;
}

export function buildChatItems(timeline: Timeline, options: ChatOptions): ChatItem[] {
  const items: ChatItem[] = [];
  let last: { sender: string; timestamp: number } | undefined;
  let lastTimestamp: number | undefined;

  for (const event of timeline.events) {
    const entry = TimelineEntry.of(event);
    const type = entry.eventType;
    let item: ChatItem | undefined;

    if (type === "m.room.member") {
      const text = memberAnnouncement(entry);
      if (text) item = { kind: "announcement", key: entry.id, entry, text };
    } else if (type === "m.room.tombstone") {
      if (entry.content.replacement_room) {
        item = { kind: "announcement", key: entry.id, entry, text: `${entry.displayName} upgraded this room.` };
      }
    } else if (entry.isRedacted || entry.isEdit) {
      item = undefined;
    } else if (type === "m.room.message" || type === "m.sticker" || type === "m.room.encrypted") {
      const msgtype = entry.content.msgtype;
      let kind: "message" | "image" | "media" | "undecrypted" | undefined;
      if (type === "m.room.encrypted") kind = entry.isUndecrypted ? "undecrypted" : undefined;
      else if (type === "m.sticker" || msgtype === "m.image") kind = "image";
      else if (msgtype === "m.text" || msgtype === "m.notice" || msgtype === "m.emote") kind = "message";
      else if (msgtype === "m.video" || msgtype === "m.file" || msgtype === "m.audio") {
        kind = options.media ? "media" : undefined;
      }
      if (kind) {
        const replyId = entry.replyToId;
        const continuation =
          !!last &&
          last.sender === entry.sender &&
          entry.timestamp - last.timestamp < CONTINUATION_MS &&
          msgtype !== "m.emote";
        item = {
          kind,
          key: entry.id,
          entry,
          continuation,
          isReply: !!replyId,
          reply: replyId ? timeline.findEntry(replyId) : undefined,
        };
      }
    }
    if (!item) continue;

    if (options.dates && (lastTimestamp === undefined || !sameDay(lastTimestamp, entry.timestamp))) {
      items.push({ kind: "date", key: `date-${entry.timestamp}`, timestamp: entry.timestamp });
      if (item.kind !== "announcement" && item.kind !== "date") item.continuation = false;
    }
    lastTimestamp = entry.timestamp;
    items.push(item);
    last =
      item.kind === "announcement" || entry.content.msgtype === "m.emote"
        ? undefined
        : { sender: entry.sender, timestamp: entry.timestamp };
  }
  return items;
}

export function useChat(room: Room, options: ChatOptions) {
  const [timeline, setTimeline] = useState<Timeline>();
  const [version, setVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error>();
  const { dates, media } = options;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    setTimeline(undefined);
    setError(undefined);
    room
      .openTimeline()
      .then((opened) => {
        if (cancelled) return;
        unsubscribe = opened.entries.subscribe({ onReset: () => setVersion((v) => v + 1) });
        setTimeline(opened);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [room]);

  const items = useMemo(
    () => (timeline ? buildChatItems(timeline, { dates, media }) : []),
    // `version` changes whenever the timeline's events do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, version, dates, media]
  );

  const loadMore = useCallback(async () => {
    if (!timeline || loadingMore || !timeline.canLoadMore) return;
    setLoadingMore(true);
    try {
      await timeline.loadMore();
    } catch (e) {
      console.warn("Couldn't load older messages", e);
    } finally {
      setLoadingMore(false);
    }
  }, [timeline, loadingMore]);

  // A short room history may not fill the view (or hold any message at all): page back a little at first.
  useEffect(() => {
    if (timeline && items.length < 15 && timeline.canLoadMore && !loadingMore) loadMore();
  }, [timeline, items.length, loadingMore, loadMore]);

  return { loading: !timeline && !error, error, items, loadMore, loadingMore, canLoadMore: !!timeline?.canLoadMore };
}

/** Sends a chat message; `/me …` sends an emote. Resolves false if it couldn't be sent. */
export async function sendChatMessage(room: Room, message: string): Promise<boolean> {
  if (!message) return false;
  try {
    let msgtype = "m.text";
    if (message.startsWith("/me ")) {
      message = message.slice(4).trim();
      msgtype = "m.emote";
    }
    await room.sendEvent("m.room.message", { msgtype, body: message });
    return true;
  } catch (e) {
    console.error("Couldn't send the message", e);
    return false;
  }
}
