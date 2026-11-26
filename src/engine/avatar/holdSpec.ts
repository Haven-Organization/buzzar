/**
 * Buzzar: how a Thing is held (HAVEN_thing `hold`, docs/gltf/HAVEN_thing): read from its file, used by the avatar
 * hold rig (holdPose.ts). Pure: no engine imports, so files and tests can use it.
 *
 * Grips are given as a hand's "handshake" frame in the Thing's space: the palm's centre at `position`, and with
 * `rotation` applied to a hand held out straight ahead as for a handshake: fingers along -Z, thumb up (+Y), and the
 * palm facing the other hand (-X for the right hand, +X for the left). A vertical handle held in a fist runs along
 * +Y; a pistol grip is that, tilted.
 */
type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const vec3 = (v: unknown): [number, number, number] | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? [v[0], v[1], v[2]]
    : undefined;

export interface HoldGrip {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface HoldSpec {
  /**
   * "aim": held out in front and pointed where you look (guns, torches you point). "hand": carried in the hand as you
   * walk, swinging with your arm (a lantern, a bag).
   */
  pose: "aim" | "hand";
  /** The hand on `grip`; the other hand takes `offhand`, if there is one. */
  hand: "right" | "left";
  grip: HoldGrip;
  offhand?: HoldGrip;
  /** Degrees the fingers curl round what they hold (the thumb half as much). */
  curl: number;
  /** What points where you look in the "aim" pose: a point and direction in the Thing's space. */
  aim: { position: [number, number, number]; direction: [number, number, number] };
}

function readGrip(v: unknown): HoldGrip | undefined {
  if (!isRecord(v)) return undefined;
  const position = vec3(v.position);
  if (!position) return undefined;
  const r = v.rotation;
  let rotation: [number, number, number, number] = [0, 0, 0, 1];
  if (Array.isArray(r) && r.length === 4 && r.every((x) => typeof x === "number" && Number.isFinite(x))) {
    const length = Math.hypot(r[0], r[1], r[2], r[3]);
    if (length > 1e-6) rotation = [r[0] / length, r[1] / length, r[2] / length, r[3] / length];
  }
  return { position, rotation };
}

/** A Thing file's `HAVEN_thing.hold` (untrusted), or undefined when it doesn't say how it's held. */
export function readHold(gltf: { extensions?: AnyRecord } | undefined): HoldSpec | undefined {
  const thing = gltf?.extensions?.HAVEN_thing;
  const hold = isRecord(thing) ? thing.hold : undefined;
  if (!isRecord(hold)) return undefined;
  const grip = readGrip(hold.grip);
  if (!grip) return undefined;
  const curl = typeof hold.curl === "number" && hold.curl >= 0 && hold.curl <= 120 ? hold.curl : 70;
  // What aims: the file's own aim, else a sprayer's nozzle (HAVEN_sprayer), else straight ahead from the grip.
  const aimRaw = isRecord(hold.aim) ? hold.aim : undefined;
  const sprayer = gltf?.extensions?.HAVEN_sprayer;
  const nozzle = isRecord(sprayer) && isRecord(sprayer.nozzle) ? sprayer.nozzle : undefined;
  const position = vec3(aimRaw?.position) ?? vec3(nozzle?.position) ?? grip.position;
  const raw = vec3(aimRaw?.direction) ?? vec3(nozzle?.direction) ?? [0, 0, -1];
  const length = Math.hypot(...raw);
  const direction: [number, number, number] =
    length > 1e-6 ? [raw[0] / length, raw[1] / length, raw[2] / length] : [0, 0, -1];
  return {
    pose: hold.pose === "hand" ? "hand" : "aim",
    hand: hold.hand === "left" ? "left" : "right",
    grip,
    offhand: readGrip(hold.offhand),
    curl,
    aim: { position, direction },
  };
}
