/**
 * Buzzar space: every Buzzar user gets a personal Matrix space ("Buzzar", with the Buzzar icon) that lists the
 * worlds they're in, so other Matrix clients (Element, Cinny…) show their worlds grouped together.
 *
 * - The space's room ID is kept in the `software.haven.world.space` account data, so every device finds the same one.
 * - Buzzar adds each joined world (`org.matrix.msc3815.world` rooms) as an `m.space.child`, and removes worlds
 *   the user has left. It only ever removes children it added itself (marked with `software.haven.world.auto`), so
 *   rooms the user added to the space by hand stay.
 * - Only `m.space.child` events in the space are written; the worlds themselves are never modified.
 */
import { MatrixAuth, uploadMedia } from "./avatarMatrix";
import { getAccountData } from "./legacyAccountData";

export const SPACE_ACCOUNT_DATA_TYPE = "software.haven.world.space";
export const WORLD_ROOM_TYPE = "org.matrix.msc3815.world";
export const AUTO_KEY = "software.haven.world.auto";
/** The tag's name before 2026-11-17: still recognised, and replaced on the next sync. */
export const LEGACY_AUTO_KEY = "software.haven.auto";
const SPACE_ICON_PATH = "/icon-512.png";

export interface SpaceAccountData {
  /** Missing if the user turned the space off before one was ever created. */
  room_id?: string;
  /** The user turned off "Keep my worlds in a Buzzar space"; Buzzar then leaves the space alone. */
  disabled?: boolean;
  /** The uploaded space icon, reused if the space ever has to be recreated. */
  avatar_url?: string;
}

const enc = encodeURIComponent;

