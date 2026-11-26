/**
 * Buzzar: blocking people. A block is Matrix's ignore list (`m.ignored_user_list` account data), so it follows your
 * account to every device and app: Element hides their messages too, and your homeserver stops sending you their
 * messages and invites. In worlds, Buzzar holds them back (engine/network/heldBack.ts): you don't see or hear each
 * other.
 */
import { useEffect, useReducer, useState } from "react";
import { ClientEvent, MatrixEvent } from "matrix-js-sdk";

import { getHeldBack, HeldBack, onHeldBackChanged } from "../../engine/network/heldBack";
import { useMatrix } from "./useMatrix";
import { confirmDialog } from "../views/components/confirm-dialog/ConfirmDialog";

/** The people you've blocked, kept up to date, and functions to block and unblock. */
export function useBlockedUsers() {
  const { session } = useMatrix(true);
  const client = session.client;
  const [blocked, setBlocked] = useState(() => client.getIgnoredUsers());
  useEffect(() => {
    setBlocked(client.getIgnoredUsers());
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === "m.ignored_user_list") setBlocked(client.getIgnoredUsers());
    };
    client.on(ClientEvent.AccountData, onAccountData);
    return () => {
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }, [client]);

  const block = async (userId: string, name?: string) => {
    const ok = await confirmDialog({
      title: `Block ${name || userId}?`,
      message:
        "In worlds you won't see or hear each other, and nothing of yours is sent to them. Their messages are hidden " +
        "everywhere you use Matrix, in Buzzar and other apps alike. You can unblock them in Settings → Moderation & Safety.",
      confirmLabel: "Block",
      danger: true,
    });
    if (!ok) return;
    const current = client.getIgnoredUsers();
    if (!current.includes(userId)) await client.setIgnoredUsers([...current, userId]);
  };

  const unblock = async (userId: string) => {
    await client.setIgnoredUsers(client.getIgnoredUsers().filter((id) => id !== userId));
  };

  return { blocked, block, unblock };
}

/** Who the world you're in holds back and why (blocked, or its ban lists), redrawn when that changes. */
export function useHeldBack(roomId: string): HeldBack | undefined {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onHeldBackChanged(redraw), []);
  return getHeldBack(roomId);
}
