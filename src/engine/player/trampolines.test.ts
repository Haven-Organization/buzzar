import { describe, expect, it } from "vitest";

import {
  bounceSpeed,
  DEFAULT_TRAMPOLINE,
  objectBounceSpeed,
  objectBounceVelocity,
  trampolineSettings,
} from "./trampolines";

const g = 14.7;
const heightOf = (speed: number) => (speed * speed) / (2 * g);
const fallSpeed = (height: number) => Math.sqrt(2 * g * height);

describe("trampoline bounces", () => {
  it("bounces gentle landings (walking on) to the minimum height, 2.5 m", () => {
    expect(heightOf(bounceSpeed(DEFAULT_TRAMPOLINE, 0, g, false))).toBeCloseTo(2.5);
    expect(heightOf(bounceSpeed(DEFAULT_TRAMPOLINE, fallSpeed(1), g, false))).toBeCloseTo(2.5);
  });

  it("sends drops from higher up proportionally higher, up to the cap", () => {
    expect(heightOf(bounceSpeed(DEFAULT_TRAMPOLINE, fallSpeed(10), g, false))).toBeCloseTo(8.5);
    expect(heightOf(bounceSpeed(DEFAULT_TRAMPOLINE, fallSpeed(100), g, false))).toBeCloseTo(30);
  });

  it("adds the jump boost when landing holding jump", () => {
    expect(heightOf(bounceSpeed(DEFAULT_TRAMPOLINE, fallSpeed(6), g, true))).toBeCloseTo(0.85 * 6 + 1.5);
  });

  it("reads settings from glTF, clamping nonsense", () => {
    expect(trampolineSettings({ minBounceHeight: 3, bounciness: 99, jumpBoost: -1 })).toEqual({
      minBounceHeight: 3,
      bounciness: 1.2,
      maxBounceHeight: 30,
      jumpBoost: 0,
    });
  });

  it("bounces dropped objects lower each time until they settle", () => {
    const g9 = 9.81;
    const h = (v: number) => (v * v) / (2 * g9);
    const drop = (height: number) => Math.sqrt(2 * g9 * height);
    expect(h(objectBounceSpeed(DEFAULT_TRAMPOLINE, drop(2), g9))).toBeCloseTo(1.7);
    // No minimum for objects, and a near-rest landing doesn't bounce at all.
    expect(objectBounceSpeed(DEFAULT_TRAMPOLINE, drop(0.1), g9)).toBe(0);
  });

  it("bounces an object tossed in at an angle on and away at much the same angle", () => {
    const g9 = 9.81;
    const down = Math.sqrt(2 * g9 * 2); // as if dropped from 2 m
    const out = objectBounceVelocity(DEFAULT_TRAMPOLINE, [3, -down, -1], [0, 1, 0], g9);
    expect(out).toBeDefined();
    const [x, y, z] = out!;
    // Across the mat it keeps going the same way (a little slower); up it gets objectBounceSpeed.
    expect(x).toBeCloseTo(2.7);
    expect(z).toBeCloseTo(-0.9);
    expect(y).toBeCloseTo(objectBounceSpeed(DEFAULT_TRAMPOLINE, down, g9));
  });

  it("bounces off a tilted mat along its normal", () => {
    const n = [Math.SQRT1_2, Math.SQRT1_2, 0];
    // Falling straight down onto a mat tilted 45°: comes off heading out along +X.
    const out = objectBounceVelocity(DEFAULT_TRAMPOLINE, [0, -8, 0], n, 9.81)!;
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0] * n[0] + out[1] * n[1]).toBeGreaterThan(0);
  });

  it("doesn't bounce objects moving away from the mat or barely touching it", () => {
    expect(objectBounceVelocity(DEFAULT_TRAMPOLINE, [2, 3, 0], [0, 1, 0], 9.81)).toBeUndefined();
    expect(objectBounceVelocity(DEFAULT_TRAMPOLINE, [2, -0.5, 0], [0, 1, 0], 9.81)).toBeUndefined();
  });
});
