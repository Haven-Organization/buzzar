import { describe, expect, it } from "vitest";

import { bounceSpeed, DEFAULT_TRAMPOLINE, trampolineSettings } from "./trampolines";

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
});
