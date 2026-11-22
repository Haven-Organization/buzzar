/**
 * Buzzar: Thing variables (Third Room #383, "Crates are way too big"). A clone of a stock Thing ("Smaller Crate")
 * is the stock Thing plus values for some of these. They travel with the object's create message, so everyone sees
 * the same thing, and every client clamps them to the limits here, so nobody can send a 1000× crate. Clients that
 * don't know about them show the stock Thing.
 */

export interface ThingVariables {
  /** Scale: 1 is the stock size. */
  size?: number;
  /** Colour multiplied into the Thing's own (linear RGB, 0–1). White leaves it as it is. */
  tint?: [number, number, number];
  /** Restitution: 0 doesn't bounce, 1 bounces back as high as it fell. */
  bounciness?: number;
  /** Mass in kg. */
  weight?: number;
  /** Emissive strength of a glowing Thing: 1 is the stock glow. */
  glow?: number;
}

export type ThingVariableName = keyof ThingVariables;

/** The limits every client enforces. */
export const THING_VARIABLE_LIMITS = {
  size: { min: 0.25, max: 4 },
  bounciness: { min: 0, max: 1 },
  weight: { min: 0.1, max: 500 },
  glow: { min: 0, max: 10 },
} as const;

type Defaults = { [K in ThingVariableName]?: NonNullable<ThingVariables[K]> };

const CRATE: Defaults = { size: 1, tint: [1, 1, 1], bounciness: 0, weight: 1 };
const BALL: Defaults = { size: 1, tint: [1, 1, 1], bounciness: 1, weight: 1 };

/**
 * Which variables each stock Thing has, and their stock values. (The trampoline's size isn't offered yet: its
 * bouncy area and collider come from its file.)
 */
export const THING_VARIABLE_DEFAULTS: Record<string, Defaults> = {
  "small-crate": CRATE,
  "medium-crate": CRATE,
  "large-crate": CRATE,
  "mirror-ball": BALL,
  // Tint multiplies the colour, which is black here.
  "black-mirror-ball": { size: 1, bounciness: 1, weight: 1 },
  "emissive-ball": { ...BALL, glow: 1 },
  trampoline: { tint: [1, 1, 1], weight: 1 },
};

export function thingVariableNames(thingId: string): ThingVariableName[] {
  return Object.keys(THING_VARIABLE_DEFAULTS[thingId] ?? {}) as ThingVariableName[];
}

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value));
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Validates untrusted values (account data, the network) for a stock Thing: keeps only the variables it has, clamped
 * to the limits, and drops ones equal to the stock value.
 */
export function sanitizeThingVariables(thingId: string, value: unknown): ThingVariables {
  const defaults = THING_VARIABLE_DEFAULTS[thingId];
  const out: ThingVariables = {};
  if (!defaults || typeof value !== "object" || value === null) return out;
  const raw = value as Record<string, unknown>;
  for (const name of ["size", "bounciness", "weight", "glow"] as const) {
    if (defaults[name] === undefined || !isNumber(raw[name])) continue;
    const v = clamp(raw[name] as number, THING_VARIABLE_LIMITS[name]);
    if (Math.abs(v - (defaults[name] as number)) > 1e-4) out[name] = v;
  }
  const tint = raw.tint;
  if (defaults.tint && Array.isArray(tint) && tint.length === 3 && tint.every(isNumber)) {
    const t = tint.map((c) => clamp(c, { min: 0, max: 1 })) as [number, number, number];
    if (t.some((c) => c < 1 - 1e-4)) out.tint = t;
  }
  return out;
}

export function hasThingVariables(variables: ThingVariables | undefined): variables is ThingVariables {
  return !!variables && Object.keys(variables).length > 0;
}

/** A variable's value, or the Thing's stock value. */
export function thingVariable<K extends ThingVariableName>(
  thingId: string,
  variables: ThingVariables | undefined,
  name: K
): NonNullable<ThingVariables[K]> | undefined {
  return (variables?.[name] ?? THING_VARIABLE_DEFAULTS[thingId]?.[name]) as NonNullable<ThingVariables[K]> | undefined;
}

/* On the wire: [version u8 = 1][flags u8][size f32][tint 3×f32][bounciness f32][weight f32][glow f32], each value
 * only if its flag is set. Little-endian. */
const VERSION = 1;
const FLAGS: [ThingVariableName, number][] = [
  ["size", 1],
  ["tint", 2],
  ["bounciness", 4],
  ["weight", 8],
  ["glow", 16],
];

export function encodeThingVariables(variables: ThingVariables): ArrayBuffer {
  let flags = 0;
  let floats = 0;
  for (const [name, bit] of FLAGS) {
    if (variables[name] === undefined) continue;
    flags |= bit;
    floats += name === "tint" ? 3 : 1;
  }
  const buffer = new ArrayBuffer(2 + floats * 4);
  const view = new DataView(buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, flags);
  let offset = 2;
  const put = (v: number) => {
    view.setFloat32(offset, v, true);
    offset += 4;
  };
  if (variables.size !== undefined) put(variables.size);
  if (variables.tint) variables.tint.forEach(put);
  if (variables.bounciness !== undefined) put(variables.bounciness);
  if (variables.weight !== undefined) put(variables.weight);
  if (variables.glow !== undefined) put(variables.glow);
  return buffer;
}

/** Reads (untrusted) bytes from a peer; sanitize the result for the Thing before using it. */
export function decodeThingVariables(buffer: ArrayBuffer | undefined): Record<string, unknown> | undefined {
  if (!buffer || buffer.byteLength < 2) return undefined;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== VERSION) return undefined;
  const flags = view.getUint8(1);
  let offset = 2;
  const take = () => {
    if (offset + 4 > buffer.byteLength) return NaN;
    const v = view.getFloat32(offset, true);
    offset += 4;
    return v;
  };
  const out: Record<string, unknown> = {};
  if (flags & 1) out.size = take();
  if (flags & 2) out.tint = [take(), take(), take()];
  if (flags & 4) out.bounciness = take();
  if (flags & 8) out.weight = take();
  if (flags & 16) out.glow = take();
  return out;
}