async function api(auth: MatrixAuth, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${auth.homeserver.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function parseSpaceAccountData(value: unknown): SpaceAccountData | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { room_id: roomId, avatar_url: avatarUrl, disabled } = value as Record<string, unknown>;
  const data: SpaceAccountData = {};
  if (typeof roomId === "string" && roomId.startsWith("!")) data.room_id = roomId;
  if (typeof avatarUrl === "string" && avatarUrl.startsWith("mxc://")) data.avatar_url = avatarUrl;
  if (disabled === true) data.disabled = true;
  return data;
}

export function serverName(id: string): string | undefined {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : undefined;
}

/**
 * Servers to join a world through. Room version 12 room IDs carry no server name, so always include the user's
 * own homeserver (which is in the room, since the user is joined) and the room ID's server when there is one.
 */
export function viaServers(roomId: string, userId: string): string[] {
  return [...new Set([serverName(userId), serverName(roomId)].filter((s): s is string => !!s))];
}

export interface SpaceChildPlan {
  add: string[];
  remove: string[];
  /** Children Buzzar added that still carry the old tag name: rewritten with the new one. */
  retag: string[];
}

/**
 * What to change in the space: add joined worlds that aren't children yet; remove children Buzzar added for
 * worlds the user is no longer in. `children` maps child room ID → its current content (empty = not a child).
 */
export function planSpaceChildren(
  children: Map<string, Record<string, unknown>>,
  worldIds: Iterable<string>,
  joinedRoomIds: Set<string>
): SpaceChildPlan {
  const worlds = new Set(worldIds);
  const isChild = (content?: Record<string, unknown>) =>
    Array.isArray(content?.via) && (content!.via as unknown[]).length > 0;
  const isAuto = (content: Record<string, unknown>) => content[AUTO_KEY] === true || content[LEGACY_AUTO_KEY] === true;
  const add = [...worlds].filter((id) => !isChild(children.get(id)));
  const remove = [...children]
    .filter(([id, content]) => isChild(content) && isAuto(content) && !worlds.has(id) && !joinedRoomIds.has(id))
    .map(([id]) => id);
  const retag = [...children]
    .filter(([id, content]) => isChild(content) && LEGACY_AUTO_KEY in content && !remove.includes(id))
    .map(([id]) => id);
  return { add, remove, retag };
}

export async function getSpaceAccountData(auth: MatrixAuth, userId: string) {
  const res = await getAccountData(auth, userId, SPACE_ACCOUNT_DATA_TYPE);
  if (res.status === 404) return undefined;
  return parseSpaceAccountData(await json(res, "Reading the Buzzar space pointer"));
}

export async function setSpaceAccountData(auth: MatrixAuth, userId: string, data: SpaceAccountData) {
  await json(
    await api(auth, "PUT", `/_matrix/client/v3/user/${enc(userId)}/account_data/${SPACE_ACCOUNT_DATA_TYPE}`, data),
    "Saving the Buzzar space pointer"
  );
}

export async function getJoinedRoomIds(auth: MatrixAuth): Promise<Set<string>> {
  const { joined_rooms: rooms } = await json<{ joined_rooms: string[] }>(
    await api(auth, "GET", "/_matrix/client/v3/joined_rooms"),
    "Listing joined rooms"
  );
  return new Set(rooms);
}

async function uploadSpaceIcon(auth: MatrixAuth): Promise<string> {
  const res = await fetch(SPACE_ICON_PATH);
  if (!res.ok) throw new Error(`Couldn't load the Buzzar icon: ${res.status}`);
  return uploadMedia(auth, await res.blob(), "buzzar.png");
}

async function createSpace(auth: MatrixAuth, avatarUrl: string): Promise<string> {
  const { room_id: roomId } = await json<{ room_id: string }>(
    await api(auth, "POST", "/_matrix/client/v3/createRoom", {
      name: "Buzzar",
      topic: "Your Buzzar worlds. Buzzar adds the worlds you create and join here.",
      preset: "private_chat",
      visibility: "private",
      creation_content: { type: "m.space" },
      initial_state: [
        {
          type: "m.room.avatar",
          state_key: "",
          content: { url: avatarUrl, info: { mimetype: "image/png", w: 512, h: 512 } },
        },
        { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" } },
      ],
      // A personal space: only its owner changes it. No `users` entry: room v12 rejects power levels listing a
      // creator, and older versions give the creator 100 anyway.
      power_level_content_override: {
        events_default: 100,
        state_default: 100,
        invite: 100,
        kick: 100,
        ban: 100,
        redact: 100,
      },
    }),
    "Creating the Buzzar space"
  );
  return roomId;
}

let ensuring: Promise<string> | undefined;

/** Returns the user's Buzzar space room ID, creating the space (and its account data pointer) if needed. */
export function ensureBuzzarSpace(auth: MatrixAuth, userId: string, joined?: Set<string>): Promise<string> {
  ensuring ??= (async () => {
    const data = await getSpaceAccountData(auth, userId);
    const joinedRooms = joined ?? (await getJoinedRoomIds(auth));
    if (data?.room_id && joinedRooms.has(data.room_id)) return data.room_id;
    const avatarUrl = data?.avatar_url ?? (await uploadSpaceIcon(auth));
    const roomId = await createSpace(auth, avatarUrl);
    await setSpaceAccountData(auth, userId, { ...data, room_id: roomId, avatar_url: avatarUrl });
    return roomId;
  })().finally(() => {
    ensuring = undefined;
  });
  return ensuring;
}

async function getSpaceChildren(auth: MatrixAuth, spaceId: string) {
  const state = await json<{ type: string; state_key: string; content: Record<string, unknown> }[]>(
    await api(auth, "GET", `/_matrix/client/v3/rooms/${enc(spaceId)}/state`),
    "Reading the Buzzar space"
  );
  return new Map(state.filter((e) => e.type === "m.space.child").map((e) => [e.state_key, e.content]));
}

export async function setSpaceChild(
  auth: MatrixAuth,
  spaceId: string,
  childId: string,
  content: Record<string, unknown>
) {
  await json(
    await api(auth, "PUT", `/_matrix/client/v3/rooms/${enc(spaceId)}/state/m.space.child/${enc(childId)}`, content),
    "Updating the Buzzar space"
  );
}

/**
 * Makes the user's Buzzar space list exactly the worlds they're in (plus anything they added by hand).
 * `worldIds` are the joined world rooms; returns what changed.
 */
export async function syncBuzzarSpace(auth: MatrixAuth, userId: string, worldIds: Iterable<string>) {
  if ((await getSpaceAccountData(auth, userId))?.disabled) return undefined;
  const joined = await getJoinedRoomIds(auth);
  const spaceId = await ensureBuzzarSpace(auth, userId, joined);
  const children = await getSpaceChildren(auth, spaceId);
  const plan = planSpaceChildren(
    children,
    [...worldIds].filter((id) => joined.has(id)),
    joined
  );
  for (const id of plan.add) await setSpaceChild(auth, spaceId, id, { via: viaServers(id, userId), [AUTO_KEY]: true });
  for (const id of plan.remove) await setSpaceChild(auth, spaceId, id, {});
  for (const id of plan.retag) {
    const { [LEGACY_AUTO_KEY]: legacyTag, ...content } = children.get(id) ?? {};
    await setSpaceChild(auth, spaceId, id, legacyTag === true ? { ...content, [AUTO_KEY]: true } : content);
  }
  return { spaceId, ...plan };
}

/** Joined world rooms, read from the server (for scripts; the app uses Hydrogen's room list instead). */
export async function fetchJoinedWorldIds(auth: MatrixAuth, joined?: Set<string>): Promise<string[]> {
  const worlds: string[] = [];
  for (const id of joined ?? (await getJoinedRoomIds(auth))) {
    const res = await api(auth, "GET", `/_matrix/client/v3/rooms/${enc(id)}/state/m.room.create/`);
    if (!res.ok) continue;
    const content = (await res.json()) as Record<string, unknown>;
    if (content.type === WORLD_ROOM_TYPE) worlds.push(id);
  }
  return worlds;
}
