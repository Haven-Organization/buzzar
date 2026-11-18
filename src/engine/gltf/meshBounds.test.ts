import { gltfMeshBounds } from "./gltf.game";
import { GLTFRoot } from "./GLTF";

const root = (accessor: object) =>
  ({
    asset: { version: "2.0" },
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ type: "VEC3", count: 24, ...accessor }],
  } as unknown as GLTFRoot);

describe("gltfMeshBounds", () => {
  test("reads float bounds as they are", () => {
    expect(gltfMeshBounds(root({ componentType: 5126, min: [-0.3, -4, -0.05], max: [0.3, 4, 0.05] }), 0)).toEqual({
      min: [-0.3, -4, -0.05],
      max: [0.3, 4, 0.05],
    });
  });

  test("scales normalized (quantized) bounds back to the -1…1 range", () => {
    const bounds = gltfMeshBounds(
      root({ componentType: 5122, normalized: true, min: [-2456, -32767, -408], max: [2456, 32767, 408] }),
      0
    )!;
    expect(bounds.max[1]).toBeCloseTo(1);
    expect(bounds.min[1]).toBeCloseTo(-1);
    expect(bounds.max[0]).toBeCloseTo(2456 / 32767);
  });
});
