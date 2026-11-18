import { mat4, vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";

import { CLIMB_SPEED, decideClimb, reaches, worldBox } from "./climbing";

// A ladder 0.5 m wide, 3 m tall, 0.1 m deep, standing on the ground at the origin.
const ladder = { min: vec3.fromValues(-0.25, 0, -0.05), max: vec3.fromValues(0.25, 3, 0.05) };
// The player stands 0.3 m in front of it (+z), facing it (-z).
const feet = [0, 0, 0.35];
const facing: [number, number] = [0, -1];
// Partway up the ladder.
const onLadder = [0, 1, 0.35];
const away: [number, number] = [0, 1];

describe("ladder reach", () => {
  it("reaches from just in front, not from across the room or once above the top", () => {
    expect(reaches(feet, ladder.min, ladder.max)).toBe(true);
    expect(reaches([0, 0, 2], ladder.min, ladder.max)).toBe(false);
    expect(reaches([0, 3.05, 0.35], ladder.min, ladder.max)).toBe(false);
  });

  it("transforms the local box into the world", () => {
    const m = mat4.fromTranslation(mat4.create(), [10, 2, 0]);
    mat4.rotateY(m, m, Math.PI / 2);
    const min = vec3.create();
    const max = vec3.create();
    worldBox(m, ladder.min, ladder.max, min, max);
    expect([...min].map((v) => +v.toFixed(3))).toEqual([9.95, 2, -0.25]);
    expect([...max].map((v) => +v.toFixed(3))).toEqual([10.05, 5, 0.25]);
  });
});

describe("climbing decisions", () => {
  it("walking forward into the ladder climbs; facing away doesn't", () => {
    expect(decideClimb(feet, ladder, facing, 1, true, false)).toEqual({ type: "climb", vertical: CLIMB_SPEED });
    expect(decideClimb(feet, ladder, away, 1, true, false)).toEqual({ type: "none" });
  });

  it("on the ladder: back climbs down, no input holds on, jump lets go away from it", () => {
    expect(decideClimb(onLadder, ladder, facing, -1, false, false, true)).toEqual({
      type: "climb",
      vertical: -CLIMB_SPEED,
    });
    expect(decideClimb(onLadder, ladder, facing, 0, false, false, true)).toEqual({ type: "climb", vertical: 0 });
    const release = decideClimb(onLadder, ladder, facing, 0, false, true, true);
    expect(release.type).toBe("release");
    if (release.type === "release") expect(release.away[1]).toBeCloseTo(1);
  });

  it("standing at the foot of it without pressing forward is just standing", () => {
    expect(decideClimb(feet, ladder, facing, 0, true, false)).toEqual({ type: "none" });
    expect(decideClimb(feet, ladder, facing, -1, true, false)).toEqual({ type: "none" });
  });

  it("being near it in the air doesn't grab it: a jump beside it isn't stopped", () => {
    // Mid-jump next to the ladder, no forward input (or facing elsewhere): not holding on.
    expect(decideClimb([0, 1, 0.35], ladder, facing, 0, false, false)).toEqual({ type: "none" });
    expect(decideClimb([0, 1, 0.35], ladder, away, 1, false, false)).toEqual({ type: "none" });
  });

  it("stepping off the top past the ladder, facing away from it, doesn't hang you in the air", () => {
    // Walked off the platform behind the ladder (the platform is on its -z side) and out over the room side.
    expect(decideClimb([0, 2.9, 0.2], ladder, [0, 1], 1, false, false)).toEqual({ type: "none" });
  });

  it("once climbing, you keep hold even when turning to look around", () => {
    expect(decideClimb(onLadder, ladder, away, 0, false, false, true)).toEqual({ type: "climb", vertical: 0 });
  });

  it("letting go of forward at the foot of the ladder stands you there: a jump is an ordinary jump", () => {
    // Climbing had started (walked into it holding forward), but the feet never left the ground.
    expect(decideClimb(feet, ladder, facing, 0, false, false, true)).toEqual({ type: "none" });
    expect(decideClimb(feet, ladder, facing, 0, false, true, true)).toEqual({ type: "none" });
  });
});
