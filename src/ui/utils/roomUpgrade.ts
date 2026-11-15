/**
 * Buzzar: room upgrades (m.room.tombstone). When a room is upgraded, its tombstone points at the replacement
 * room; the old room stays readable but is no longer used. Buzzar stops chat in the old room and offers to
 * join the replacement, like Element does, and moves players in an upgraded world to the new one.
 */
import { Room, RoomStatus, Session } from "@thirdroom/hydrogen-view-sdk";

import { MatrixAuth } from "./avatarMatrix";
import { joinRoomVia, serverNameOf } from "./worldDirectory";

export interface Tombstone {
  replacementRoom: string;
  body?: string;
  sender?: string;
}

const MAX_HOPS = 5;
const JOIN_SYNC_TIMEOUT_MS = 30_000;

/** Validates a tombstone state event. A tombstone pointing at the room itself, or nowhere, is ignored. */
export function parseTombstone(
  event: { content?: Record<string, unknown>; sender?: string } | undefined,
  roomId?: string
): Tombstone | undefined {
  const replacement = event?.content?.replacement_room;
  if (typeof replacement !== "string" || !replacement.startsWith("!") || replacement === roomId) return undefined;
  const body = event?.content?.body;
  return { replacementRoom: replacement, body: typeof body === "string" ? body : undefined, sender: event?.sender };
}

export async function getTombstone(room: Room): Promise<Tombstone | undefined> {
  return parseTombstone((await room.getStateEvent("m.room.tombstone"))?.event, room.id);
}

/**
 * Servers to join a replacement room through: the upgrader's server (always in the new room), and the user's
 * own server (in it if anyone from there joined already). Room version 12 room IDs carry no server name.
 */
export function upgradeViaServers(tombstone: Tombstone, userId: string): string[] {
  const servers = [tombstone.sender && serverNameOf(tombstone.sender), serverNameOf(userId)];
  const fromId = tombstone.replacementRoom.includes(":") ? serverNameOf(tombstone.replacementRoom) : undefined;
  return [...new Set([...servers, fromId].filter((s): s is string => !!s))];
}

/** Resolves once a room we just joined has synced in as joined. */
export async function waitForJoinedRoom(session: Session, roomId: string, timeoutMessage?: string): Promise<Room> {
  const existing = session.rooms.get(roomId);
  if (existing) return existing;
  const observer = await session.observeRoomStatus(roomId);
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined = undefined;
    const check = (status: RoomStatus) => {
      const room = session.rooms.get(roomId);
      if (!room || status !== RoomStatus.Joined) return false;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(room);
      return true;
    };
    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(new Error(timeoutMessage ?? "Joined, but the room took too long to load. Try again from your room list."));
    }, JOIN_SYNC_TIMEOUT_MS);
    if (!check(observer.get())) unsubscribe = observer.subscribe((status) => check(status));
  });
}

/** World state that a room upgrade doesn't carry over (servers only copy standard state like name and avatar). */
export function isWorldStateType(type: string) {
  return type === "org.matrix.msc3815.world" || (type.startsWith("software.haven.") && !type.includes("member"));
}

type StateEvent = { type: string; state_key: string; content: Record<string, unknown> };

async function getState(auth: MatrixAuth, roomId: string): Promise<StateEvent[]> {
  const res = await fetch(
    `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  if (!res.ok) throw new Error(`Couldn't read room state: ${res.status}`);
  return (await res.json()) as StateEvent[];
}

/** Which world state events from the old room are missing in the new one. */
export function missingWorldState(oldState: StateEvent[], newState: StateEvent[]): StateEvent[] {
  const present = new Set(newState.map((e) => `${e.type}\u0000${e.state_key}`));
  return oldState.filter(
    (e) =>
      isWorldStateType(e.type) &&
      Object.keys(e.content ?? {}).length > 0 &&
      !present.has(`${e.type}\u0000${e.state_key}`)
  );
}

/**
 * Copies the world (scene, Buzzar world settings) from an upgraded room into its replacement, if the new room
 * lacks it. Only works for users allowed to change the new room's state (the upgrader, admins); for everyone
 * else it's a no-op. Returns how many events were copied.
 */
export async function carryOverWorldState(auth: MatrixAuth, oldRoomId: string, newRoomId: string): Promise<number> {
  const [oldState, newState] = await Promise.all([getState(auth, oldRoomId), getState(auth, newRoomId)]);
  const create = newState.find((e) => e.type === "m.room.create");
  if (create?.content?.type !== "org.matrix.msc3815.world") return 0;
  let copied = 0;
  for (const event of missingWorldState(oldState, newState)) {
    const res = await fetch(
      `${auth.homeserver.replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(
        newRoomId
      )}/state/${encodeURIComponent(event.type)}/${encodeURIComponent(event.state_key)}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(event.content),
      }
    );
    if (res.status === 403) return copied; // not allowed to edit the new room: someone else has to
    if (res.ok) copied++;
  }
  return copied;
}

/**
 * Joins the room that replaced `room` (following further upgrades, a few hops at most) and returns it. Rooms
 * already joined are reused without a new join.
 */
export async function joinUpgradedRoom(session: Session, auth: MatrixAuth, room: Room): Promise<Room> {
  let current = room;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const tombstone = await getTombstone(current);
    if (!tombstone) return current;
    let next = session.rooms.get(tombstone.replacementRoom);
    if (!next) {
      const roomId = await joinRoomVia(auth, tombstone.replacementRoom, upgradeViaServers(tombstone, session.userId));
      next = await waitForJoinedRoom(session, roomId);
    }
    // Room upgrades don't copy the world itself; bring it over if we're allowed to.
    await carryOverWorldState(auth, current.id, next.id).catch((e) => console.warn("Couldn't copy the world", e));
    current = next;
  }
  return current;
}
