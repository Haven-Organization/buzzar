import { describe, expect, it } from "vitest";

import { CLIMB_REACH } from "../../engine/player/climbing";
import { climbDownPlacement } from "./ladders.game";

// The test room's ladder: 0.6 wide (X), 8 tall, 0.1 deep (Z), its face toward -Z; the platform it leads to is on +Z.
const min = [-3.8, 0, 7.9];
const max = [-3.2, 8, 8.0];

describe("climbDownPlacement", () => {
  it("hangs you on the far side from where you stood, just below the top, facing the ladder", () => {
    const { position, yaw } = climbDownPlacement(min, max, [-3.5, 8, 9]); // standing on the platform
    expect(position[0]).toBeCloseTo(-3.5);
    expect(position[1]).toBeCloseTo(7);
    // Room side: clear of the ladder's collider (a player's capsule is ~0.37 m), but within reach to hold on.
    expect(7.9 - position[2]).toBeGreaterThan(0.37);
    expect(7.9 - position[2]).toBeLessThan(CLIMB_REACH);
    // Facing +Z (towards the ladder): forward = (-sin yaw, -cos yaw).
    expect(-Math.sin(yaw)).toBeCloseTo(0);
    expect(-Math.cos(yaw)).toBeCloseTo(1);
  });

  it("works for ladders whose faces look along X", () => {
    const { position, yaw } = climbDownPlacement([0, 0, -0.3], [0.1, 3, 0.3], [-1, 3, 0]);
    expect(position[0] - 0.1).toBeGreaterThan(0.37);
    expect(position[0] - 0.1).toBeLessThan(CLIMB_REACH);
    expect(-Math.sin(yaw)).toBeCloseTo(-1); // facing -X, back toward the ladder
  });

  it("a front-only ladder always hangs you on its front, wherever you stood", () => {
    // Front toward -Z (the room): standing on the room side still puts you there, not behind it.
    const { position } = climbDownPlacement(min, max, [-3.5, 8, 7.5], -1);
    expect(position[2]).toBeLessThan(7.9);
    expect(climbDownPlacement(min, max, [-3.5, 8, 7.5], 1).position[2]).toBeGreaterThan(8.0);
  });
});
