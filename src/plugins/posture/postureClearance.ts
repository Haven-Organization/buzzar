/**
 * Buzzar: whether there's room to change posture (stand up under a table, lie down by a wall), with sweeps instead
 * of an overlap test.
 *
 * Rapier's shape-overlap queries (`intersectionsWithShape`, and `intersectionWithShape` whenever nothing overlaps)
 * cost about a second against big triangle-mesh worlds in the Rapier we use: on a 900k-triangle scan (thirdroom
 * world leon7.6.1) every crouch froze the game for ~1 s. A sweep (`castShape`) of the same world takes ~1 ms.
 *
 * A sweep ignores whatever its shape overlaps where it starts, so each one starts from space the player's own body
 * already fills (or, lying down, just above the floor) and moves into where the new posture would reach:
 * - Standing → crouching: always fits (the crouched capsule is inside the standing one).
 * - Up to crouching or standing: a ball the capsule's width rises from just above the feet to the new head height.
 * - Down to prone: a ball the lying capsule's width rolls forward and back, just above the floor, to its ends.
 */
import RAPIER from "@dimforge/rapier3d-compat";

import { Posture } from "../../engine/player/posture.common";

/** The capsule each posture uses (body space; origin at the feet, forward is -Z). */
export interface PostureCapsule {
  halfHeight: number;
  radius: number;
  center: [number, number, number];
  /** Lying along the body's Z axis instead of upright. */
  lying: boolean;
}

/** A little narrower than the body, so brushing a wall doesn't count. */
const SLACK = 0.02;
/** Sweeps run this far above the feet, so the floor (and small bumps in it) don't block them. */
const FLOOR_GAP = 0.05;

type Vec = { x: number; y: number; z: number };

function rotate(q: { x: number; y: number; z: number; w: number }, v: Vec): Vec {
  // v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Whether a ball of `radius` can move from `from` (body space) by `delta` (body space) without hitting anything. */
function sweepClear(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
  radius: number,
  from: Vec,
  delta: Vec,
  isSolid: (collider: RAPIER.Collider) => boolean
) {
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length < 1e-4) return true;
  const t = body.translation();
  const r = body.rotation();
  const start = rotate(r, from);
  const dir = rotate(r, { x: delta.x / length, y: delta.y / length, z: delta.z / length });
  const hit = world.castShape(
    { x: t.x + start.x, y: t.y + start.y, z: t.z + start.z },
    { x: 0, y: 0, z: 0, w: 1 },
    dir,
    new RAPIER.Ball(radius),
    length,
    false,
    undefined, // not EXCLUDE_SENSORS: in this Rapier build it also drops dynamic bodies (see isSolid)
    collider.collisionGroups(),
    collider,
    body,
    isSolid
  );
  return hit === null;
}

/** Whether the player's body can change from posture `from` to `to` where it is now. */
export function hasRoomFor(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
  capsules: Record<Posture, PostureCapsule>,
  from: Posture,
  to: Posture,
  isSolid: (collider: RAPIER.Collider) => boolean
): boolean {
  if (from === to) return true;
  if (from === Posture.Standing && to === Posture.Crouching) return true;
  const shape = capsules[to];
  const radius = shape.radius - SLACK;
  const low = FLOOR_GAP + radius;
  const [cx, cy, cz] = shape.center;

  if (!shape.lying) {
    const top = cy + shape.halfHeight + shape.radius;
    return sweepClear(
      world,
      body,
      collider,
      radius,
      { x: cx, y: low, z: cz },
      { x: 0, y: top - shape.radius - low, z: 0 },
      isSolid
    );
  }

  // Lying along Z: roll from the body's own column out to each end of the capsule.
  const y = Math.max(low, cy);
  for (const end of [cz + shape.halfHeight, cz - shape.halfHeight]) {
    if (!sweepClear(world, body, collider, radius, { x: cx, y, z: 0 }, { x: 0, y: 0, z: end }, isSolid)) return false;
  }
  return true;
}
