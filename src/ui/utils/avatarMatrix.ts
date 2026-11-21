/**
 * Buzzar avatar protocol (pure Matrix; see docs/buzzar/plans/01-avatars-and-mirrors.md §A1).
 *
 * - Default avatar: MSC4133 custom profile field `software.haven.world.avatar` (follows the user everywhere).
 * - Per-world avatar: key `software.haven.world.avatar` in the user's own `m.room.member` content in the world
 *   room. Only the user can change their own member event, and it needs no extra power level, so it also
 *   works in existing Third Room (MSC3815) worlds.
 *
 * Resolution order for a player in a world: member event key → profile field → built-in default.
 *
 * Buzzar also keeps a personal collection of uploaded avatars in the `software.haven.world.avatars` account data
 * (private to the user, on every device), so an upload can be worn again later without re-uploading it.
 */
import type { BuiltinAvatar } from "../../engine/avatar/avatar.common";
import { BUILTIN_AVATARS as BUILTINS, parseBuiltinUploadKey } from "../../engine/avatar/avatar.common";
import { getAccountData } from "./legacyAccountData";
export const AVATAR_KEY = "software.haven.world.avatar";
/**
 * The key's name before 2026-11-17. Still read when the new key is absent, and removed whenever Buzzar writes the
 * avatar, so a cleared avatar doesn't come back from it.
 */
export const LEGACY_AVATAR_KEY = "software.haven.avatar";

export type AvatarFormat = "vrm0" | "vrm1" | "glb";

export interface AvatarContent {
  url: string;
  preview_url?: string;
  format?: AvatarFormat;
  name?: string;
}

export interface MatrixAuth {
  homeserver: string;
  accessToken: string;
}

const MXC_REGEX = /^mxc:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9_-]+$/;
const FORMATS = new Set<AvatarFormat>(["vrm0", "vrm1", "glb"]);

/** Validates untrusted event/profile content. Returns undefined for anything malformed. */
export function parseAvatarContent(value: unknown): AvatarContent | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || !MXC_REGEX.test(record.url)) return undefined;

  const content: AvatarContent = { url: record.url };
  if (typeof record.preview_url === "string" && MXC_REGEX.test(record.preview_url)) {
    content.preview_url = record.preview_url;
  }
  if (typeof record.format === "string" && FORMATS.has(record.format as AvatarFormat)) {
    content.format = record.format as AvatarFormat;
  }
  if (typeof record.name === "string") content.name = record.name.slice(0, 100);
  return content;
}

function base(auth: MatrixAuth) {
  return auth.homeserver.replace(/\/+$/, "");
}

