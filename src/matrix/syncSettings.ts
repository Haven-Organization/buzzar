/**
 * Buzzar's Matrix layer: the "faster sync" (sliding sync, MSC4186) setting. Off by default while it's experimental.
 * Kept per browser, and read when a session starts, so changing it needs a reload.
 */
const SLIDING_SYNC_KEY = "buzzar.slidingSync";
/** Set when the setting changes: the next start clears the local sync cache, which the two kinds of sync can't share. */
const RESET_SYNC_STORE_KEY = "buzzar.resetSyncStore";

function read(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function isSlidingSyncEnabled(): boolean {
  return read(SLIDING_SYNC_KEY);
}

export function setSlidingSyncEnabled(enabled: boolean) {
  if (enabled === isSlidingSyncEnabled()) return;
  try {
    if (enabled) localStorage.setItem(SLIDING_SYNC_KEY, "1");
    else localStorage.removeItem(SLIDING_SYNC_KEY);
    localStorage.setItem(RESET_SYNC_STORE_KEY, "1");
  } catch {
    // storage unavailable: the setting can't be kept
  }
}

/**
 * The rooms a user needs straight after start-up (their profile room and Home World), remembered per account so
 * sliding sync can ask for those first and everything else afterwards.
 */
function startRoomsKey(userId: string) {
  return `buzzar.startRooms.${userId}`;
}

export function getStartRooms(userId: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(startRoomsKey(userId)) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string" && id.startsWith("!"))
      : [];
  } catch {
    return [];
  }
}

export function setStartRooms(userId: string, roomIds: (string | undefined)[]) {
  try {
    localStorage.setItem(startRoomsKey(userId), JSON.stringify([...new Set(roomIds.filter(Boolean))]));
  } catch {
    // not remembered: the next start loads every room before it's ready
  }
}

/** Whether the local sync cache has to be cleared before this start (and forgets the request). */
export function takeSyncStoreReset(): boolean {
  const wanted = read(RESET_SYNC_STORE_KEY);
  try {
    localStorage.removeItem(RESET_SYNC_STORE_KEY);
  } catch {
    // ignore
  }
  return wanted;
}

/**
 * The state the room list asks for, for every room (sliding sync). Enough to show rooms and worlds in lists and to
 * enter a world, without subscribing to the room.
 */
export const SLIDING_SYNC_STATE = [
  ["m.room.create", ""],
  ["m.room.name", ""],
  ["m.room.avatar", ""],
  ["m.room.canonical_alias", ""],
  ["m.room.topic", ""],
  ["m.room.tombstone", ""],
  ["m.room.encryption", ""],
  ["m.room.join_rules", ""],
  ["m.room.power_levels", ""],
  ["m.room.member", "$ME"],
  ["m.room.member", "$LAZY"],
  ["m.space.child", "*"],
  ["org.matrix.msc3815.world", ""],
  ["software.haven.world.rules", ""],
  // The world's recommended call type (callMethod.ts), read when entering a world and in World Settings → Calls.
  ["software.haven.world.call", ""],
  ["org.matrix.msc3401.call", "*"],
  ["org.matrix.msc3401.call.member", "*"],
];

/** State types every room in the list carries, so reading them needs no subscription. */
export const LIST_STATE_TYPES = new Set(SLIDING_SYNC_STATE.map(([type]) => type));

/**
 * The state asked for a room someone is looking at (chat open, in the world, settings). Explicit rather than
 * everything: everything includes every member, and for rooms with thousands of people that meant downloading and
 * processing every member event (the full list loads on its own when a member list is opened).
 */
export const ROOM_SUBSCRIPTION_STATE = [
  ...SLIDING_SYNC_STATE,
  ["m.room.history_visibility", ""],
  ["m.room.guest_access", ""],
  ["m.room.server_acl", ""],
  ["m.room.pinned_events", ""],
  ["m.space.parent", "*"],
  ["m.world", ""],
  ["org.matrix.msc3815.world.profile", ""],
  ["msc3948.repository_room.featured_world", "*"],
  ["msc3948.repository_room.featured_room", "*"],
  ["msc3948.repository_room.featured_scene", "*"],
];
