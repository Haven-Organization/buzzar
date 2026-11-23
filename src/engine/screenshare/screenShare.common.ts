/**
 * Buzzar (Third Room #398): screen sharing in a world, over the LiveKit call.
 *
 * - The sharer publishes their screen as a LiveKit screen-share track, and says where it goes in a
 *   data message (SCREEN_TOPIC): a floating screen they placed (a position and facing in the world), or one of the
 *   world's screens (glTF nodes with HAVEN_screen, by name). Everyone in the call works out the same place from it.
 * - The main thread turns each screen track into frames (ImageBitmaps) for the render thread, which draws them on a
 *   panel there (screenShare.render.ts). The game thread only answers where the world's screens are and where you
 *   stand (screenShare.game.ts).
 * - Only people in the LiveKit call see shared screens (peer-to-peer calls don't carry them).
 */

export type ScreenSize = "small" | "medium" | "large";
/** Floating screen widths (metres). */
export const SCREEN_WIDTHS: Record<ScreenSize, number> = { small: 1.2, medium: 2, large: 3.5 };
/** How far in front of you a floating screen's handle goes, and how far below your eyes (metres). */
export const FLOATING_DISTANCE = 2;
export const HANDLE_BELOW_EYES = 0.45;
/** Gap between the handle and the picture's bottom edge (metres). */
export const HANDLE_GAP = 0.08;

export type ScreenPlacement =
  /** A floating screen: its handle's position and rotation (the picture stands on the handle, facing its +Z). */
  | {
      kind: "floating";
      position: [number, number, number];
      rotation: [number, number, number, number];
      size: ScreenSize;
    }
  | { kind: "world"; screen: string };

/** A screen the world provides (HAVEN_screen): its node's world transform and the space the picture fits in. */
export interface WorldScreen {
  name: string;
  /** Column-major world matrix; the picture faces the node's +Z. */
  matrix: number[];
  width: number;
  height: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const MAX_COORDINATE = 100000;

/** A placement from a participant attribute (untrusted). */
export function parseScreenPlacement(json: string | undefined): ScreenPlacement | undefined {
  if (!json) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === "world") {
    return typeof v.screen === "string" && v.screen.length > 0 && v.screen.length <= 200
      ? { kind: "world", screen: v.screen }
      : undefined;
  }
  if (v.kind === "floating") {
    const p = v.position;
    if (!Array.isArray(p) || p.length !== 3 || !p.every((c) => finite(c) && Math.abs(c) <= MAX_COORDINATE)) {
      return undefined;
    }
    const r = v.rotation;
    if (!Array.isArray(r) || r.length !== 4 || !r.every((c) => finite(c))) return undefined;
    const length = Math.hypot(r[0], r[1], r[2], r[3]);
    if (length < 1e-6) return undefined;
    const size: ScreenSize = v.size === "small" || v.size === "large" ? v.size : "medium";
    return {
      kind: "floating",
      position: [p[0], p[1], p[2]],
      rotation: [r[0] / length, r[1] / length, r[2] / length, r[3] / length],
      size,
    };
  }
  return undefined;
}

/**
 * A floating screen in front of someone whose eyes are at `eye`, looking towards `yaw` (radians about +Y; 0 looks
 * down -Z): its handle a little below eye level, the picture facing them.
 */
export function floatingPlacement(eye: [number, number, number], yaw: number, size: ScreenSize): ScreenPlacement {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    kind: "floating",
    position: [
      round(eye[0] - Math.sin(yaw) * FLOATING_DISTANCE),
      round(eye[1] - HANDLE_BELOW_EYES),
      round(eye[2] - Math.cos(yaw) * FLOATING_DISTANCE),
    ],
    rotation: [0, round(Math.sin(yaw / 2)), 0, round(Math.cos(yaw / 2))],
    size,
  };
}

/** A column-major world matrix from a position and a rotation quaternion [x, y, z, w]. */
export function poseMatrix(position: [number, number, number], rotation: [number, number, number, number]): number[] {
  const [x, y, z, w] = rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}

