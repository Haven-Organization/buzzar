import { vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";

import { jitterDirection } from "./jitterDirection";

describe("jitterDirection", () => {
  it("keeps the length and stays within the angle", () => {
    const max = (3 * Math.PI) / 180;
    let tilted = 0;
    for (let i = 0; i < 500; i++) {
      const d = jitterDirection(vec3.fromValues(0, 0, -10), max);
      expect(vec3.length(d)).toBeCloseTo(10, 5);
      const angle = vec3.angle(d, vec3.fromValues(0, 0, -1));
      expect(angle).toBeLessThanOrEqual(max + 1e-6);
      if (angle > 1e-4) tilted++;
    }
    expect(tilted).toBeGreaterThan(450);
  });

  it("leaves a zero vector alone", () => {
    expect([...jitterDirection(vec3.create(), 0.1)]).toEqual([0, 0, 0]);
  });
});
