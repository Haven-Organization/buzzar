/** Buzzar avatar messages between the main thread (Matrix side) and the game worker. */

/** Peer id used for the local player when there is no network session (e.g. the /viewer page). */
export const LOCAL_AVATAR_PEER = "@local";

export const SetPeerAvatarMessage = "software.haven.avatar.set-peer";
export const AvatarStatusMessage = "software.haven.avatar.status";

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
