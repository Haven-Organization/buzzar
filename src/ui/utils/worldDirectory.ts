/**
 * Buzzar: Explore lists public worlds from a homeserver's room directory (the standard Matrix
 * /publicRooms API with the MSC3827 room-type filter, in the spec since v1.4), so it works on any
 * homeserver instead of depending on Third Room's repository room on thirdroom.io.
 */
import { MatrixAuth } from "./avatarMatrix";

export const WORLD_ROOM_TYPE = "org.matrix.msc3815.world";

export interface DirectoryWorld {
  room_id: string;
  name?: string;
  topic?: string;
  avatar_url?: string;
  canonical_alias?: string;
  num_joined_members: number;
  room_type?: string;
}

export interface WorldDirectoryPage {
  worlds: DirectoryWorld[];
  nextBatch?: string;
  /** Rooms the server returned that weren't worlds (servers without room-type filtering). */
  skipped: number;
}

function base(auth: MatrixAuth) {
  return auth.homeserver.replace(/\/+$/, "");
}

async function errorText(res: Response) {
  try {
    const body = await res.json();
    if (body?.error) return `${body.error} (${res.status})`;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}`;
}

/**
 * One page of public worlds from `server`'s directory (your own homeserver when omitted). Remote directories are
 * fetched through your homeserver over federation.
 */
export async function fetchWorldDirectory(
  auth: MatrixAuth,
  { server, search, since, limit = 30 }: { server?: string; search?: string; since?: string; limit?: number }
): Promise<WorldDirectoryPage> {
  const query = server ? `?server=${encodeURIComponent(server)}` : "";
  const filter: Record<string, unknown> = { room_types: [WORLD_ROOM_TYPE] };
  if (search) filter.generic_search_term = search;

  const res = await fetch(`${base(auth)}/_matrix/client/v3/publicRooms${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit, since, filter }),
  });
  if (!res.ok)
    throw new Error(`Couldn't read the room directory of ${server ?? "your homeserver"}: ${await errorText(res)}`);

  const body = (await res.json()) as { chunk?: DirectoryWorld[]; next_batch?: string };
  const chunk = body.chunk ?? [];
  // Servers that ignore the room_types filter return every public room; only show actual worlds.
  const worlds = chunk.filter((room) => room.room_type === WORLD_ROOM_TYPE);
  return { worlds, nextBatch: body.next_batch, skipped: chunk.length - worlds.length };
}

/** A failed Matrix request, keeping the spec error code (e.g. M_NOT_FOUND) so callers can explain it. */
export class MatrixRequestError extends Error {
  constructor(message: string, readonly status: number, readonly errcode?: string) {
    super(message);
  }
}

async function requestError(prefix: string, res: Response) {
  let errcode: string | undefined;
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    errcode = body?.errcode;
    if (body?.error) detail = `${body.error} (${res.status})`;
  } catch {
    // not JSON
  }
  return new MatrixRequestError(`${prefix}: ${detail}`, res.status, errcode);
}

/** Joins a room by ID or alias, routing the join through `via` servers (needed for rooms your server isn't in). */
export async function joinRoomVia(auth: MatrixAuth, roomIdOrAlias: string, via: string[] = []) {
  const query = via.length ? `?${via.map((server) => `server_name=${encodeURIComponent(server)}`).join("&")}` : "";
  const res = await fetch(`${base(auth)}/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await requestError("Couldn't join", res);
  return ((await res.json()) as { room_id: string }).room_id;
}

/** Joins a world found in `viaServer`'s directory, routing the join through that server if needed. */
export function joinDirectoryWorld(auth: MatrixAuth, world: DirectoryWorld, viaServer?: string) {
  return joinRoomVia(auth, world.canonical_alias ?? world.room_id, viaServer ? [viaServer] : []);
}

/** The server part of a Matrix user ID (`@alice:example.org` → `example.org`). */
export function serverNameOf(userId: string) {
  return userId.slice(userId.indexOf(":") + 1);
}

// --- Explore servers (account data, so the list follows you to other devices) ------------------------------------

export const EXPLORE_SERVERS_TYPE = "software.haven.explore_servers";
const MAX_EXPLORE_SERVERS = 30;
const SERVER_NAME_REGEX = /^[A-Za-z0-9.\-:[\]]{1,255}$/;

/** Normalises what someone typed ("https://Example.org/" → "example.org"); undefined if it isn't a server name. */
export function normalizeServerName(input: string): string | undefined {
  const name = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  return SERVER_NAME_REGEX.test(name) ? name : undefined;
}

/** Extra homeservers whose directories Explore lists (your own is always included and isn't stored). */
export async function fetchExploreServers(auth: MatrixAuth, userId: string): Promise<string[]> {
  const res = await fetch(
    `${base(auth)}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${EXPLORE_SERVERS_TYPE}`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Couldn't load your Explore servers: ${await errorText(res)}`);
  const body = (await res.json()) as { servers?: unknown };
  if (!Array.isArray(body.servers)) return [];
  const servers: string[] = [];
  for (const value of body.servers) {
    const name = typeof value === "string" ? normalizeServerName(value) : undefined;
    if (name && !servers.includes(name)) servers.push(name);
  }
  return servers.slice(0, MAX_EXPLORE_SERVERS);
}

export async function saveExploreServers(auth: MatrixAuth, userId: string, servers: string[]) {
  const res = await fetch(
    `${base(auth)}/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${EXPLORE_SERVERS_TYPE}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ servers: servers.slice(0, MAX_EXPLORE_SERVERS) }),
    }
  );
  if (!res.ok) throw new Error(`Couldn't save your Explore servers: ${await errorText(res)}`);
}

// --- World preview images ------------------------------------------------------------------------------------------

const MXC_REGEX = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;
const previewCache = new Map<string, Promise<string | undefined>>();

/** The scene preview (mxc) from a world's MSC3815 state, if your homeserver can read it (joined or world-readable). */
export function fetchWorldPreviewUrl(auth: MatrixAuth, roomId: string): Promise<string | undefined> {
  let promise = previewCache.get(roomId);
  if (!promise) {
    promise = (async () => {
      try {
        const res = await fetch(
          `${base(auth)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${WORLD_ROOM_TYPE}/`,
          { headers: { Authorization: `Bearer ${auth.accessToken}` } }
        );
        if (!res.ok) return undefined;
        const content = (await res.json()) as { scene_preview_url?: unknown };
        const url = content.scene_preview_url;
        return typeof url === "string" && MXC_REGEX.test(url) ? url : undefined;
      } catch {
        return undefined;
      }
    })();
    previewCache.set(roomId, promise);
  }
  return promise;
}

/** A link that opens a world in Buzzar (alias when it has one; the alias goes in the hash, as the app navigates). */
export function worldLink(roomIdOrAlias: string) {
  return `${window.location.origin}/world/${roomIdOrAlias}`;
}
