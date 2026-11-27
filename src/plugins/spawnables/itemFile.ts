/**
 * Buzzar: how an Item behaves as a physical object, from its own file (root extension `HAVEN_item`,
 * docs/gltf/HAVEN_item): its collision shape, weight, whether it can tip over, and where it appears when spawned.
 * Buzzar's built-in values for a stock Item are only the fallback, used until (or unless) its file says otherwise.
 */
import { mat4, vec3 as v3 } from "gl-matrix";

import { HoldSpec, readHold } from "../../engine/avatar/holdSpec";
import { isCustomItemId } from "../../engine/network/spawnRules.common";
import { itemExtension } from "../../engine/gltf/itemExtension";

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

export type ItemCollider =
  | { type: "box"; size: [number, number, number]; offset: [number, number, number] }
  | { type: "sphere"; radius: number; offset: [number, number, number] }
  | { type: "cylinder"; radius: number; height: number; offset: [number, number, number] };

export interface ItemPhysics {
  collider: ItemCollider;
  /** kg per cubic metre. */
  density?: number;
  /** "yaw": only turns about the vertical, so it can't tip over. "free": turns any way. */
  rotation: "free" | "yaw";
  /** Held, it only turns to your heading; left tilted, it settles back level. */
  upright: boolean;
  /**
   * Metres in front of you it appears, whether it's stood level facing the way you look, and whether it appears in
   * your hold instead of being set down (for Items you carry, like a torch).
   */
  spawn?: { distance: number; upright: boolean; held?: boolean };
}

function vec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? [v[0], v[1], v[2]]
    : fallback;
}

function parseCollider(v: unknown): ItemCollider | undefined {
  if (!isRecord(v)) return undefined;
  const offset = vec3(v.offset, [0, 0, 0]);
  if (v.type === "box") {
    const size = vec3(v.size, [0, 0, 0]);
    return size.every((x) => x > 0) ? { type: "box", size, offset } : undefined;
  }
  const radius = positive(v.radius);
  if (!radius) return undefined;
  if (v.type === "sphere") return { type: "sphere", radius, offset };
  const height = positive(v.height);
  if (v.type === "cylinder" && height) return { type: "cylinder", radius, height, offset };
  return undefined;
}

/** An Item file's HAVEN_item, over `fallback` (fields it leaves out, or gets wrong, keep the fallback's). */
export function readItemPhysics(gltf: { extensions?: AnyRecord } | undefined, fallback: ItemPhysics): ItemPhysics {
  const ext = itemExtension(gltf);
  if (!isRecord(ext)) return fallback;
  const spawn = isRecord(ext.spawn)
    ? {
        distance: positive(ext.spawn.distance) ?? fallback.spawn?.distance ?? 1,
        upright: typeof ext.spawn.upright === "boolean" ? ext.spawn.upright : fallback.spawn?.upright ?? false,
        ...((typeof ext.spawn.held === "boolean" ? ext.spawn.held : fallback.spawn?.held) ? { held: true } : {}),
      }
    : fallback.spawn;
  return {
    collider: parseCollider(ext.collider) ?? fallback.collider,
    density: positive(ext.density) ?? fallback.density,
    rotation: ext.rotation === "yaw" || ext.rotation === "free" ? ext.rotation : fallback.rotation,
    upright: typeof ext.upright === "boolean" ? ext.upright : fallback.upright,
    spawn,
  };
}

/** Item files whose HAVEN_item has been read, by URI (filled as they load). */
const loaded = new Map<string, GLTFGeometry & { extensions?: AnyRecord }>();

export function rememberItemFile(uri: string, gltf: GLTFGeometry & { extensions?: AnyRecord }) {
  loaded.set(uri, gltf);
}

/** An Item file's glTF JSON, once it has loaded. */
export function loadedItemFile(uri: string) {
  return loaded.get(uri);
}

export function itemPhysics(uri: string, fallback: ItemPhysics): ItemPhysics {
  return readItemPhysics(loaded.get(uri), fallback);
}

