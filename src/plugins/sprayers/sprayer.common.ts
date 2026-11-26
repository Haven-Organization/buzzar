/**
 * Buzzar: Things that spray water (or anything liquid): water guns, spray bottles, hoses. Everything about one lives
 * in its file, in the root extension `HAVEN_sprayer` (docs/gltf/HAVEN_sprayer): where the nozzle is, how the stream
 * flies, how much a full tank holds, how pumping refills it, and its sounds (KHR_audio sources in the same file).
 *
 * Hold Use (left click) to spray: the stream drains the tank, and stops when it's empty. Pump (right click) to refill
 * it: the pump sound plays, and when the stroke is done the tank has `refill` seconds more (a full tank by default).
 * You can't spray while pumping.
 */

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const vec3 = (v: unknown): [number, number, number] | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? [v[0], v[1], v[2]]
    : undefined;
const index = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);

export interface SprayerSpec {
  /** Where the stream leaves, in the Thing's space (metres). */
  nozzle: [number, number, number];
  /** Which way it leaves (normalised). */
  direction: [number, number, number];
  /** Metres per second the water leaves at. */
  speed: number;
  /** How much the stream wanders, in degrees. */
  spread: number;
  /** Drops per second (how solid the stream looks). */
  rate: number;
  /** Drop radius, metres. */
  dropSize: number;
  /** RGBA colour of the water. */
  color: [number, number, number, number];
  /** Seconds of spraying a full tank holds. */
  capacity: number;
  /** Seconds of spraying one pump adds. */
  refill: number;
  /** Seconds one pump takes (no spraying meanwhile). */
  pumpTime: number;
  /** KHR_audio source indices in the file. */
  sounds: { spray?: number; pump?: number; empty?: number };
}

export const MAX_DROPS_PER_SECOND = 120;

/** A file's HAVEN_sprayer (untrusted), or undefined if it has none. */
export function readSprayer(gltf: { extensions?: AnyRecord } | undefined): SprayerSpec | undefined {
  const ext = gltf?.extensions?.HAVEN_sprayer;
  if (!isRecord(ext)) return undefined;
  const nozzle = isRecord(ext.nozzle) ? ext.nozzle : {};
  const position = vec3(nozzle.position) ?? [0, 0, 0];
  const raw = vec3(nozzle.direction) ?? [0, 0, -1];
  const length = Math.hypot(...raw);
  const direction: [number, number, number] =
    length > 1e-6 ? [raw[0] / length, raw[1] / length, raw[2] / length] : [0, 0, -1];
  const capacity = num(ext.capacity, 0.1, 600) ?? 5;
  const sounds = isRecord(ext.sounds) ? ext.sounds : {};
  const color: [number, number, number, number] =
    Array.isArray(ext.color) && ext.color.length === 4 && ext.color.every((c) => num(c, 0, 1) !== undefined)
      ? (ext.color as [number, number, number, number])
      : [0.62, 0.83, 1, 0.6];
  return {
    nozzle: position,
    direction,
    speed: num(ext.speed, 0.5, 50) ?? 9,
    spread: num(ext.spread, 0, 45) ?? 1.5,
    rate: num(ext.rate, 1, MAX_DROPS_PER_SECOND) ?? 70,
    dropSize: num(ext.dropSize, 0.005, 0.2) ?? 0.025,
    color,
    capacity,
    refill: num(ext.refill, 0.1, 600) ?? capacity,
    pumpTime: num(ext.pumpTime, 0, 10) ?? 1,
    sounds: { spray: index(sounds.spray), pump: index(sounds.pump), empty: index(sounds.empty) },
  };
}

/** A sprayer's water and pump, as its holder sees them. */
export interface TankState {
  /** Seconds of spraying left. */
  water: number;
  /** Seconds until the pump stroke in progress finishes (0: not pumping). */
  pumping: number;
}

export const fullTank = (spec: SprayerSpec): TankState => ({ water: spec.capacity, pumping: 0 });

/**
 * One frame of a sprayer in your hands: `trigger` held, `pump` pressed this frame. Returns whether it sprays this
 * frame, and what happened (a pump started, the tank ran dry).
 */
export function stepTank(
  tank: TankState,
  spec: SprayerSpec,
  dt: number,
  trigger: boolean,
  pump: boolean
): { spraying: boolean; pumped: boolean; ranDry: boolean } {
  let pumped = false;
  if (tank.pumping > 0) {
    tank.pumping -= dt;
    if (tank.pumping <= 0) {
      tank.pumping = 0;
      tank.water = Math.min(spec.capacity, tank.water + spec.refill);
    }
  } else if (pump) {
    pumped = true;
    tank.pumping = spec.pumpTime;
    if (spec.pumpTime === 0) tank.water = Math.min(spec.capacity, tank.water + spec.refill);
  }
  const spraying = trigger && tank.pumping === 0 && tank.water > 0;
  let ranDry = false;
  if (spraying) {
    tank.water = Math.max(0, tank.water - dt);
    ranDry = tank.water === 0;
  }
  return { spraying, pumped, ranDry };
}
