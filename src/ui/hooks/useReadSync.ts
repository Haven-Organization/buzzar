import { Session } from "../../matrix";

/**
 * Buzzar: clearing a room's unread dot when you've read it in another client used to need work here. The Matrix
 * layer now reads your own receipts itself (Room.isUnread), so there is nothing left to do.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useReadSync(_session: Session) {}
