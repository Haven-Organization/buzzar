import { useEffect, useState } from "react";
import { MatrixEvent, Method } from "matrix-js-sdk";

import { Session } from "../../matrix";

/**
 * Buzzar: your Matrix notifications (mentions, DMs and whatever else your push rules notify for), from the
 * homeserver's `/notifications` list, the same one Element's notification panel shows.
 */
export interface MatrixNotification {
  id: string;
  roomId: string;
  roomName: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  ts: number;
  body: string;
  read: boolean;
  highlight: boolean;
}

interface RawNotification {
  room_id: string;
  read: boolean;
  ts: number;
  actions: unknown[];
  event: Record<string, unknown> & { event_id: string; sender: string; origin_server_ts: number };
}

interface State {
  items: MatrixNotification[];
  nextToken?: string;
  loading: boolean;
  error?: string;
}

const PAGE = 30;
const REFRESH_MIN_MS = 15_000;

function describe(event: MatrixEvent): string {
  if (event.isDecryptionFailure()) return "Encrypted message (can't decrypt on this device)";
  const content = event.getContent();
  const type = event.getType();
  if (type === "m.room.encrypted") return "Encrypted message";
  if (type === "m.sticker") return "sent a sticker";
  if (type === "m.room.member") return content.membership === "invite" ? "invited you" : `${content.membership}`;
  if (type !== "m.room.message") return type;
  switch (content.msgtype) {
    case "m.image":
      return "sent an image";
    case "m.video":
      return "sent a video";
    case "m.audio":
      return "sent an audio message";
    case "m.file":
      return "sent a file";
    default:
      return typeof content.body === "string" ? content.body : "";
  }
}

class NotificationStore {
  private state: State = { items: [], loading: false };
  private listeners = new Set<() => void>();
  private lastRefresh = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private stopWatching?: () => void;

  constructor(private session: Session) {}

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.startWatching();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopWatching?.();
    };
  };

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Refetches the first page when rooms' unread counts change (a new notification), at most every 15 s. */
  private startWatching() {
    let signature = this.unreadSignature();
    const onChange = () => {
      const next = this.unreadSignature();
      if (next === signature) return;
      signature = next;
      this.refreshSoon();
    };
    const handle = this.session.rooms.subscribe({
      onAdd: onChange,
      onUpdate: onChange,
      onRemove: onChange,
      onReset: onChange,
    });
    this.stopWatching = () => {
      handle();
      clearTimeout(this.refreshTimer);
      this.stopWatching = undefined;
    };
    if (this.state.items.length === 0) this.refresh();
  }

  private unreadSignature() {
    let total = 0;
    for (const room of this.session.rooms.values()) total += room.notificationCount * 31 + room.highlightCount;
    return total;
  }

  private refreshSoon() {
    clearTimeout(this.refreshTimer);
    const wait = Math.max(0, this.lastRefresh + REFRESH_MIN_MS - Date.now());
    this.refreshTimer = setTimeout(() => this.refresh(), wait);
  }

  refresh = async () => {
    this.lastRefresh = Date.now();
    await this.load(undefined);
  };

  loadMore = async () => {
    if (this.state.loading || !this.state.nextToken) return;
    await this.load(this.state.nextToken);
  };

  private async load(from: string | undefined) {
    this.set({ loading: true, error: undefined });
    try {
      const client = this.session.client;
      const query: Record<string, string> = { limit: String(PAGE) };
      if (from) query.from = from;
      const res = await client.http.authedRequest<{ notifications: RawNotification[]; next_token?: string }>(
        Method.Get,
        "/notifications",
        query
      );
      const items = await Promise.all(res.notifications.map((n) => this.toItem(n)));
      this.set({
        items: from ? [...this.state.items, ...items] : items,
        nextToken: res.next_token,
        loading: false,
      });
    } catch (e) {
      this.set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async toItem(n: RawNotification): Promise<MatrixNotification> {
    const client = this.session.client;
    const event = new MatrixEvent({ ...n.event, room_id: n.room_id });
    if (event.isEncrypted()) {
      try {
        await client.decryptEventIfNeeded(event);
      } catch {
        // shown as "can't decrypt"
      }
    }
    const room = client.getRoom(n.room_id);
    const member = room?.getMember(event.getSender() ?? "");
    const highlight = n.actions.some(
      (a) => typeof a === "object" && a !== null && (a as { set_tweak?: string }).set_tweak === "highlight"
    );
    return {
      id: n.event.event_id,
      roomId: n.room_id,
      roomName: room?.name ?? n.room_id,
      senderId: event.getSender() ?? "",
      senderName: member?.name ?? event.getSender() ?? "",
      senderAvatarUrl: member?.getMxcAvatarUrl() ?? undefined,
      ts: n.ts || event.getTs(),
      body: describe(event),
      read: n.read,
      highlight,
    };
  }
}

const stores = new WeakMap<Session, NotificationStore>();

function storeFor(session: Session) {
  let store = stores.get(session);
  if (!store) stores.set(session, (store = new NotificationStore(session)));
  return store;
}

export function useMatrixNotifications(session: Session) {
  const store = storeFor(session);
  const [state, setState] = useState(store.getState);
  useEffect(() => {
    setState(store.getState());
    return store.subscribe(() => setState(store.getState()));
  }, [store]);
  return { ...state, refresh: store.refresh, loadMore: store.loadMore };
}

/** How many notifications you haven't read yet (of the most recent page). */
export function useUnreadNotificationCount(session: Session) {
  const { items } = useMatrixNotifications(session);
  return items.filter((n) => !n.read).length;
}

/** Fetches the latest notifications whenever the panel is opened. */
export function useRefreshNotificationsOnOpen(session: Session) {
  const store = storeFor(session);
  useEffect(() => {
    store.refresh();
  }, [store]);
}
