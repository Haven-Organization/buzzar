/**
 * Buzzar: climbable ladders (Third Room #367).
 *
 * A world marks a ladder with the HAVEN_climbable glTF extension (a box in the node's space), and nodes named like
 * "ladder" with a mesh are picked up automatically, using the mesh's bounds. Near one, walking forward while facing it
 * climbs, backing off climbs down, and gravity is off while you're on it, so you can hang there. Jump lets go.
 */
import { mat4, vec3 } from "gl-matrix";

import { GameContext } from "../GameTypes";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";

/** Metres per second up or down a ladder. */
export const CLIMB_SPEED = 2;
/** Metres per second sideways while on a ladder. */
export const CLIMB_SIDE_SPEED = 1;
/** How far outside the ladder's box (horizontally) you can still grab it, in metres. */
export const CLIMB_REACH = 0.5;
/** The character's height for overlap tests, in metres (feet to head). */
const BODY_HEIGHT = 1.7;
/** Feet within this height of a ladder's bottom (metres) are standing at its foot, not hanging on it. */
export const LADDER_BOTTOM = 0.15;
/** After jumping off, the ladder can't be grabbed again for this long (seconds). */
export const CLIMB_REGRAB_DELAY = 0.4;

export interface Climbable {
  node: RemoteNode;
  /** Box in the node's local space. */
  min: vec3;
  max: vec3;
  /** The "Climb Down" box on top (plugins/ladders), once made. */
  top?: RemoteNode;
}

const climbables: Climbable[] = [];

export function addClimbable(node: RemoteNode, min: ArrayLike<number>, max: ArrayLike<number>) {
  climbables.push({ node, min: vec3.fromValues(min[0], min[1], min[2]), max: vec3.fromValues(max[0], max[1], max[2]) });
}

/** Ladders in loaded worlds (forgets ones whose world was unloaded). */
export function liveClimbables(ctx: GameContext): readonly Climbable[] {
  for (let i = climbables.length - 1; i >= 0; i--) {
    if (getRemoteResource(ctx, climbables[i].node.eid) !== climbables[i].node) climbables.splice(i, 1);
  }
  return climbables;
}

/**
 * Buzzar: the rig "Climb Down" (plugins/ladders) just put on a ladder; the character controller
 * reads it so the player starts out holding on rather than falling.
 */
export const ladderGrab: { eid?: number } = {};

/** The world-space box of a climbable (the eight local corners transformed, then bounded). */
export function worldBox(worldMatrix: mat4, min: vec3, max: vec3, outMin: vec3, outMax: vec3) {
  vec3.set(outMin, Infinity, Infinity, Infinity);
  vec3.set(outMax, -Infinity, -Infinity, -Infinity);
  const corner = vec3.create();
  for (let i = 0; i < 8; i++) {
    vec3.set(corner, i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
    vec3.transformMat4(corner, corner, worldMatrix);
    vec3.min(outMin, outMin, corner);
    vec3.max(outMax, outMax, corner);
  }
}

export interface LadderHit {
  min: vec3;
  max: vec3;
}

const _min = vec3.create();
const _max = vec3.create();

/** The ladder the character standing at `feet` can reach, if any. Forgets ladders from worlds that were unloaded. */
export function findLadder(ctx: GameContext, feet: ArrayLike<number>): LadderHit | undefined {
  for (let i = climbables.length - 1; i >= 0; i--) {
    const { node, min, max } = climbables[i];
    if (getRemoteResource(ctx, node.eid) !== node) {
      climbables.splice(i, 1);
      continue;
    }
    worldBox(node.worldMatrix, min, max, _min, _max);
    if (reaches(feet, _min, _max)) return { min: vec3.clone(_min), max: vec3.clone(_max) };
  }
  return undefined;
}

/** Whether a character at `feet` overlaps the box grown by CLIMB_REACH sideways. */
export function reaches(feet: ArrayLike<number>, min: vec3, max: vec3) {
  return (
    feet[0] >= min[0] - CLIMB_REACH &&
    feet[0] <= max[0] + CLIMB_REACH &&
    feet[2] >= min[2] - CLIMB_REACH &&
    feet[2] <= max[2] + CLIMB_REACH &&
    // Feet below the top (once they're above it you've climbed off), head above the bottom.
    feet[1] < max[1] &&
    feet[1] + BODY_HEIGHT > min[1]
  );
}

export type ClimbAction =
  | { type: "none" }
  | { type: "climb"; vertical: number }
  /** Let go: jump away from the ladder. `away` is a unit horizontal direction. */
  | { type: "release"; away: [number, number] };

/** Whether a character at `feet` facing `forward` (horizontal unit vector) faces the ladder: within about 70°. */
export function facesLadder(feet: ArrayLike<number>, ladder: LadderHit, forward: [number, number]) {
  const dx = (ladder.min[0] + ladder.max[0]) / 2 - feet[0];
  const dz = (ladder.min[2] + ladder.max[2]) / 2 - feet[2];
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-4) return true;
  return (dx * forward[0] + dz * forward[1]) / distance > 0.35;
}

/**
 * What to do this frame near a ladder. `forward` is the horizontal unit direction the character faces; `moveY` is
 * the forward/back input (+1 forward); `wasClimbing` whether they were on the ladder last frame.
 *
 * You only grab a ladder by walking into it while facing it. Being near one while off the ground (jumping beside it,
 * stepping off the platform at its top facing away) doesn't grab it, so it never stops a jump or holds you in the air
 * with your back to it. Once on it, you hold on until you climb off the top or bottom or jump off.
 */
export function decideClimb(
  feet: ArrayLike<number>,
  ladder: LadderHit,
  forward: [number, number],
  moveY: number,
  grounded: boolean,
  jumpPressed: boolean,
  wasClimbing = false
): ClimbAction {
  const facing = facesLadder(feet, ladder, forward);
  if (!wasClimbing && !(facing && moveY > 0.1)) return { type: "none" };
  // At the foot of the ladder you're standing on the ground, not hanging (the ground check can miss it while climbing).
  const atBottom = feet[1] <= ladder.min[1] + LADDER_BOTTOM;
  if (atBottom && moveY <= 0.1) return { type: "none" };

  if (!grounded && jumpPressed) {
    let dx = (ladder.min[0] + ladder.max[0]) / 2 - feet[0];
    let dz = (ladder.min[2] + ladder.max[2]) / 2 - feet[2];
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-4) {
      dx /= distance;
      dz /= distance;
    } else {
      [dx, dz] = forward;
    }
    return { type: "release", away: [-dx, -dz] };
  }
  if (moveY > 0.1 && facing) return { type: "climb", vertical: CLIMB_SPEED };
  if (!grounded && moveY < -0.1) return { type: "climb", vertical: -CLIMB_SPEED };
  // On the ladder without pressing up or down: hold on.
  if (!grounded) return { type: "climb", vertical: 0 };
  return { type: "none" };
}
