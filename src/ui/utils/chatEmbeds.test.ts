import { describe, expect, it } from "vitest";

import { classifyModel, extractRoomLinks, isModelFile } from "./chatEmbeds";

describe("room links in messages", () => {
  it("finds bare aliases, matrix.to and matrix: links, without duplicates", () => {
    const links = extractRoomLinks({
      body: "come to #buzzar-backrooms:example.org or https://matrix.to/#/#lobby:matrix.org?via=matrix.org and again #buzzar-backrooms:example.org",
    });
    expect(links).toEqual([
      { target: "#lobby:matrix.org", via: ["matrix.org"] },
      { target: "#buzzar-backrooms:example.org", via: [] },
    ]);
  });

  it("reads pills in formatted bodies, room IDs, and matrix: URIs", () => {
    const links = extractRoomLinks({
      body: "Test Room",
      formatted_body:
        '<a href="https://matrix.to/#/!x3wwBjFMWtFb4hPc4Kb7prOxe4Ure_Kf8_XOyTVcnh4?via=example.org">Test Room</a>',
    });
    expect(links).toEqual([{ target: "!x3wwBjFMWtFb4hPc4Kb7prOxe4Ure_Kf8_XOyTVcnh4", via: ["example.org"] }]);
    expect(extractRoomLinks({ body: "matrix:r/maze:other.org" })).toEqual([{ target: "#maze:other.org", via: [] }]);
  });

  it("skips people, events and anchors that aren't aliases", () => {
    expect(extractRoomLinks({ body: "https://matrix.to/#/@alice:example.org and #hashtag and issue #12" })).toEqual([]);
    expect(extractRoomLinks({ body: "https://matrix.to/#/!room:x.org/$event:x.org" })).toEqual([]);
  });
});

describe("3D model files", () => {
  it("recognises .glb and .vrm", () => {
    expect(isModelFile("thing.GLB")).toBe(true);
    expect(isModelFile("me.vrm")).toBe(true);
    expect(isModelFile("photo.png")).toBe(false);
    expect(isModelFile("blob", "model/gltf-binary")).toBe(true);
  });

  const mesh = (extent: number) => ({
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [0, 0, 0], max: [extent, extent / 2, extent / 3], count: 3, componentType: 5126, type: "VEC3" }],
  });

  it("tells avatars, worlds and Things apart", () => {
    expect(classifyModel({ asset: { version: "2.0" }, extensionsUsed: ["VRMC_vrm"] } as any)).toBe("avatar");
    expect(classifyModel({ asset: { version: "2.0" } } as any, "me.vrm")).toBe("avatar");
    expect(classifyModel({ asset: { version: "2.0" }, extensionsUsed: ["MX_spawn_point"] } as any)).toBe("world");
    expect(classifyModel({ asset: { version: "2.0" }, nodes: [{ mesh: 0 }], ...mesh(40) } as any)).toBe("world");
    expect(classifyModel({ asset: { version: "2.0" }, nodes: [{ mesh: 0 }], ...mesh(0.5) } as any)).toBe("thing");
    // Scaled down by its node: a Thing.
    expect(
      classifyModel({ asset: { version: "2.0" }, nodes: [{ mesh: 0, scale: [0.01, 0.01, 0.01] }], ...mesh(100) } as any)
    ).toBe("thing");
  });
});
