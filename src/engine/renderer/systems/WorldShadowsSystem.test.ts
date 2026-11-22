import { DirectionalLight, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { fitShadowToPoint, sunDirection } from "./WorldShadowsSystem";
import { parseWorldShadows } from "../renderer.common";

describe("shadows (Third Room #204)", () => {
  it("reads a world's shadow settings, off unless turned on, with values clamped", () => {
    expect(parseWorldShadows(undefined)).toEqual({ sun: false, bakedSun: undefined });
    expect(parseWorldShadows({ sun: true })).toEqual({ sun: true, bakedSun: undefined });
    expect(parseWorldShadows({ baked_sun: { enabled: false, azimuth: 10 } }).bakedSun).toBeUndefined();
    expect(parseWorldShadows({ baked_sun: { enabled: true, azimuth: 400, elevation: 0, strength: "x" } }).bakedSun).toEqual(
      { azimuth: 360, elevation: 5, strength: 0.6 }
    );
  });

  it("points the sun from the compass direction and height", () => {
    const north = sunDirection(0, 0);
    expect(north.x).toBeCloseTo(0);
    expect(north.z).toBeCloseTo(-1);
    const eastHigh = sunDirection(90, 45);
    expect(eastHigh.x).toBeCloseTo(Math.SQRT1_2);
    expect(eastHigh.y).toBeCloseTo(Math.SQRT1_2);
    expect(sunDirection(0, 90).y).toBeCloseTo(1);
  });

  it("centres a directional light's shadow box on the given point, wherever the light is", () => {
    const light = new DirectionalLight();
    light.position.set(500, 300, -200); // far from where we are
    light.add(light.target);
    light.target.position.set(0, -1, 0.3);
    light.shadow.mapSize.set(1024, 1024);
    const point = new Vector3(40, 2, 60);
    fitShadowToPoint(light, point);
    const camera = light.shadow.camera;
    // The point lands in the middle of the shadow camera's view.
    const ndc = point.clone().project(camera);
    expect(Math.abs(ndc.x)).toBeLessThan(0.01);
    expect(Math.abs(ndc.y)).toBeLessThan(0.01);
    expect(Math.abs(ndc.z)).toBeLessThan(0.01);
    expect(camera.right - camera.left).toBeCloseTo(50);
  });
});