/** The parts of a glTF file's JSON that bounds are worked out from. */
export interface GLTFGeometry {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: {
    children?: number[];
    mesh?: number;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes?: { primitives?: { attributes?: { POSITION?: number } }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
}

/**
 * The box around a file's default scene, in metres, from its position accessors' min/max (which glTF requires) and
 * the node transforms. Undefined when the file has no geometry.
 */
export function gltfBounds(
  gltf: GLTFGeometry
): { min: [number, number, number]; max: [number, number, number] } | undefined {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const corner = v3.create();
  const local = mat4.create();
  const world = mat4.create();
  const visit = (index: number, parent: mat4, depth: number) => {
    const node = gltf.nodes?.[index];
    if (!node || depth > 64) return;
    if (node.matrix?.length === 16) mat4.copy(local, node.matrix as unknown as mat4);
    else
      mat4.fromRotationTranslationScale(
        local,
        (node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number],
        (node.translation ?? [0, 0, 0]) as [number, number, number],
        (node.scale ?? [1, 1, 1]) as [number, number, number]
      );
    const transform = mat4.multiply(mat4.create(), parent, local);
    for (const primitive of node.mesh !== undefined ? gltf.meshes?.[node.mesh]?.primitives ?? [] : []) {
      const accessor =
        primitive.attributes?.POSITION !== undefined ? gltf.accessors?.[primitive.attributes.POSITION] : undefined;
      if (accessor?.min?.length !== 3 || accessor.max?.length !== 3) continue;
      for (let i = 0; i < 8; i++) {
        v3.set(
          corner,
          i & 1 ? accessor.max[0] : accessor.min[0],
          i & 2 ? accessor.max[1] : accessor.min[1],
          i & 4 ? accessor.max[2] : accessor.min[2]
        );
        v3.transformMat4(corner, corner, transform);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], corner[a]);
          max[a] = Math.max(max[a], corner[a]);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, transform, depth + 1);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const root of scene?.nodes ?? []) visit(root, mat4.identity(world), 0);
  if (!min.every(Number.isFinite)) return undefined;
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

/** Physics for a custom Item whose file has no HAVEN_item: a box around it, appearing just clear of you. */
export function physicsFromBounds(bounds: ReturnType<typeof gltfBounds>): ItemPhysics {
  if (!bounds)
    return { collider: { type: "box", size: [0.3, 0.3, 0.3], offset: [0, 0.15, 0] }, rotation: "free", upright: false };
  const size = [0, 1, 2].map((a) => Math.max(0.02, bounds.max[a] - bounds.min[a])) as [number, number, number];
  const offset = [0, 1, 2].map((a) => (bounds.max[a] + bounds.min[a]) / 2) as [number, number, number];
  return {
    collider: { type: "box", size, offset },
    rotation: "free",
    upright: false,
    spawn: { distance: Math.max(1, Math.max(size[0], size[2]) / 2 + 0.6), upright: false },
  };
}

/** How an Item is held in the hands (HAVEN_item hold), once its file has loaded; stock Items don't say. */
export function itemHoldOf(prefab: string | undefined): HoldSpec | undefined {
  return prefab && isCustomItemId(prefab) ? readHold(loadedItemFile(prefab)) : undefined;
}

/**
 * `HAVEN_item` for these physics (what a file would say to get them), keeping any other properties `existing` has
 * (hold, …). Used to bake Buzzar's own guesses into a file, so every client handles it the same way.
 */
export function itemPhysicsToJSON(
  physics: ItemPhysics,
  existing: Record<string, unknown> = {}
): Record<string, unknown> {
  const c = physics.collider;
  const collider =
    c.type === "box"
      ? { type: "box", size: c.size, offset: c.offset }
      : c.type === "sphere"
      ? { type: "sphere", radius: c.radius, offset: c.offset }
      : { type: "cylinder", radius: c.radius, height: c.height, offset: c.offset };
  const round = (v: unknown): unknown =>
    typeof v === "number" ? Math.round(v * 10000) / 10000 : Array.isArray(v) ? v.map(round) : v;
  const out: Record<string, unknown> = {
    ...existing,
    collider: Object.fromEntries(Object.entries(collider).map(([k, v]) => [k, round(v)])),
    rotation: physics.rotation,
    upright: physics.upright,
  };
  if (physics.density) out.density = physics.density;
  if (physics.spawn) out.spawn = { ...physics.spawn, distance: round(physics.spawn.distance) };
  return out;
}

/** An Item file's physics as Buzzar would use them: its HAVEN_item over a box fitted around the model. */
export function bakedItemPhysics(gltf: GLTFGeometry & { extensions?: AnyRecord }): ItemPhysics {
  return readItemPhysics(gltf, physicsFromBounds(gltfBounds(gltf)));
}
