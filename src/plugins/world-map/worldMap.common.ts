/**
 * Buzzar (Third Room #461): a map of the world. A top-down picture of the world comes from (in order):
 * - the world file's own map (`HAVEN_map`, docs/gltf/HAVEN_map), for authors who draw one;
 * - one its creator generated in World Settings → Map, kept in the `software.haven.world.map` state event;
 * - otherwise none (the map is a plain grid).
 * Over it go live dots for everyone in the world, which cost almost nothing: the positions are already here.
 */

export const WORLD_MAP_EVENT = "software.haven.world.map";

/** The ground area a map picture covers, in metres: its left edge is minX, its top edge minZ (north, -Z, is up). */
export interface WorldMapArea {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WorldMapImage extends WorldMapArea {
  /** mxc:// or http(s) URL, or a Blob from the world file. */
  url?: string;
  blob?: Blob;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The area is stored in whole centimetres: Matrix events allow only whole numbers. */
export function serializeMapEvent(url: string, area: WorldMapArea, cutHeight?: number) {
  const cm = (m: number) => Math.round(m * 100);
  return {
    url,
    min_x_cm: cm(area.minX),
    min_z_cm: cm(area.minZ),
    max_x_cm: cm(area.maxX),
    max_z_cm: cm(area.maxZ),
    ...(cutHeight !== undefined ? { cut_height_cm: cm(cutHeight) } : {}),
  };
}

export function parseMapEvent(content: unknown): (WorldMapImage & { cutHeight?: number }) | undefined {
  if (!content || typeof content !== "object") return undefined;
  const c = content as Record<string, unknown>;
  if (typeof c.url !== "string" || !c.url.startsWith("mxc://")) return undefined;
  const area = parseArea(c.min_x_cm, c.min_z_cm, c.max_x_cm, c.max_z_cm, 100);
  if (!area) return undefined;
  return { url: c.url, ...area, cutHeight: finite(c.cut_height_cm) ? c.cut_height_cm / 100 : undefined };
}

function parseArea(minX: unknown, minZ: unknown, maxX: unknown, maxZ: unknown, scale = 1): WorldMapArea | undefined {
  if (!finite(minX) || !finite(minZ) || !finite(maxX) || !finite(maxZ)) return undefined;
  if (maxX <= minX || maxZ <= minZ) return undefined;
  return { minX: minX / scale, minZ: minZ / scale, maxX: maxX / scale, maxZ: maxZ / scale };
}

/** A world file's `HAVEN_map`: `{ image: <image index>, min: [x, z], max: [x, z] }` (metres). */
export function parseMapExtension(ext: unknown): { image: number; area: WorldMapArea } | undefined {
  if (!ext || typeof ext !== "object") return undefined;
  const e = ext as Record<string, unknown>;
  if (!Number.isInteger(e.image) || (e.image as number) < 0) return undefined;
  if (!Array.isArray(e.min) || !Array.isArray(e.max)) return undefined;
  const area = parseArea(e.min[0], e.min[1], e.max[0], e.max[1]);
  return area ? { image: e.image as number, area } : undefined;
}

export enum WorldMapMessageType {
  /** Main → game: the map opened or closed (positions are only sent while it's open). */
  Enable = "world-map-enable",
  /** Game → main: where everyone is. */
  Positions = "world-map-positions",
  /** Game → main: the world file's own map, sent when the map opens. */
  FileMap = "world-map-file-map",
  /** Main → render: draw the world from above. */
  Generate = "world-map-generate",
  /** Render → main: the picture, or why not. */
  Generated = "world-map-generated",
}

export interface WorldMapEnableMessage {
  type: WorldMapMessageType.Enable;
  enabled: boolean;
}

export interface WorldMapPlayer {
  /** Matrix user ID. */
  peerId: string;
  x: number;
  z: number;
}

export interface WorldMapPositionsMessage {
  type: WorldMapMessageType.Positions;
  /** You, and the way you're facing (radians clockwise from north). */
  self?: { x: number; z: number; heading: number };
  others: WorldMapPlayer[];
}

export interface WorldMapFileMapMessage {
  type: WorldMapMessageType.FileMap;
  map?: WorldMapImage;
}

export interface WorldMapGenerateMessage {
  type: WorldMapMessageType.Generate;
  id: number;
  /** Leave out everything above this height (m), to see inside buildings. */
  cutHeight?: number;
}

export interface WorldMapGeneratedMessage {
  type: WorldMapMessageType.Generated;
  id: number;
  blob?: Blob;
  area?: WorldMapArea;
  error?: string;
}

/** Where a world point lands on the map picture, 0–1 across and down. */
export function mapUV(area: WorldMapArea, x: number, z: number) {
  return { u: (x - area.minX) / (area.maxX - area.minX), v: (z - area.minZ) / (area.maxZ - area.minZ) };
}
