import { describe, expect, it } from "vitest";

import { climbDownPlacement } from "./ladders.game";

// The test room's ladder: 0.6 wide (X), 8 tall, 0.1 deep (Z), its face toward -Z; the platform it leads to is on +Z.
const min = [-3.8, 0, 7.9];
const max = [-3.2, 8, 8.0];

describe("climbDownPlacement", () => {
  it("hangs you on the far side from where you stood, just below the top, facing the ladder", () => {
    const { position, yaw } = climbDownPlacement(min, max, [-3.5, 8, 9]); // standing on the platform
    expect(position[0]).toBeCloseTo(-3.5);
    expect(position[1]).toBeCloseTo(7);
    expect(position[2]).toBeLessThan(7.9 - 0.4); // room side, clear of the ladder
    // Facing +Z (towards the ladder): forward = (-sin yaw, -cos yaw).
    expect(-Math.sin(yaw)).toBeCloseTo(0);
    expect(-Math.cos(yaw)).toBeCloseTo(1);
  });

  it("works for ladders whose faces look along X", () => {
    const { position, yaw } = climbDownPlacement([0, 0, -0.3], [0.1, 3, 0.3], [-1, 3, 0]);
    expect(position[0]).toBeGreaterThan(0.1 + 0.4);
    expect(-Math.sin(yaw)).toBeCloseTo(-1); // facing -X, back toward the ladder
  });
});
