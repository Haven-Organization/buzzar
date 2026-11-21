import { useEffect } from "react";

import { Room, Session } from "../../matrix";
import { coversLatest, OwnReceipt, ownReadReceipts, ReceiptEphemeralDetail } from "../utils/readSync";

// Hydrogen internals used here: the room's latest event id, and writing the cleared summary without Room.clearUnread(),
// which would also send a public m.read receipt (the other client may have used a private one on purpose).
interface RoomInternals {
  _getLastEventId(): Promise<string | undefined>;
  _storage: {
    readWriteTxn(stores: string[]): Promise<{ complete(): Promise<void>; abort(): void }>;
    storeNames: { roomSummary: string };
  };
  _summary: { writeClearUnread(txn: unknown): unknown; applyChanges(data: unknown): void };
  _emitUpdate(): void;
}

async function clearUnreadLocally(room: Room) {
  const internals = room as unknown as RoomInternals;
  const txn = await internals._storage.readWriteTxn([internals._storage.storeNames.roomSummary]);
  let data;
  try {
    data = internals._summary.writeClearUnread(txn);
  } catch (err) {
    txn.abort();
    throw err;
  }
  await txn.complete();
  internals._summary.applyChanges(data);
  internals._emitUpdate();
}

async function applyReceipt(room: Room, receipt: OwnReceipt) {
  if (!room.isUnread && !room.notificationCount) return;
  const lastEventId = await (room as unknown as RoomInternals)._getLastEventId();
  if (coversLatest(receipt, lastEventId, room.lastMessageTimestamp)) await clearUnreadLocally(room);
}

/**
 * Buzzar: clears a room's unread dot when you've read it in another client. Live, from your own read receipts in
 * sync; and once at start-up from each unread room's m.fully_read marker, for reads that happened while Buzzar was
 * closed.
 */
export function useReadSync(session: Session) {
  useEffect(() => {
    let disposed = false;
    const userId = session.userId;

    const onEphemeral = (e: Event) => {
      const detail = (e as CustomEvent<ReceiptEphemeralDetail>).detail;
      const receipts = ownReadReceipts(detail, userId);
      if (receipts.length === 0) return;
      const room = session.rooms.get(detail.roomId);
      if (!room) return;
      // Let Hydrogen finish writing this sync's timeline first, so the latest message is known.
      setTimeout(async () => {
        for (const receipt of receipts) {
          if (disposed) return;
          try {
            await applyReceipt(room, receipt);
          } catch (err) {
            console.warn("read sync: couldn't apply receipt", err);
          }
        }
      }, 500);
    };
    window.addEventListener("buzzar:ephemeral", onEphemeral);

    const hsApi = session.hsApi as unknown as {
      roomAccountData(userId: string, roomId: string, type: string): { response(): Promise<{ event_id?: unknown }> };
    };
    const startup = setTimeout(async () => {
      for (const room of session.rooms.values()) {
        if (disposed) return;
        if (!room.isUnread) continue;
        try {
          const marker = await hsApi.roomAccountData(userId, room.id, "m.fully_read").response();
          if (typeof marker?.event_id === "string") await applyReceipt(room, { eventId: marker.event_id });
        } catch {
          // No marker for this room (404), or offline: leave the dot.
        }
      }
    }, 5000);

    return () => {
      disposed = true;
      clearTimeout(startup);
      window.removeEventListener("buzzar:ephemeral", onEphemeral);
    };
  }, [session]);
}
