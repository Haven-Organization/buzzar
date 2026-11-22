import { describe, expect, it } from "vitest";

import { basePixelRatioFor, RenderQuality } from "./renderer.common";

describe("render resolution per quality", () => {
  it("uses the screen's density up to each quality's cap", () => {
    // A phone at 2.625×.
    expect(basePixelRatioFor(RenderQuality.Low, 2.625)).toBe(0.75);
    expect(basePixelRatioFor(RenderQuality.Medium, 2.625)).toBe(1.5);
    expect(basePixelRatioFor(RenderQuality.High, 2.625)).toBe(2);
    expect(basePixelRatioFor(RenderQuality.Ultra, 2.625)).toBe(2.625);
  });

  it("keeps ordinary screens as they were", () => {
    expect(basePixelRatioFor(RenderQuality.Medium, 1)).toBe(1);
    expect(basePixelRatioFor(RenderQuality.Ultra, 1)).toBe(1);
    expect(basePixelRatioFor(RenderQuality.High, 0)).toBe(1);
  });
});
