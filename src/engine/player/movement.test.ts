import { describe, expect, it } from "vitest";

import {
  allowedSpeed,
  DEFAULT_MOVEMENT,
  effectiveSpeeds,
  parseMovementPrefs,
  parseMovementRules,
  serializeMovementRules,
} from "./movement.common";

describe("movement rules", () => {
  it("defaults when a world says nothing, and round-trips through the rules event", () => {
    expect(parseMovementRules(undefined)).toEqual(DEFAULT_MOVEMENT);
    const rules = { walkSpeed: 3, runSpeed: 7.5, maxSpeed: 12, jump: 0, fly: false, flySpeed: 15, flyBoost: 1.5 };
    const content = { movement: serializeMovementRules(rules) };
    expect(Object.values(content.movement).every((v) => typeof v === "boolean" || Number.isInteger(v))).toBe(true);
    expect(parseMovementRules(content)).toEqual(rules);
  });

  it("keeps walk ≤ run ≤ top speed and ignores nonsense", () => {
    const rules = parseMovementRules({ movement: { walk_cm_s: 500, run_cm_s: 100, max_cm_s: -5, jump_percent: "x" } });
    expect(rules.walkSpeed).toBe(5);
    expect(rules.runSpeed).toBe(5);
    expect(rules.maxSpeed).toBe(10);
    expect(rules.jump).toBe(1);
  });

  it("a walk-only world: no running, jumping or flying", () => {
    const rules = parseMovementRules({
      movement: { walk_cm_s: 200, run_cm_s: 200, max_cm_s: 200, jump_percent: 0, fly: false },
    });
    expect(rules).toMatchObject({ walkSpeed: 2, runSpeed: 2, maxSpeed: 2, jump: 0, fly: false });
    expect(allowedSpeed(rules)).toBe(2);
  });
});

describe("players' own speeds", () => {
  it("apply their choices but never past the world's top speed", () => {
    const prefs = parseMovementPrefs({ walk: 2, run: 3, controller: 0.5 });
    expect(effectiveSpeeds(DEFAULT_MOVEMENT, prefs)).toEqual({ walk: 4, run: 10, controller: 2.5 });
    const strict = { ...DEFAULT_MOVEMENT, maxSpeed: 5 };
    expect(effectiveSpeeds(strict, prefs).run).toBe(5);
    expect(effectiveSpeeds(strict, prefs, true).run).toBe(15);
  });

  it("clamp silly choices", () => {
    expect(parseMovementPrefs({ walk: 100, run: -1, controller: "fast" })).toEqual({
      walk: 3,
      run: 0.5,
      controller: 1,
    });
  });
});

describe("what other clients allow", () => {
  it("includes flying speed only where flying is allowed", () => {
    expect(allowedSpeed(DEFAULT_MOVEMENT)).toBe(20);
    expect(allowedSpeed({ ...DEFAULT_MOVEMENT, fly: false })).toBe(10);
  });
});
