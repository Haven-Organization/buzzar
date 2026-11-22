import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { DYNAMIC_ANGULAR_DAMPING } from "./physics.game";

describe("dynamic bodies' rotational damping (Third Room #298)", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it("lets a free spin die down instead of going on forever", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const spin = (damping: number) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setAngvel({ x: 0, y: 10, z: 0 }).setAngularDamping(damping)
      );
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
      return body;
    };
    const damped = spin(DYNAMIC_ANGULAR_DAMPING);
    const undamped = spin(0);
    for (let i = 0; i < 60 * 20; i++) world.step(); // 20 s
    expect(undamped.angvel().y).toBeCloseTo(10, 1);
    expect(Math.abs(damped.angvel().y)).toBeLessThan(0.5);
  });
});
