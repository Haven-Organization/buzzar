/**
 * Buzzar: trampolines (the stock Trampoline Thing, or any node a world marks with HAVEN_trampoline).
 *
 * Land on one and it throws you back up: at least `minBounceHeight` (so just walking or hopping on gets you bouncing
 * straight away), or `bounciness` × the height you fell from, so dropping on from high up sends you proportionally
 * high. Holding jump as you land adds `jumpBoost` to the bounce, so you can work your way up; crouch to stop.
 *
 * A trampoline is an area in its node's XZ plane, centred on the node and facing +Y: a rectangle, or the ellipse
 * inside it for round ones.
 */
import { mat4, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";

/** HAVEN_trampoline, as written in glTF (docs/gltf/HAVEN_trampoline). */
export interface GLTFTrampolineExtension {
  /** Width (X) and depth (Z) in metres of the bouncy area. Default: the node's mesh bounds. */
  size?: [number, number];
  /** "rectangle" (default) or "round" (the ellipse inside the rectangle). */
  shape?: "rectangle" | "round";
  /** Lowest bounce, in metres, however gently you land (default 2.5). */
  minBounceHeight?: number;
  /** How high you bounce back as a fraction of the height you fell (default 0.85; 1 keeps every bounce). */
  bounciness?: number;
  /** Highest bounce in metres (default 30). */
  maxBounceHeight?: number;
  /** Extra metres for each bounce you land holding jump (default 1.5). */
  jumpBoost?: number;
}

export interface TrampolineSettings {
  minBounceHeight: number;
  bounciness: number;
  maxBounceHeight: number;
  jumpBoost: number;
}

export const DEFAULT_TRAMPOLINE: TrampolineSettings = {
  minBounceHeight: 2.5,
  bounciness: 0.85,
  maxBounceHeight: 30,
  jumpBoost: 1.5,
};

export interface Trampoline extends TrampolineSettings {
  node: RemoteNode;
  /** Half the area's width and depth, in the node's space. */
  halfX: number;
  halfZ: number;
  round: boolean;
}

const trampolines: Trampoline[] = [];

const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Reads (untrusted) HAVEN_trampoline settings, falling back to the defaults. */
export function trampolineSettings(ext: GLTFTrampolineExtension = {}): TrampolineSettings {
  return {
    minBounceHeight: num(ext.minBounceHeight, DEFAULT_TRAMPOLINE.minBounceHeight, 0, 50),
    bounciness: num(ext.bounciness, DEFAULT_TRAMPOLINE.bounciness, 0, 1.2),
    maxBounceHeight: num(ext.maxBounceHeight, DEFAULT_TRAMPOLINE.maxBounceHeight, 0.1, 200),
    jumpBoost: num(ext.jumpBoost, DEFAULT_TRAMPOLINE.jumpBoost, 0, 20),
  };
}

/** Marks `node` as a trampoline `width` × `depth` metres (in its own space). */
export function addTrampoline(node: RemoteNode, width: number, depth: number, ext: GLTFTrampolineExtension = {}) {
  if (!(width > 0) || !(depth > 0)) return;
  trampolines.push({
    node,
    halfX: width / 2,
    halfZ: depth / 2,
    round: ext.shape === "round",
    ...trampolineSettings(ext),
  });
}

/** Trampolines in loaded worlds (forgets ones whose node is gone). */
export function liveTrampolines(ctx: GameContext): readonly Trampoline[] {
  for (let i = trampolines.length - 1; i >= 0; i--) {
    if (getRemoteResource(ctx, trampolines[i].node.eid) !== trampolines[i].node) trampolines.splice(i, 1);
  }
  return trampolines;
}

/** Feet this far below the bouncy surface (it may sit a little under a frame or pad) up to this far above count. */
const BELOW = 0.25;
const ABOVE = 0.3;

const _inverse = mat4.create();
const _local = vec3.create();
const _surface = vec3.create();

/** Whether feet at `feet` (world space) are on the trampoline's bouncy area. */
export function isOnTrampoline(trampoline: Trampoline, feet: ArrayLike<number>) {
  const world = trampoline.node.worldMatrix;
  if (!mat4.invert(_inverse, world)) return false;
  vec3.transformMat4(_local, vec3.set(_local, feet[0], feet[1], feet[2]), _inverse);
  const x = _local[0] / trampoline.halfX;
  const z = _local[2] / trampoline.halfZ;
  const inside = trampoline.round ? x * x + z * z <= 1 : Math.abs(x) <= 1 && Math.abs(z) <= 1;
  if (!inside) return false;
  // Height in metres: compare with the surface point straight under the feet, in world space.
  vec3.transformMat4(_surface, vec3.set(_surface, _local[0], 0, _local[2]), world);
  const above = feet[1] - _surface[1];
  return above >= -BELOW && above <= ABOVE;
}

/** The trampoline under feet at `feet`, if any. */
export function findTrampoline(ctx: GameContext, feet: ArrayLike<number>): Trampoline | undefined {
  for (const trampoline of liveTrampolines(ctx)) if (isOnTrampoline(trampoline, feet)) return trampoline;
  return undefined;
}

/**
 * The upward speed (m/s) to bounce off `settings` after landing at `impactSpeed` (m/s, downward, ≥ 0) with
 * gravity `gravity` (m/s², > 0): enough to rise to max(min, bounciness × fall height) (+ the jump boost), capped.
 */
export function bounceSpeed(
  settings: TrampolineSettings,
  impactSpeed: number,
  gravity: number,
  jumpHeld: boolean
): number {
  const fallHeight = (impactSpeed * impactSpeed) / (2 * gravity);
  let height = Math.max(settings.minBounceHeight, settings.bounciness * fallHeight);
  if (jumpHeld) height += settings.jumpBoost;
  height = Math.min(height, settings.maxBounceHeight);
  return Math.sqrt(2 * gravity * height);
}
