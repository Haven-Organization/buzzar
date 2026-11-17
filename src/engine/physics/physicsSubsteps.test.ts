import { describe, expect, it } from "vitest";

import { MAX_PHYSICS_STEP, MAX_PHYSICS_SUBSTEPS, physicsSubsteps } from "./physics.game";

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