async function request(auth: MatrixAuth, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base(auth)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const enc = encodeURIComponent;

export async function fetchMemberContent(
  auth: MatrixAuth,
  roomId: string,
  userId: string
): Promise<Record<string, unknown> | undefined> {
  const res = await request(auth, "GET", `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.member/${enc(userId)}`);
  if (!res.ok) return undefined;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchWorldAvatar(auth: MatrixAuth, roomId: string, userId: string) {
  const content = await fetchMemberContent(auth, roomId, userId);
  return parseAvatarContent(content?.[AVATAR_KEY]) ?? parseAvatarContent(content?.[LEGACY_AVATAR_KEY]);
}

async function fetchProfileField(auth: MatrixAuth, userId: string, key: string): Promise<AvatarContent | undefined> {
  const res = await request(auth, "GET", `/_matrix/client/v3/profile/${enc(userId)}/${enc(key)}`);
  if (!res.ok) return undefined;
  const body = (await res.json()) as Record<string, unknown>;
  return parseAvatarContent(body[key]);
}

export async function fetchProfileAvatar(auth: MatrixAuth, userId: string): Promise<AvatarContent | undefined> {
  return (
    (await fetchProfileField(auth, userId, AVATAR_KEY)) ?? (await fetchProfileField(auth, userId, LEGACY_AVATAR_KEY))
  );
}

/** member event key → profile field → undefined (default avatar). */
export async function resolveAvatar(auth: MatrixAuth, roomId: string, userId: string) {
  return (await fetchWorldAvatar(auth, roomId, userId)) ?? (await fetchProfileAvatar(auth, userId));
}

export async function setProfileAvatar(auth: MatrixAuth, userId: string, avatar: AvatarContent | undefined) {
  const path = `/_matrix/client/v3/profile/${enc(userId)}/${enc(AVATAR_KEY)}`;
  const res = avatar ? await request(auth, "PUT", path, { [AVATAR_KEY]: avatar }) : await request(auth, "DELETE", path);
  if (!res.ok && !(res.status === 404 && !avatar)) {
    throw new Error(`Failed to update profile avatar: ${res.status} ${await res.text()}`);
  }
  // Drop the field under its old name (404 when there was none).
  const legacy = await request(
    auth,
    "DELETE",
    `/_matrix/client/v3/profile/${enc(userId)}/${enc(LEGACY_AVATAR_KEY)}`
  ).catch(() => undefined);
  if (legacy && !legacy.ok && legacy.status !== 404) {
    console.warn(`Couldn't remove the old ${LEGACY_AVATAR_KEY} profile field: ${legacy.status}`);
  }
}

/**
 * Set (or clear) the avatar you use in one world by updating your own member event. Keeps every other
 * field of the current member event intact. Only works while joined.
 */
export async function setWorldAvatar(
  auth: MatrixAuth,
  roomId: string,
  userId: string,
  avatar: AvatarContent | undefined
) {
  const current = await fetchMemberContent(auth, roomId, userId);
  if (!current || current.membership !== "join") throw new Error("You must be joined to the world to set its avatar");

  const next: Record<string, unknown> = { ...current };
  if (avatar) next[AVATAR_KEY] = avatar;
  else delete next[AVATAR_KEY];
  delete next[LEGACY_AVATAR_KEY];

  const res = await request(
    auth,
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.member/${enc(userId)}`,
    next
  );
  if (!res.ok) throw new Error(`Failed to update world avatar: ${res.status} ${await res.text()}`);
}

/** Reads the active session's homeserver + token from session storage. */
export async function getSessionAuth(
  platform: {
    sessionInfoStorage: {
      get(id: string): Promise<{ homeserver?: string; homeServer?: string; accessToken: string } | undefined>;
    };
  },
  sessionId: string | undefined
): Promise<MatrixAuth | undefined> {
  if (!sessionId) return undefined;
  const info = await platform.sessionInfoStorage.get(sessionId);
  const homeserver = info?.homeserver ?? info?.homeServer;
  if (!info?.accessToken || !homeserver) return undefined;
  return { homeserver, accessToken: info.accessToken };
}

/** Uploads a file to the homeserver's media repo and returns its mxc URI. */
export async function uploadMedia(auth: MatrixAuth, blob: Blob, filename: string): Promise<string> {
  const res = await fetch(`${base(auth)}/_matrix/media/v3/upload?filename=${enc(filename)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const { content_uri: uri } = (await res.json()) as { content_uri?: string };
  if (!uri) throw new Error("Upload failed: no content_uri");
  return uri;
}

// --- Personal avatar collection (account data) ----------------------------------------------------

export const AVATAR_COLLECTION_TYPE = "software.haven.world.avatars";
const MAX_SAVED_AVATARS = 100;

export interface SavedAvatar extends AvatarContent {
  /** When it was added, in ms since the epoch. */
  added_ts: number;
}

export interface AvatarCollection {
  /** Newest first. */
  avatars: SavedAvatar[];
  /** mxc URIs of the built-in avatars, once uploaded to this homeserver (by upload key: id, or id@version). */
  builtin: Record<string, string>;
}

/** Validates untrusted account data. */
export function parseAvatarCollection(value: unknown): AvatarCollection {
  const collection: AvatarCollection = { avatars: [], builtin: {} };
  if (typeof value !== "object" || value === null) return collection;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.avatars)) {
    for (const item of record.avatars) {
      const content = parseAvatarContent(item);
      if (!content || collection.avatars.some((a) => a.url === content.url)) continue;
      const added = (item as Record<string, unknown>).added_ts;
      collection.avatars.push({ ...content, added_ts: typeof added === "number" ? added : 0 });
    }
  }
  if (typeof record.builtin === "object" && record.builtin !== null) {
    for (const [id, url] of Object.entries(record.builtin as Record<string, unknown>)) {
      if (typeof url === "string" && MXC_REGEX.test(url)) collection.builtin[id] = url;
    }
  }
  return collection;
}

export async function fetchAvatarCollection(auth: MatrixAuth, userId: string): Promise<AvatarCollection> {
  const res = await getAccountData(auth, userId, AVATAR_COLLECTION_TYPE);
  if (res.status === 404) return { avatars: [], builtin: {} };
  if (!res.ok) throw new Error(`Couldn't load your saved avatars: ${res.status}`);
  return parseAvatarCollection(await res.json());
}

async function putAvatarCollection(auth: MatrixAuth, userId: string, collection: AvatarCollection) {
  const res = await request(
    auth,
    "PUT",
    `/_matrix/client/v3/user/${enc(userId)}/account_data/${AVATAR_COLLECTION_TYPE}`,
    collection
  );
  if (!res.ok) throw new Error(`Couldn't save your avatars: ${res.status} ${await res.text()}`);
}

/** Adds (or moves to the front, updating its details) an uploaded avatar in the user's collection. */
export async function saveToAvatarCollection(auth: MatrixAuth, userId: string, avatar: AvatarContent) {
  const collection = await fetchAvatarCollection(auth, userId);
  const existing = collection.avatars.find((a) => a.url === avatar.url);
  const saved: SavedAvatar = { ...existing, ...avatar, added_ts: existing?.added_ts ?? Date.now() };
  if (!saved.preview_url) delete saved.preview_url;
  collection.avatars = [saved, ...collection.avatars.filter((a) => a.url !== avatar.url)].slice(0, MAX_SAVED_AVATARS);
  await putAvatarCollection(auth, userId, collection);
  return collection;
}

/** Removes an avatar from the collection (the uploaded file itself stays on the homeserver). */
export async function removeFromAvatarCollection(auth: MatrixAuth, userId: string, url: string) {
  const collection = await fetchAvatarCollection(auth, userId);
  collection.avatars = collection.avatars.filter((a) => a.url !== url);
  await putAvatarCollection(auth, userId, collection);
  return collection;
}

export { BUILTIN_AVATARS } from "../../engine/avatar/avatar.common";
export type { BuiltinAvatar } from "../../engine/avatar/avatar.common";

/** A built-in avatar as worn: its shared copy on matrix.org (nothing is uploaded). */
export function getBuiltinAvatarContent(avatar: BuiltinAvatar): AvatarContent {
  return { url: avatar.mxc, name: avatar.name, preview_url: avatar.previewMxc };
}

/** Every mxc that is built-in avatar `avatar`: its shared copy, and this user's own uploads of it from before. */
export function builtinUrls(collection: AvatarCollection | undefined, avatar: BuiltinAvatar): string[] {
  const own = Object.entries(collection?.builtin ?? {})
    .filter(([key]) => !key.endsWith("_preview") && parseBuiltinUploadKey(key).id === avatar.id)
    .map(([, mxc]) => mxc);
  return [avatar.mxc, ...own];
}

/** The built-in avatar an mxc URI is: its shared copy, or this user's own upload of it from before. */
export function builtinIdForUrl(collection: AvatarCollection | undefined, url: string | undefined) {
  if (!url) return undefined;
  const shared = BUILTINS.find((a) => a.mxc === url);
  if (shared) return shared.id;
  if (!collection) return undefined;
  const key = Object.entries(collection.builtin).find(([key, mxc]) => mxc === url && !key.endsWith("_preview"))?.[0];
  return key ? parseBuiltinUploadKey(key).id : undefined;
}

/**
 * The current version of a built-in avatar, if `url` is this user's upload of an older version of it (the model
 * changed since they put it on), so it can be swapped for the current shared copy.
 */
export function outdatedBuiltinForUrl(collection: AvatarCollection | undefined, url: string | undefined) {
  if (!collection || !url) return undefined;
  for (const [key, mxc] of Object.entries(collection.builtin)) {
    if (mxc !== url || key.endsWith("_preview")) continue;
    const { id, version } = parseBuiltinUploadKey(key);
    const avatar = BUILTINS.find((a) => a.id === id);
    if (avatar && version < avatar.version) return avatar;
  }
  return undefined;
}
