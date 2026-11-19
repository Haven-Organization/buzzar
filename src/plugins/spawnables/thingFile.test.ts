import { describe, expect, it } from "vitest";

import { readThingPhysics, ThingPhysics } from "./thingFile";

const fallback: ThingPhysics = {
  collider: { type: "cylinder", radius: 1.5, height: 0.53, offset: [0, 0.265, 0] },
  density: 40,
  rotation: "yaw",
  upright: true,
  spawn: { distance: 2.4, upright: true },
};

describe("HAVEN_thing", () => {
  it("uses Buzzar's values when the file says nothing", () => {
    expect(readThingPhysics({}, fallback)).toEqual(fallback);
    expect(readThingPhysics(undefined, fallback)).toEqual(fallback);
  });

  it("takes the file's values, keeping the fallback for missing or bad ones", () => {
    const physics = readThingPhysics(
      {
        extensions: {
          HAVEN_thing: {
            collider: { type: "box", size: [1, 2, 1], offset: [0, 1, 0] },
            density: -3,
            rotation: "free",
            upright: false,
            spawn: { distance: 1.2 },
          },
        },
      },
      fallback
    );
    expect(physics).toEqual({
      collider: { type: "box", size: [1, 2, 1], offset: [0, 1, 0] },
      density: 40,
      rotation: "free",
      upright: false,
      spawn: { distance: 1.2, upright: true },
    });
  });

  it("ignores a collider it can't build", () => {
    const physics = readThingPhysics(
      { extensions: { HAVEN_thing: { collider: { type: "cone", radius: 1 } } } },
      fallback
    );
    expect(physics.collider).toEqual(fallback.collider);
  });
});
