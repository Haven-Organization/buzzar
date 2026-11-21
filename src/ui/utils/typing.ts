/**
 * Buzzar: Matrix typing notifications (m.typing). Sent while you type in a world's chat, so other players see
 * "…" above your head; received through the buzzar:ephemeral window event the Matrix layer sends (src/matrix/session.ts).
 */
import { MatrixAuth } from "./avatarMatrix";

export const TYPING_TIMEOUT_MS = 6000;
/** Re-send "still typing" at most this often while keys are pressed. */
const RESEND_MS = 4000;

export async function sendTyping(auth: MatrixAuth, roomId: string, userId: string, typing: boolean) {
  await fetch(
    `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(
      roomId
    )}/typing/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(typing ? { typing: true, timeout: TYPING_TIMEOUT_MS } : { typing: false }),
    }
  );
}

/** Tracks one composer: call `typed()` on input and `stopped()` on send/blur/clear. */
export function createTypingNotifier(getAuth: () => Promise<MatrixAuth | undefined>, roomId: string, userId: string) {
  let lastSent = 0;
  let typing = false;
  const send = async (value: boolean) => {
    try {
      const auth = await getAuth();
      if (auth) await sendTyping(auth, roomId, userId, value);
    } catch {
      // best effort
    }
  };
  return {
    typed(hasText: boolean) {
      if (!hasText) return this.stopped();
      const now = Date.now();
      if (!typing || now - lastSent > RESEND_MS) {
        typing = true;
        lastSent = now;
        send(true);
      }
    },
    stopped() {
      if (!typing) return;
      typing = false;
      lastSent = 0;
      send(false);
    },
  };
}

export interface EphemeralDetail {
  roomId: string;
  events: { type: string; content?: { user_ids?: unknown } }[];
}

/** The user IDs in an m.typing event, validated. */
export function typingUserIds(detail: EphemeralDetail, roomId: string): string[] | undefined {
  if (detail.roomId !== roomId) return undefined;
  const typing = [...detail.events].reverse().find((e) => e.type === "m.typing");
  const ids = typing?.content?.user_ids;
  if (!Array.isArray(ids)) return undefined;
  return ids.filter((id): id is string => typeof id === "string" && id.startsWith("@"));
}
