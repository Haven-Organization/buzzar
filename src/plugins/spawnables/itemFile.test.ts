import { describe, expect, it } from "vitest";

import { gltfBounds, physicsFromBounds, readItemPhysics, ItemPhysics } from "./itemFile";

const fallback: ItemPhysics = {
  collider: { type: "cylinder", radius: 1.5, height: 0.53, offset: [0, 0.265, 0] },
  density: 40,
  rotation: "yaw",
  upright: true,
  spawn: { distance: 2.4, upright: true },
};

describe("HAVEN_item", () => {
  it("uses Buzzar's values when the file says nothing", () => {
    expect(readItemPhysics({}, fallback)).toEqual(fallback);
    expect(readItemPhysics(undefined, fallback)).toEqual(fallback);
  });

  it("takes the file's values, keeping the fallback for missing or bad ones", () => {
    const physics = readItemPhysics(
      {
        extensions: {
          HAVEN_item: {
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
    const physics = readItemPhysics(
      { extensions: { HAVEN_item: { collider: { type: "cone", radius: 1 } } } },
      fallback
    );
    expect(physics.collider).toEqual(fallback.collider);
  });
});

describe("Items spawned into your hold", () => {
  it("reads spawn.held", () => {
    const held = readItemPhysics({ extensions: { HAVEN_item: { spawn: { held: true } } } }, fallback);
    expect(held.spawn).toEqual({ distance: 2.4, upright: true, held: true });
    const notHeld = readItemPhysics({ extensions: { HAVEN_item: { spawn: { held: "yes" } } } }, fallback);
    expect(notHeld.spawn).toEqual({ distance: 2.4, upright: true });
  });
});

describe("custom Items without HAVEN_item", () => {
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

describe("baking an Item's physics into its file", () => {
  it("writes Buzzar's fitted box, keeping what the file already says", async () => {
    const { bakedItemPhysics, itemPhysicsToJSON, readItemPhysics: read } = await import("./itemFile");
    const gltf = {
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ min: [-0.1, 0, -0.3], max: [0.1, 0.2, 0.3] }],
      extensions: { HAVEN_item: { spawn: { held: true }, hold: { grip: { position: [0, 0, 0] } } } },
    };
    const json = itemPhysicsToJSON(bakedItemPhysics(gltf), gltf.extensions.HAVEN_item);
    expect(json.collider).toEqual({ type: "box", size: [0.2, 0.2, 0.6], offset: [0, 0.1, 0] });
    expect(json.hold).toEqual({ grip: { position: [0, 0, 0] } });
    // Reading the baked file back gives the same physics, whatever a client's own fallback is.
    const back = read({ extensions: { HAVEN_item: json } }, fallback);
    expect(back.collider).toEqual(json.collider);
    expect(back.rotation).toBe("free");
    expect(back.spawn).toEqual({ distance: 1, upright: false, held: true });
  });
});
