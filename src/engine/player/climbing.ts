/**
 * Buzzar: climbable ladders (Third Room #367).
 *
 * A world marks a ladder with the HAVEN_climbable glTF extension (a box in the node's space; climbed from its front
 * and back, only its front, or any side), and nodes named like "ladder" with a mesh are picked up automatically, using the mesh's bounds. Near one, walking forward while facing it
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
  /** Which sides it's climbed from (HAVEN_climbable `sides`). */
  sides: ClimbSides;
  /** The "Climb Down" box on top (plugins/ladders), once made. */
  top?: RemoteNode;
}

const climbables: Climbable[] = [];

/** Which sides a climbable is climbed from: its front (the node's +Z side), front and back, or any side. */
export type ClimbSides = "front" | "front-back" | "all";

export function addClimbable(
  node: RemoteNode,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  sides: ClimbSides = "front-back"
) {
  climbables.push({
    node,
    min: vec3.fromValues(min[0], min[1], min[2]),
    max: vec3.fromValues(max[0], max[1], max[2]),
    sides: sides === "front" || sides === "all" ? sides : "front-back",
  });
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
  /** Which sides it's climbed from (default front and back; see canGrab). */
  sides?: ClimbSides;
  /** Which way its front faces along its thinnest horizontal axis (+1 or -1), for `sides: "front"`. */
  front?: number;
}

const _min = vec3.create();
const _max = vec3.create();

/** The ladder the character standing at `feet` can reach, if any. Forgets ladders from worlds that were unloaded. */
export function findLadder(ctx: GameContext, feet: ArrayLike<number>): LadderHit | undefined {
  for (let i = climbables.length - 1; i >= 0; i--) {
    const { node, min, max, sides } = climbables[i];
    if (getRemoteResource(ctx, node.eid) !== node) {
      climbables.splice(i, 1);
      continue;
    }
    worldBox(node.worldMatrix, min, max, _min, _max);
    if (reaches(feet, _min, _max)) {
      return { min: vec3.clone(_min), max: vec3.clone(_max), sides, front: frontSign(node.worldMatrix, _min, _max) };
    }
  }
  return undefined;
}

/** Its faces look along world X (0) or Z (2): whichever way the box is thinnest. */
export function faceAxis(min: ArrayLike<number>, max: ArrayLike<number>): 0 | 2 {
  return max[0] - min[0] < max[2] - min[2] ? 0 : 2;
}

/** Which way along its face axis a climbable's front (its node's +Z) points: +1 or -1. */
export function frontSign(worldMatrix: mat4, min: ArrayLike<number>, max: ArrayLike<number>) {
  // The node's +Z axis in the world is the matrix's third column.
  return (faceAxis(min, max) === 0 ? worldMatrix[8] : worldMatrix[10]) < 0 ? -1 : 1;
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

/** How far past a ladder's side edges (metres) you can still be "in front of" it. */
const FACE_MARGIN = 0.1;
/** Facing within about 50° of straight at a ladder's face. */
const FACE_FACING = 0.64;

/**
 * Whether a character at `feet` facing `forward` can take hold of the ladder. A ladder is climbed from its broad
 * faces (front and back, or only its front): you have to be in front of one, not off to the side of it, and facing
 * it. A climbable for all sides (a pole, a crate) only needs facing.
 */
export function canGrab(feet: ArrayLike<number>, ladder: LadderHit, forward: [number, number]) {
  if (ladder.sides === "all") return facesLadder(feet, ladder, forward);
  // Thin along X: its faces look along ±X, and its width runs along Z (and the other way round).
  const thin = faceAxis(ladder.min, ladder.max);
  const wide = thin === 0 ? 2 : 0;
  if (feet[wide] < ladder.min[wide] - FACE_MARGIN || feet[wide] > ladder.max[wide] + FACE_MARGIN) return false;
  const centre = (ladder.min[thin] + ladder.max[thin]) / 2;
  // The way into the face from where you stand.
  const into = feet[thin] < centre ? 1 : -1;
  // Only from the front: standing on the side its front looks out to.
  if (ladder.sides === "front" && into === (ladder.front ?? 1)) return false;
  const facing = thin === 0 ? forward[0] : forward[1];
  return facing * into > FACE_FACING;
}

/**
 * What to do this frame near a ladder. `forward` is the horizontal unit direction the character faces; `moveY` is
 * the forward/back input (+1 forward); `wasClimbing` whether they were on the ladder last frame.
 *
 * You only grab a ladder by walking into one of its faces while facing it (see canGrab). Being near one while off the ground (jumping beside it,
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
  if (!wasClimbing && !(moveY > 0.1 && canGrab(feet, ladder, forward))) return { type: "none" };
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
