import { describe, expect, test } from "vitest";

import type { GLTFRoot } from "../gltf/GLTF";
import { checkAvatarLimits, computeAvatarStats, getHumanoidMapping, stripMixamoPrefix } from "./humanoid";

const nodes = (names: string[]) => names.map((name) => ({ name }));

describe("getHumanoidMapping", () => {
  test("VRM 1.0", () => {
    const root = {
      asset: { version: "2.0" },
      nodes: nodes(["Root", "J_Hips", "J_Spine", "J_Head"]),
      extensions: {
        VRMC_vrm: {
          humanoid: { humanBones: { hips: { node: 1 }, spine: { node: 2 }, head: { node: 3 }, bogus: { node: 0 } } },
        },
      },
    } as unknown as GLTFRoot;
    const mapping = getHumanoidMapping(root)!;
    expect(mapping.format).toBe("vrm1");
    expect(mapping.facesNegativeZ).toBe(false);
    expect(mapping.bones.get("hips")).toBe(1);
    expect(mapping.bones.has("bogus" as any)).toBe(false);
  });

  test("VRM 0.x renames thumbs and faces -Z; rejects out-of-range nodes", () => {
    const root = {
      asset: { version: "2.0" },
      nodes: nodes(["a", "b", "c"]),
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: "hips", node: 0 },
              { bone: "leftThumbProximal", node: 1 },
              { bone: "leftThumbIntermediate", node: 2 },
              { bone: "spine", node: 99 },
            ],
          },
        },
      },
    } as unknown as GLTFRoot;
    const mapping = getHumanoidMapping(root)!;
    expect(mapping.format).toBe("vrm0");
    expect(mapping.facesNegativeZ).toBe(true);
    expect(mapping.bones.get("leftThumbMetacarpal")).toBe(1);
    expect(mapping.bones.get("leftThumbProximal")).toBe(2);
    expect(mapping.bones.has("spine")).toBe(false);
  });

  test("Mixamo names with any prefix style", () => {
    expect(stripMixamoPrefix("mixamorig:Hips")).toBe("Hips");
    expect(stripMixamoPrefix("mixamorigHips")).toBe("Hips");
    expect(stripMixamoPrefix("mixamorig1:LeftArm")).toBe("LeftArm");
    const names = [
      "Hips",
      "Spine",
      "Spine1",
      "Spine2",
      "Neck",
      "Head",
      "LeftArm",
      "LeftForeArm",
      "LeftHand",
      "RightArm",
      "LeftUpLeg",
    ];
    const mapping = getHumanoidMapping({
      asset: { version: "2.0" },
      nodes: nodes(names.map((n) => `mixamorig:${n}`)),
    } as any)!;
    expect(mapping.format).toBe("mixamo");
    expect(mapping.bones.get("upperChest")).toBe(3);
    expect(mapping.bones.get("leftLowerArm")).toBe(7);
  });

  test("CATS / VRChat Blender names", () => {
    const names = [
      "Hips",
      "Spine",
      "Chest",
      "Neck",
      "Head",
      "Left arm",
      "Left elbow",
      "Left wrist",
      "Right arm",
      "Right elbow",
      "Left leg",
      "Left knee",
    ];
    const mapping = getHumanoidMapping({ asset: { version: "2.0" }, nodes: nodes(names) } as any)!;
    expect(mapping.format).toBe("cats");
    expect(mapping.bones.get("leftLowerArm")).toBe(6);
    expect(mapping.bones.get("leftLowerLeg")).toBe(11);
  });

  test("non-humanoid returns undefined", () => {
    expect(getHumanoidMapping({ asset: { version: "2.0" }, nodes: nodes(["Cube", "Light"]) } as any)).toBeUndefined();
  });
});

describe("avatar limits", () => {
  test("counts triangles per node instance, bones and skinned meshes", () => {
    const root = {
      asset: { version: "2.0" },
      accessors: [{ count: 300 }, { count: 90 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }],
      nodes: [{ mesh: 0, skin: 0 }, { mesh: 0 }],
      skins: [{ joints: [0, 1, 2] }],
      materials: [{}],
    } as unknown as GLTFRoot;
    const stats = computeAvatarStats(root, 1000);
    expect(stats).toMatchObject({ triangles: 200, bones: 3, skinnedMeshes: 1, materials: 1, fileBytes: 1000 });
    expect(checkAvatarLimits(stats)).toEqual([]);
    expect(checkAvatarLimits({ ...stats, triangles: 1_000_000 })).toHaveLength(1);
  });
});
