import { describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

import {
  kinematicFrameVelocity,
  markTeleported,
  MAX_PHYSICS_STEP,
  MAX_PHYSICS_SUBSTEPS,
  physicsSubsteps,
} from "./physics.game";

describe("physicsSubsteps", () => {
  it("steps once at 60 fps and splits slower frames", () => {
    expect(physicsSubsteps(1 / 60)).toEqual({ steps: 1, timestep: 1 / 60 });
    expect(physicsSubsteps(1 / 144)).toEqual({ steps: 1, timestep: 1 / 144 });
    const at30 = physicsSubsteps(1 / 30);
    expect(at30.steps).toBe(2);
    expect(at30.timestep).toBeCloseTo(1 / 60);
  });

  it("never takes a step longer than the cap, even after a long stall", () => {
    const stall = physicsSubsteps(1.5);
    expect(stall.steps).toBe(MAX_PHYSICS_SUBSTEPS);
    expect(stall.timestep).toBe(MAX_PHYSICS_STEP);
  });

  it("does nothing for a zero or bad dt", () => {
    expect(physicsSubsteps(0).steps).toBe(0);
    expect(physicsSubsteps(NaN).steps).toBe(0);
  });
});

describe("kinematicFrameVelocity", () => {
  const fakeBody = () => {
    const position = { x: 0, y: 0, z: 0 };
    return { position, body: { translation: () => ({ ...position }) } as unknown as RAPIER.RigidBody };
  };

  it("is the movement over the whole frame, however many physics steps it took", () => {
    const { position, body } = fakeBody();
    const v = [9, 9, 9];
    kinematicFrameVelocity(body, 1 / 30, v);
    // First frame: nothing to compare with, Rapier's value is kept.
    expect(v).toEqual([9, 9, 9]);
    position.y = 0.2; // rising 6 m/s over a 1/30 s frame (two substeps; Rapier would say 0 after the second)
    kinematicFrameVelocity(body, 1 / 30, v);
    expect(v[1]).toBeCloseTo(6);
    expect(v[0]).toBe(0);
  });

  it("reads a teleport as standing still, not as speed", () => {
    const { position, body } = fakeBody();
    const v = [0, 0, 0];
    kinematicFrameVelocity(body, 1 / 60, v);
    position.x = 30;
    v[0] = 1800; // Rapier's own value: the teleport's speed
    kinematicFrameVelocity(body, 1 / 60, v);
    expect(v).toEqual([0, 0, 0]);
  });

  it("reads a short marked teleport (standing up from a seat) as standing still", () => {
    const { position, body } = fakeBody();
    const v = [0, 0, 0];
    kinematicFrameVelocity(body, 1 / 60, v);
    position.y = 0.6; // 36 m/s upwards: under the teleport speed, so it used to throw you into the air
    markTeleported(body);
    kinematicFrameVelocity(body, 1 / 60, v);
    expect(v).toEqual([0, 0, 0]);
    position.y = 0.65; // the next frame is ordinary movement again
    kinematicFrameVelocity(body, 1 / 60, v);
    expect(v[1]).toBeCloseTo(3);
  });
});
