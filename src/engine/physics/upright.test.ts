import { quat, vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";

import { levelRotation, tiltOf } from "./upright";

describe("upright objects", () => {
  it("keeps the heading and drops the tilt", () => {
    const heading = quat.setAxisAngle(quat.create(), [0, 1, 0], 0.7);
    const tilted = quat.multiply(quat.create(), heading, quat.setAxisAngle(quat.create(), [1, 0, 0], 0.9));
    expect(tiltOf(tilted)).toBeCloseTo(0.9);
    const level = levelRotation(quat.create(), tilted);
    expect(tiltOf(level)).toBeCloseTo(0);
    const forward = vec3.transformQuat(vec3.create(), [0, 0, -1], level);
    const expected = vec3.transformQuat(vec3.create(), [0, 0, -1], heading);
    expect(forward[0]).toBeCloseTo(expected[0]);
    expect(forward[2]).toBeCloseTo(expected[2]);
  });
});
