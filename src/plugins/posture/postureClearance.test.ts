import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

import { Posture } from "../../engine/player/posture.common";
import { hasRoomFor, PostureCapsule } from "./postureClearance";

// Same as posture.game.ts.
const CAPSULES: Record<Posture, PostureCapsule> = {
  [Posture.Standing]: { halfHeight: 0.575, radius: 0.35, center: [0, 0.85, 0], lying: false },
  [Posture.Crouching]: { halfHeight: 0.25, radius: 0.35, center: [0, 0.525, 0], lying: false },
  [Posture.Prone]: { halfHeight: 0.5, radius: 0.25, center: [0, 0.175, 0.15], lying: true },
};
const solid = (c: RAPIER.Collider) => !c.isSensor();

/** A box as a triangle mesh (worlds' collision is mostly meshes). */
function meshBox(world: RAPIER.World, [x0, y0, z0]: number[], [x1, y1, z1]: number[]) {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [
    (c & 1) ^ ((c >> 1) & 1) ? x1 : x0,
    c & 2 ? y1 : y0,
    c & 4 ? z1 : z0,
  ]);
  const v = new Float32Array(corners.flat());
  const i = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  world.createCollider(RAPIER.ColliderDesc.trimesh(v, i));
}

/** A world with a floor at y=0 and the player standing at the origin (facing -Z), plus `extra` geometry. */
function setup(posture: Posture, extra: (world: RAPIER.World) => void = () => undefined) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  meshBox(world, [-20, -1, -20], [20, 0, 20]);
  extra(world);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
  const shape = CAPSULES[posture];
  const desc = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius).setTranslation(...shape.center);
  if (shape.lying) desc.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });
  const collider = world.createCollider(desc, body);
  world.step();
  return (to: Posture) => hasRoomFor(world, body, collider, CAPSULES, posture, to, solid);
}

beforeAll(async () => {
  await RAPIER.init();
});

describe("room to change posture", () => {
  it("can always crouch, and stand up or lie down in the open", () => {
    expect(setup(Posture.Standing)(Posture.Crouching)).toBe(true);
    expect(setup(Posture.Crouching)(Posture.Standing)).toBe(true);
    expect(setup(Posture.Standing)(Posture.Prone)).toBe(true);
    expect(setup(Posture.Prone)(Posture.Standing)).toBe(true);
  });

  it("can't stand up under a low ceiling, but can crouch there", () => {
    const ceiling = (w: RAPIER.World) => meshBox(w, [-2, 1.4, -2], [2, 1.6, 2]);
    expect(setup(Posture.Crouching, ceiling)(Posture.Standing)).toBe(false);
    expect(setup(Posture.Prone, ceiling)(Posture.Standing)).toBe(false);
    expect(setup(Posture.Prone, ceiling)(Posture.Crouching)).toBe(true);
    const high = (w: RAPIER.World) => meshBox(w, [-2, 2.0, -2], [2, 2.2, 2]);
    expect(setup(Posture.Crouching, high)(Posture.Standing)).toBe(true);
  });

  it("can't get up from under a bed", () => {
    const bed = (w: RAPIER.World) => meshBox(w, [-1, 0.45, -1], [1, 0.6, 1]);
    expect(setup(Posture.Prone, bed)(Posture.Crouching)).toBe(false);
    expect(setup(Posture.Prone, bed)(Posture.Standing)).toBe(false);
  });

  it("can't lie down against a wall, front or back", () => {
    const front = (w: RAPIER.World) => meshBox(w, [-2, 0, -0.6], [2, 2, -0.4]);
    expect(setup(Posture.Standing, front)(Posture.Prone)).toBe(false);
    const behind = (w: RAPIER.World) => meshBox(w, [-2, 0, 0.6], [2, 2, 0.8]);
    expect(setup(Posture.Standing, behind)(Posture.Prone)).toBe(false);
    const far = (w: RAPIER.World) => meshBox(w, [-2, 0, -2], [2, 2, -1.8]);
    expect(setup(Posture.Standing, far)(Posture.Prone)).toBe(true);
  });
});
