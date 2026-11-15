import { useEffect, useMemo, useState } from "react";

import { createTypingNotifier, EphemeralDetail, typingUserIds } from "../utils/typing";
import { getSessionAuth } from "../utils/avatarMatrix";
import { useHydrogen } from "./useHydrogen";

/** Buzzar: who's typing in a room right now (from m.typing). */
export function useTypingUsers(roomId: string | undefined): Set<string> {
  const [typing, setTyping] = useState<Set<string>>(new Set());
  useEffect(() => {
    setTyping(new Set());
    if (!roomId) return;
    const onEphemeral = (e: Event) => {
      const ids = typingUserIds((e as CustomEvent<EphemeralDetail>).detail, roomId);
      if (ids) setTyping(new Set(ids));
    };
    window.addEventListener("buzzar:ephemeral", onEphemeral);
    return () => window.removeEventListener("buzzar:ephemeral", onEphemeral);
  }, [roomId]);
  return typing;
}

/** Buzzar: sends typing notifications for a composer in `roomId`. */
export function useTypingNotifier(roomId: string | undefined) {
  const { session, platform, client } = useHydrogen(true);
  const notifier = useMemo(
    () =>
      roomId
        ? createTypingNotifier(() => getSessionAuth(platform, client.sessionId), roomId, session.userId)
        : undefined,
    [roomId, session, platform, client]
  );
  // Stop "typing" when the composer goes away (chat closed, left the world).
  useEffect(() => () => notifier?.stopped(), [notifier]);
  return notifier;
}
