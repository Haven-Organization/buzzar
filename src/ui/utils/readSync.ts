/**
 * Buzzar: keep a room's unread dot in step with reading it in another client (Haven, Element…).
 *
 * Hydrogen marks a room unread whenever someone else's message arrives and only clears that when the room is opened
 * in Hydrogen itself; it ignores your own read receipts. These helpers find your receipts in a sync's ephemeral
 * events (forwarded by the patched Hydrogen as `buzzar:ephemeral`) and decide whether they cover the room's latest
 * message.
 */

export interface ReceiptEphemeralDetail {
  roomId: string;
  events: { type: string; content?: unknown }[];
}

export interface OwnReceipt {
  eventId: string;
  ts?: number;
}

const READ_RECEIPT_TYPES = ["m.read", "m.read.private"];

/** The events `userId` marked as read (public or private receipts) in one sync's ephemeral events for a room. */
export function ownReadReceipts(detail: ReceiptEphemeralDetail, userId: string): OwnReceipt[] {
  const receipts: OwnReceipt[] = [];
  for (const event of detail.events ?? []) {
    if (event?.type !== "m.receipt" || !event.content || typeof event.content !== "object") continue;
    for (const [eventId, byType] of Object.entries(event.content as Record<string, unknown>)) {
      if (!byType || typeof byType !== "object") continue;
      for (const type of READ_RECEIPT_TYPES) {
        const users = (byType as Record<string, unknown>)[type];
        if (!users || typeof users !== "object") continue;
        const mine = (users as Record<string, unknown>)[userId];
        if (!mine || typeof mine !== "object") continue;
        const ts = (mine as { ts?: unknown }).ts;
        receipts.push({ eventId, ts: typeof ts === "number" ? ts : undefined });
      }
    }
  }
  return receipts;
}

/**
 * Whether a read marker covers the room's latest message: it points at the latest event, or it was set after the
 * latest message was sent.
 */
export function coversLatest(
  receipt: OwnReceipt,
  lastEventId: string | undefined,
  lastMessageTimestamp: number | undefined
): boolean {
  if (lastEventId && receipt.eventId === lastEventId) return true;
  return receipt.ts !== undefined && !!lastMessageTimestamp && receipt.ts >= lastMessageTimestamp;
}
