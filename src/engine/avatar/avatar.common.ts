/** Buzzar avatar messages between the main thread (Matrix side) and the game worker. */

/** Peer id used for the local player when there is no network session (e.g. the /viewer page). */
export const LOCAL_AVATAR_PEER = "@local";

export const SetPeerAvatarMessage = "software.haven.avatar.set-peer";
export const AvatarStatusMessage = "software.haven.avatar.status";
/** main → game: our avatar changed; tell everyone in the world right away (NetworkAction.HavenAvatarChanged). */
export const AnnounceAvatarChangeMessage = "software.haven.avatar.announce";
/** game → main: a peer says its avatar changed; look it up again now (skipping caches). */
export const PeerAvatarChangedMessage = "software.haven.avatar.peer-changed";

export interface PeerAvatarChangedMessageType {
  type: typeof PeerAvatarChangedMessage;
  peerId: string;
}

// main -> game
export interface SetPeerAvatarMessageType {
  type: typeof SetPeerAvatarMessage;
  /** Matrix user id (peers are keyed by user id), or LOCAL_AVATAR_PEER. */
  peerId: string;
  /** http(s)/blob URL of the avatar glb/vrm, or undefined for the default avatar. */
  url?: string;
  /** Display name shown on the loading placeholder. */
  name?: string;
}

export type AvatarLoadStatus = "loaded" | "rejected" | "error";

// game -> main
export interface AvatarStatusMessageType {
  type: typeof AvatarStatusMessage;
  peerId: string;
  url?: string;
  status: AvatarLoadStatus;
  reason?: string;
}

/** main -> game: lets the game worker turn mxc:// URIs into (service-worker authenticated) download URLs. */
export const MediaConfigMessage = "software.haven.media.config";
export interface MediaConfigMessageType {
  type: typeof MediaConfigMessage;
  /** Homeserver base URL, e.g. https://matrix-client.matrix.org */
  homeserver?: string;
}

/** game -> main: the local user pressed an avatar pedestal. */
export const AvatarPedestalSelectedMessage = "software.haven.avatar.pedestal-selected";
export interface AvatarPedestalSelectedMessageType {
  type: typeof AvatarPedestalSelectedMessage;
  /** Avatar URI as written in the world (mxc:// for Matrix worlds), or undefined for the default avatar. */
  uri?: string;
  /** Loadable URL for `uri` (for previews / local-only use). */
  url?: string;
  name?: string;
}

/** Converts an mxc URI into a legacy download URL; sw.ts upgrades it to authenticated media. */
export function mxcToHttp(mxc: string, homeserver: string): string | undefined {
  const match = /^mxc:\/\/([^/]+)\/([A-Za-z0-9_-]+)$/.exec(mxc);
  if (!match) return undefined;
  return `${homeserver.replace(/\/+$/, "")}/_matrix/media/r0/download/${encodeURIComponent(
    match[1]
  )}/${encodeURIComponent(match[2])}`;
}

/**
 * CC0 avatars bundled with Buzzar (public/avatars, see LICENSE.md there). `mxc`/`previewMxc` are one shared copy of
 * the file and its preview on matrix.org (Buzzar's stock account), which everyone wears, so wearing one needs no
 * upload (some homeservers don't let their users upload at all). When a file changes, bump `version`, run
 * scripts/buzzar/sync-shared-media.mjs and copy the new mxcs from res/sharedMedia.json (sharedMedia.test.ts checks).
 */
export const BUILTIN_AVATARS = [
  {
    id: "devil",
    name: "Devil",
    path: "/avatars/031_Devil.vrm",
    preview: "/avatars/previews/devil.png",
    credit: "Polygonal Mind (CC0)",
    // 2: the tail got its own spring bones (2026-11-17).
    version: 2,
    mxc: "mxc://matrix.org/jOlCjOtcnHsmMeWvQmHgeqcC",
    previewMxc: "mxc://matrix.org/PVIElDZDoMGPTBHHUXQbbBvY",
  },
  {
    id: "rose",
    name: "Rose",
    path: "/avatars/057_Rose.vrm",
    preview: "/avatars/previews/rose.png",
    credit: "Polygonal Mind (CC0)",
    version: 1,
    mxc: "mxc://matrix.org/YBNWjPUZPlXQjmshmuoSpdLm",
    previewMxc: "mxc://matrix.org/XHsMKIHjDURUFHdWjHQNLnRh",
  },
] as const;

export type BuiltinAvatar = (typeof BUILTIN_AVATARS)[number];

/**
 * Before the shared copies, wearing a built-in avatar uploaded it to the wearer's own homeserver once per version
 * (kept in their avatar collection under this key). Those uploads are still recognised. Version 1 is the plain id.
 */
export function builtinUploadKey(avatar: BuiltinAvatar) {
  return avatar.version > 1 ? `${avatar.id}@${avatar.version}` : avatar.id;
}

/** The built-in avatar id and version an upload key stands for. */
export function parseBuiltinUploadKey(key: string): { id: string; version: number } {
  const [id, version] = key.split("@");
  return { id, version: version ? Number(version) || 1 : 1 };
}

/**
 * Worlds can offer a bundled avatar with `buzzar-builtin:<id>` (e.g. on a HAVEN_avatar_pedestal), so the scene
 * works on any homeserver without uploading avatars alongside it. Wearing one wears its shared mxc copy (getBuiltinAvatarContent).
 */
export const BUILTIN_AVATAR_SCHEME = "buzzar-builtin:";

export function getBuiltinAvatarByUri(uri: string): BuiltinAvatar | undefined {
  if (!uri.startsWith(BUILTIN_AVATAR_SCHEME)) return undefined;
  const id = uri.slice(BUILTIN_AVATAR_SCHEME.length);
  return BUILTIN_AVATARS.find((avatar) => avatar.id === id);
}