/** The picture's size (metres) fitted inside width × height, keeping its aspect ratio (width / height). */
export function fitScreen(width: number, height: number, aspect: number): [number, number] {
  if (!(aspect > 0)) return [width, height];
  return width / height > aspect ? [height * aspect, height] : [width, width / aspect];
}

/** Yaw (radians about +Y) a camera with this column-major world matrix looks towards. */
export function yawOfMatrix(m: ArrayLike<number>): number {
  // The camera looks down its -Z; its +Z axis is the third column.
  return Math.atan2(m[8], m[10]);
}

export enum ScreenShareMessageType {
  /** Main → render: show (or move) a screen. */
  Show = "screen-share-show",
  /** Main → render: its newest picture. */
  Frame = "screen-share-frame",
  /** Main → render: take it away. */
  Hide = "screen-share-hide",
  /** Main → game: where are the world's screens and where am I? */
  Query = "screen-share-query",
  /** Game → main: the answer. */
  QueryResult = "screen-share-query-result",
  /** Main → game: put our screen's handle here (creating it). */
  SetHandle = "screen-share-set-handle",
  /** Main → game: take our screen's handle away. */
  RemoveHandle = "screen-share-remove-handle",
  /** Game → main: our handle moved (it's being carried). */
  HandleMoved = "screen-share-handle-moved",
  /** Game → main: Delete was pressed on our handle (stop sharing). */
  HandleDeleted = "screen-share-handle-deleted",
}

export interface ScreenHandleMessage {
  type: ScreenShareMessageType.SetHandle | ScreenShareMessageType.HandleMoved;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface ScreenShowMessage {
  type: ScreenShareMessageType.Show;
  id: string;
  matrix: number[];
  /** The space the picture fits in (metres). */
  width: number;
  height: number;
  /** "bottom": the matrix is a handle the picture stands on (floating screens); "center": the picture's middle. */
  anchor: "center" | "bottom";
  /** Draw a handle bar (floating screens). */
  handle: boolean;
  /** Who's sharing: shown on the back. */
  label: string;
  /** Glide to a new place rather than jump (someone else's screen, whose moves arrive a few times a second). */
  smooth: boolean;
}

export interface ScreenFrameMessage {
  type: ScreenShareMessageType.Frame;
  id: string;
  bitmap: ImageBitmap;
}

export interface ScreenHideMessage {
  type: ScreenShareMessageType.Hide;
  id: string;
}

export interface ScreenQueryMessage {
  type: ScreenShareMessageType.Query;
  requestId: number;
}

export interface ScreenQueryResultMessage {
  type: ScreenShareMessageType.QueryResult;
  requestId: number;
  screens: WorldScreen[];
  /** Our eyes (camera position) and the way we're looking, when we're in a world. */
  eye?: [number, number, number];
  yaw?: number;
}

/**
 * Who may share their screen in a world (the rules event's `screen_share`; World Settings → Screen Sharing). Each
 * viewer's Buzzar applies it: a screen from someone who may not share isn't shown.
 */
export type ScreenShareRule = "everyone" | "moderators" | "nobody";
export const SCREEN_SHARE_RULES: ScreenShareRule[] = ["everyone", "moderators", "nobody"];

export function parseScreenShareRule(rulesContent: unknown): ScreenShareRule {
  const value = (rulesContent as { screen_share?: unknown } | undefined)?.screen_share;
  return value === "moderators" || value === "nobody" ? value : "everyone";
}

/** The LiveKit data topic a sharer sends their screen's placement on (to everyone, and again to each newcomer). */
export const SCREEN_TOPIC = "software.haven.screen";

/** What's sent on SCREEN_TOPIC: where my screen is (null: not sharing). */
export interface ScreenAnnouncement {
  placement: ScreenPlacement | null;
}

export function parseScreenAnnouncement(payload: Uint8Array): ScreenAnnouncement | undefined {
  if (payload.byteLength > 4096) return undefined;
  let text: string;
  try {
    text = new TextDecoder().decode(payload);
    const value = JSON.parse(text) as { placement?: unknown };
    if (value.placement === null) return { placement: null };
    const placement = parseScreenPlacement(JSON.stringify(value.placement));
    return placement ? { placement } : undefined;
  } catch {
    return undefined;
  }
}
