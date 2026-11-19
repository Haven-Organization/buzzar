/**
 * Buzzar: how a Thing behaves as a physical object, from its own file (root extension `HAVEN_thing`,
 * docs/gltf/HAVEN_thing): its collision shape, weight, whether it can tip over, and where it appears when spawned.
 * Buzzar's built-in values for a stock Thing are only the fallback, used until (or unless) its file says otherwise.
 */
type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

export type ThingCollider =
  | { type: "box"; size: [number, number, number]; offset: [number, number, number] }
  | { type: "sphere"; radius: number; offset: [number, number, number] }
  | { type: "cylinder"; radius: number; height: number; offset: [number, number, number] };

export interface ThingPhysics {
  collider: ThingCollider;
  /** kg per cubic metre. */
  density?: number;
  /** "yaw": only turns about the vertical, so it can't tip over. "free": turns any way. */
  rotation: "free" | "yaw";
  /** Held, it only turns to your heading; left tilted, it settles back level. */
  upright: boolean;
  /** Metres in front of you it appears, and whether it's stood level facing the way you look. */
  spawn?: { distance: number; upright: boolean };
}

function vec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? [v[0], v[1], v[2]]
    : fallback;
}

function parseCollider(v: unknown): ThingCollider | undefined {
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

/** A Thing file's HAVEN_thing, over `fallback` (fields it leaves out, or gets wrong, keep the fallback's). */
export function readThingPhysics(gltf: { extensions?: AnyRecord } | undefined, fallback: ThingPhysics): ThingPhysics {
  const ext = gltf?.extensions?.HAVEN_thing;
  if (!isRecord(ext)) return fallback;
  const spawn = isRecord(ext.spawn)
    ? {
        distance: positive(ext.spawn.distance) ?? fallback.spawn?.distance ?? 1,
        upright: typeof ext.spawn.upright === "boolean" ? ext.spawn.upright : fallback.spawn?.upright ?? false,
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

/** Thing files whose HAVEN_thing has been read, by URI (filled as they load). */
const loaded = new Map<string, { extensions?: AnyRecord }>();

export function rememberThingFile(uri: string, gltf: { extensions?: AnyRecord }) {
  loaded.set(uri, gltf);
}

export function thingPhysics(uri: string, fallback: ThingPhysics): ThingPhysics {
  return readThingPhysics(loaded.get(uri), fallback);
}
