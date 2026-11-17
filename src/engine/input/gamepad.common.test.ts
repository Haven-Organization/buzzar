import { describe, expect, it } from "vitest";

import { applyDeadzone, lookCurve } from "./gamepad.common";

describe("gamepad sticks", () => {
  it("ignores small drift and reaches full tilt at the edge", () => {
    expect(applyDeadzone(0.1, 0.05)).toEqual([0, 0]);
    const [x, y] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1);
    expect(y).toBe(0);
  });

  it("starts smoothly just past the dead zone and keeps the direction", () => {
    const [x, y] = applyDeadzone(0.3, 0.3);
    expect(Math.hypot(x, y)).toBeGreaterThan(0);
    expect(Math.hypot(x, y)).toBeLessThan(0.4);
    expect(x).toBeCloseTo(y);
  });

  it("look curve keeps the sign and squares the size", () => {
    expect(lookCurve(0.5)).toBeCloseTo(0.25);
    expect(lookCurve(-0.5)).toBeCloseTo(-0.25);
  });
});
