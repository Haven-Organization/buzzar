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
/** How far in front of you a floating screen goes, and its centre's height above your eyes (metres). */
export const FLOATING_DISTANCE = 2;
export const FLOATING_RAISE = 0.2;

export type ScreenPlacement =
  | { kind: "floating"; position: [number, number, number]; yaw: number; size: ScreenSize }
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
    if (!finite(v.yaw)) return undefined;
    const size: ScreenSize = v.size === "small" || v.size === "large" ? v.size : "medium";
    return { kind: "floating", position: [p[0], p[1], p[2]], yaw: v.yaw, size };
  }
  return undefined;
}

/**
 * A floating screen in front of someone whose eyes are at `eye`, looking towards `yaw` (radians about +Y; 0 looks
 * down -Z), facing them.
 */
export function floatingPlacement(eye: [number, number, number], yaw: number, size: ScreenSize): ScreenPlacement {
  const x = eye[0] - Math.sin(yaw) * FLOATING_DISTANCE;
  const z = eye[2] - Math.cos(yaw) * FLOATING_DISTANCE;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    kind: "floating",
    position: [round(x), round(eye[1] + FLOATING_RAISE), round(z)],
    yaw: round(yaw),
    size,
  };
}

/** The world matrix of a floating screen: at its position, turned by its yaw (so it faces where it was placed from). */
export function floatingScreenMatrix(position: [number, number, number], yaw: number): number[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, position[0], position[1], position[2], 1];
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
}

export interface ScreenShowMessage {
  type: ScreenShareMessageType.Show;
  id: string;
  matrix: number[];
  /** The space the picture fits in (metres). */
  width: number;
  height: number;
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
