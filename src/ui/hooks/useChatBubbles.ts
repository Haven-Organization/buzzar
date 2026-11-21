import { useEffect, useRef, useState } from "react";

import { Room } from "../../matrix";
import { useRoomTimeline } from "./useRoomTimeline";

/** How long a message stays above someone's head. */
export const BUBBLE_MS = 10_000;
const MAX_BUBBLES_PER_USER = 3;

export interface ChatBubble {
  id: string;
  content: Record<string, unknown>;
  type: string;
  at: number;
}

/**
 * Buzzar: recent messages per sender in a world, for speech bubbles above heads (like VRChat). Only messages
 * that arrive while you're in the world are shown, each for BUBBLE_MS.
 */
export function useChatBubbles(room: Room): Map<string, ChatBubble[]> {
  const timeline = useRoomTimeline(room);
  const seen = useRef<Set<string> | undefined>(undefined);
  const [bubbles, setBubbles] = useState<Map<string, ChatBubble[]>>(new Map());

  useEffect(() => {
    const entries = timeline.filter((entry) => {
      const type = entry?.event?.type;
      return (type === "m.room.message" || type === "m.sticker") && entry.id && !entry.isRedacted;
    });
    if (!seen.current) {
      // First load: everything already in the timeline is history, not something just said.
      seen.current = new Set(entries.map((e) => e.id));
      return;
    }
    const fresh = entries.filter((e) => !seen.current!.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seen.current.add(e.id);
    const now = Date.now();
    setBubbles((current) => {
      const next = new Map(current);
      for (const e of fresh) {
        const content = e.content as Record<string, unknown>;
        // Edits replace the text of the bubble they edit rather than adding a new one.
        if ((content?.["m.relates_to"] as Record<string, unknown> | undefined)?.rel_type === "m.replace") continue;
        const list = [...(next.get(e.sender) ?? []), { id: e.id, content, type: e.event.type, at: now }];
        next.set(e.sender, list.slice(-MAX_BUBBLES_PER_USER));
      }
      return next;
    });
  }, [timeline]);

  // Expire old bubbles.
  useEffect(() => {
    if (!bubbles.size) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setBubbles((current) => {
        let changed = false;
        const next = new Map<string, ChatBubble[]>();
        for (const [user, list] of current) {
          const kept = list.filter((b) => now - b.at < BUBBLE_MS);
          if (kept.length !== list.length) changed = true;
          if (kept.length) next.set(user, kept);
        }
        return changed ? next : current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bubbles.size]);

  return bubbles;
}
