import { describe, expect, it } from "vitest";

import { nextResolutionScale } from "./DynamicResolutionSystem";

describe("dynamic resolution (Third Room #211)", () => {
  const refresh = 1 / 60;

  it("drops after two slow seconds, down to half", () => {
    const c = { slow: 0, smooth: 0 };
    let scale = 1;
    scale = nextResolutionScale(scale, 1 / 30, refresh, c);
    expect(scale).toBe(1);
    scale = nextResolutionScale(scale, 1 / 30, refresh, c);
    expect(scale).toBe(0.9);
    for (let i = 0; i < 40; i++) scale = nextResolutionScale(scale, 1 / 20, refresh, c);
    expect(scale).toBe(0.5);
  });

  it("goes back up after four smooth seconds, up to full", () => {
    const c = { slow: 0, smooth: 0 };
    let scale = 0.7;
    for (let i = 0; i < 3; i++) scale = nextResolutionScale(scale, refresh, refresh, c);
    expect(scale).toBe(0.7);
    scale = nextResolutionScale(scale, refresh, refresh, c);
    expect(scale).toBe(0.8);
    for (let i = 0; i < 40; i++) scale = nextResolutionScale(scale, refresh, refresh, c);
    expect(scale).toBe(1);
  });

  it("holds steady in between", () => {
    const c = { slow: 0, smooth: 0 };
    let scale = 0.8;
    for (let i = 0; i < 20; i++) scale = nextResolutionScale(scale, refresh * 1.18, refresh, c);
    expect(scale).toBe(0.8);
  });
});
