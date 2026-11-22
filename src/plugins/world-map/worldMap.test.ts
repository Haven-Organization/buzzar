import { Box3, BoxGeometry, Mesh, Vector3 } from "three";

import { mapArea, mapBounds } from "../../engine/renderer/systems/WorldMapCaptureSystem";
import { mapUV, parseMapEvent, parseMapExtension, serializeMapEvent } from "./worldMap.common";

describe("world map", () => {
  it("stores the area in whole centimetres (Matrix events allow only whole numbers) and reads it back", () => {
    const content = serializeMapEvent("mxc://example.org/abc", { minX: -12.345, minZ: -3.2, maxX: 40.5, maxZ: 9.999 }, 2.5);
    const numbers = JSON.stringify(content).match(/-?\d+(\.\d+)?/g)!.filter((n) => !content.url.includes(n));
    expect(numbers.every((n) => Number.isInteger(Number(n)))).toBe(true);
    expect(parseMapEvent(content)).toEqual({
      url: "mxc://example.org/abc",
      minX: -12.34,
      minZ: -3.2,
      maxX: 40.5,
      maxZ: 10,
      cutHeight: 2.5,
    });
  });

  it("ignores a removed, broken or non-Matrix map", () => {
    expect(parseMapEvent({})).toBeUndefined();
    expect(parseMapEvent({ url: "https://example.org/x.png", min_x_cm: 0, min_z_cm: 0, max_x_cm: 1, max_z_cm: 1 })).toBeUndefined();
    expect(parseMapEvent({ url: "mxc://a/b", min_x_cm: 5, min_z_cm: 0, max_x_cm: 5, max_z_cm: 1 })).toBeUndefined();
  });

  it("reads a world file's HAVEN_map", () => {
    expect(parseMapExtension({ image: 2, min: [-10, -5], max: [10, 5] })).toEqual({
      image: 2,
      area: { minX: -10, minZ: -5, maxX: 10, maxZ: 5 },
    });
    expect(parseMapExtension({ image: -1, min: [0, 0], max: [1, 1] })).toBeUndefined();
    expect(parseMapExtension({ image: 0, min: [0], max: [1, 1] })).toBeUndefined();
  });

  it("puts north (-Z) at the top and east (+X) on the right", () => {
    const area = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };
    expect(mapUV(area, 0, -10)).toEqual({ u: 0.5, v: 0 });
    expect(mapUV(area, 10, 0)).toEqual({ u: 1, v: 0.5 });
  });

  it("fits the world's meshes, ignoring skies and seas that reach the horizon", () => {
    const floor = new Mesh(new BoxGeometry(20, 1, 10));
    floor.position.set(5, 0, 0);
    const sky = new Mesh(new BoxGeometry(5000, 10, 5000));
    const bounds = mapBounds([floor, sky]);
    expect(bounds.min).toEqual(new Vector3(-5, -0.5, -5));
    const area = mapArea(bounds);
    expect(area.minX).toBeCloseTo(-5.4);
    expect(area.maxX).toBeCloseTo(15.4);
    expect(area.minZ).toBeCloseTo(-5.2);
    expect(mapBounds([sky]).isEmpty()).toBe(true);
    expect(new Box3().isEmpty()).toBe(true);
  });
});
