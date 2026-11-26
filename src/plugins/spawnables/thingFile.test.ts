import { describe, expect, it } from "vitest";

import { gltfBounds, physicsFromBounds, readThingPhysics, ThingPhysics } from "./thingFile";

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

describe("Things spawned into your hold", () => {
  it("reads spawn.held", () => {
    const held = readThingPhysics({ extensions: { HAVEN_thing: { spawn: { held: true } } } }, fallback);
    expect(held.spawn).toEqual({ distance: 2.4, upright: true, held: true });
    const notHeld = readThingPhysics({ extensions: { HAVEN_thing: { spawn: { held: "yes" } } } }, fallback);
    expect(notHeld.spawn).toEqual({ distance: 2.4, upright: true });
  });
});

describe("custom Things without HAVEN_thing", () => {
  it("fits a box around the file's scene, through node transforms", () => {
    const gltf = {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { translation: [0, 1, 0], children: [1] },
        { mesh: 0, scale: [2, 1, 1] },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }],
    };
    expect(gltfBounds(gltf)).toEqual({ min: [-1, 0.5, -0.5], max: [1, 1.5, 0.5] });
    const physics = physicsFromBounds(gltfBounds(gltf));
    expect(physics.collider).toEqual({ type: "box", size: [2, 1, 1], offset: [0, 1, 0] });
    expect(physics.spawn?.distance).toBeCloseTo(1.6);
  });

  it("falls back to a small box for a file with no geometry", () => {
    expect(gltfBounds({ scenes: [{ nodes: [] }] })).toBeUndefined();
    expect(physicsFromBounds(undefined).collider.type).toBe("box");
  });
});

describe("baking a Thing's physics into its file", () => {
  it("writes Buzzar's fitted box, keeping what the file already says", async () => {
    const { bakedThingPhysics, thingPhysicsToJSON, readThingPhysics: read } = await import("./thingFile");
    const gltf = {
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ min: [-0.1, 0, -0.3], max: [0.1, 0.2, 0.3] }],
      extensions: { HAVEN_thing: { spawn: { held: true }, hold: { grip: { position: [0, 0, 0] } } } },
    };
    const json = thingPhysicsToJSON(bakedThingPhysics(gltf), gltf.extensions.HAVEN_thing);
    expect(json.collider).toEqual({ type: "box", size: [0.2, 0.2, 0.6], offset: [0, 0.1, 0] });
    expect(json.hold).toEqual({ grip: { position: [0, 0, 0] } });
    // Reading the baked file back gives the same physics, whatever a client's own fallback is.
    const back = read({ extensions: { HAVEN_thing: json } }, fallback);
    expect(back.collider).toEqual(json.collider);
    expect(back.rotation).toBe("free");
    expect(back.spawn).toEqual({ distance: 1, upright: false, held: true });
  });
});
