/**
 * Buzzar avatar protocol (pure Matrix; see docs/buzzar/plans/01-avatars-and-mirrors.md §A1).
 *
 * - Default avatar: MSC4133 custom profile field `software.haven.avatar` (follows the user everywhere).
 * - Per-world avatar: key `software.haven.avatar` in the user's own `m.room.member` content in the world
 *   room. Only the user can change their own member event, and it needs no extra power level, so it also
 *   works in existing Third Room (MSC3815) worlds.
 *
 * Resolution order for a player in a world: member event key → profile field → built-in default.
 */
export const AVATAR_KEY = "software.haven.avatar";

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
  return parseAvatarContent(content?.[AVATAR_KEY]);
}

export async function fetchProfileAvatar(auth: MatrixAuth, userId: string): Promise<AvatarContent | undefined> {
  const res = await request(auth, "GET", `/_matrix/client/v3/profile/${enc(userId)}/${enc(AVATAR_KEY)}`);
  if (!res.ok) return undefined;
  const body = (await res.json()) as Record<string, unknown>;
  return parseAvatarContent(body[AVATAR_KEY]);
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

  const res = await request(
    auth,
    "PUT",
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/m.room.member/${enc(userId)}`,
    next
  );
  if (!res.ok) throw new Error(`Failed to update world avatar: ${res.status} ${await res.text()}`);
}

/** Reads the active session's homeserver + token from Hydrogen's session storage. */
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

/** CC0 avatars bundled with Buzzar (public/avatars, see LICENSE.md there). */
export const BUILTIN_AVATARS = [
  { id: "devil", name: "Devil", path: "/avatars/031_Devil.vrm", credit: "Polygonal Mind (CC0)" },
  { id: "rose", name: "Rose", path: "/avatars/057_Rose.vrm", credit: "Polygonal Mind (CC0)" },
] as const;

export type BuiltinAvatar = (typeof BUILTIN_AVATARS)[number];

/**
 * Built-in avatars still have to live on the homeserver so every client can load them by mxc URI. Upload once
 * per user and homeserver, then reuse the mxc from local storage.
 */
export async function getBuiltinAvatarContent(auth: MatrixAuth, userId: string, avatar: BuiltinAvatar) {
  const cacheKey = `software.haven.builtin_avatar.${avatar.id}.${userId}`;
  let url: string | null = null;
  try {
    url = localStorage.getItem(cacheKey);
  } catch {
    // storage unavailable
  }
  if (!url || !MXC_REGEX.test(url)) {
    const res = await fetch(avatar.path);
    if (!res.ok) throw new Error(`Couldn't load built-in avatar ${avatar.name}`);
    url = await uploadMedia(auth, await res.blob(), avatar.path.split("/").pop()!);
    try {
      localStorage.setItem(cacheKey, url);
    } catch {
      // storage unavailable
    }
  }
  return { url, name: avatar.name } satisfies AvatarContent;
}
