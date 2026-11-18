/**
 * Buzzar: humanoid bone mapping for avatars.
 *
 * Supports VRM 1.0 (`VRMC_vrm`), VRM 0.x (`VRM`), Mixamo-named rigs (`mixamorig:Hips`, `mixamorigHips`,
 * `mixamorig1:Hips`, …) and the CATS/VRChat-style Blender naming (`Hips`, `Left arm`, `Left elbow`, …).
 * Bone names follow VRM 1.0.
 */
import type { GLTFRoot } from "../gltf/GLTF";

export const HUMAN_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
] as const;

export type HumanBone = (typeof HUMAN_BONES)[number];

const HUMAN_BONE_SET = new Set<string>(HUMAN_BONES);

/** Humanoid parent of each bone (VRM 1.0 hierarchy). Used to find the nearest mapped ancestor. */
export const HUMAN_BONE_PARENT: Partial<Record<HumanBone, HumanBone>> = {
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  head: "neck",
  leftEye: "head",
  rightEye: "head",
  jaw: "head",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  leftToes: "leftFoot",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  rightToes: "rightFoot",
  leftShoulder: "upperChest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  rightShoulder: "upperChest",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
};
for (const side of ["left", "right"] as const) {
  HUMAN_BONE_PARENT[`${side}ThumbMetacarpal`] = `${side}Hand`;
  HUMAN_BONE_PARENT[`${side}ThumbProximal`] = `${side}ThumbMetacarpal`;
  HUMAN_BONE_PARENT[`${side}ThumbDistal`] = `${side}ThumbProximal`;
  for (const finger of ["Index", "Middle", "Ring", "Little"] as const) {
    HUMAN_BONE_PARENT[`${side}${finger}Proximal`] = `${side}Hand`;
    HUMAN_BONE_PARENT[`${side}${finger}Intermediate`] = `${side}${finger}Proximal`;
    HUMAN_BONE_PARENT[`${side}${finger}Distal`] = `${side}${finger}Intermediate`;
  }
}

/** Nearest ancestor of `bone` (in the humanoid hierarchy) that is present in `bones`. */
export function nearestMappedAncestor<T>(bone: HumanBone, bones: Map<HumanBone, T>): HumanBone | undefined {
  let parent = HUMAN_BONE_PARENT[bone];
  while (parent && !bones.has(parent)) parent = HUMAN_BONE_PARENT[parent];
  return parent;
}

export type AvatarRigFormat = "vrm1" | "vrm0" | "mixamo" | "cats";

export interface HumanoidMapping {
  format: AvatarRigFormat;
  /** Humanoid bone → glTF node index. */
  bones: Map<HumanBone, number>;
  /**
   * Which way the model faces in its own glTF space. glTF/VRM 1.0/Mixamo face +Z; VRM 0.x faces -Z.
   */
  facesNegativeZ: boolean;
}

// --- Mixamo ------------------------------------------------------------------------------------

const MIXAMO_TO_HUMAN: Record<string, HumanBone> = {
  Hips: "hips",
  Spine: "spine",
  Spine1: "chest",
  Spine2: "upperChest",
  Neck: "neck",
  Head: "head",
  LeftEye: "leftEye",
  RightEye: "rightEye",
  LeftShoulder: "leftShoulder",
  LeftArm: "leftUpperArm",
  LeftForeArm: "leftLowerArm",
  LeftHand: "leftHand",
  RightShoulder: "rightShoulder",
  RightArm: "rightUpperArm",
  RightForeArm: "rightLowerArm",
  RightHand: "rightHand",
  LeftUpLeg: "leftUpperLeg",
  LeftLeg: "leftLowerLeg",
  LeftFoot: "leftFoot",
  LeftToeBase: "leftToes",
  RightUpLeg: "rightUpperLeg",
  RightLeg: "rightLowerLeg",
  RightFoot: "rightFoot",
  RightToeBase: "rightToes",
};
for (const side of ["Left", "Right"] as const) {
  const s = side === "Left" ? "left" : "right";
  MIXAMO_TO_HUMAN[`${side}HandThumb1`] = `${s}ThumbMetacarpal`;
  MIXAMO_TO_HUMAN[`${side}HandThumb2`] = `${s}ThumbProximal`;
  MIXAMO_TO_HUMAN[`${side}HandThumb3`] = `${s}ThumbDistal`;
  for (const [mixamo, human] of [
    ["Index", "Index"],
    ["Middle", "Middle"],
    ["Ring", "Ring"],
    ["Pinky", "Little"],
  ] as const) {
    MIXAMO_TO_HUMAN[`${side}Hand${mixamo}1`] = `${s}${human}Proximal`;
    MIXAMO_TO_HUMAN[`${side}Hand${mixamo}2`] = `${s}${human}Intermediate`;
    MIXAMO_TO_HUMAN[`${side}Hand${mixamo}3`] = `${s}${human}Distal`;
  }
}

/** `mixamorig:Hips`, `mixamorigHips`, `mixamorig1:Hips`, `mixamorig_Hips` → `Hips` */
export function stripMixamoPrefix(name: string): string | undefined {
  const match = /^mixamorig\d*[:_]?(.+)$/.exec(name);
  return match ? match[1] : undefined;
}

// --- CATS / VRChat Blender naming ---------------------------------------------------------------

const CATS_TO_HUMAN: Record<string, HumanBone> = {
  hips: "hips",
  spine: "spine",
  chest: "chest",
  "upper chest": "upperChest",
  upperchest: "upperChest",
  neck: "neck",
  head: "head",
  "left eye": "leftEye",
  "right eye": "rightEye",
  "left shoulder": "leftShoulder",
  "left arm": "leftUpperArm",
  "left elbow": "leftLowerArm",
  "left wrist": "leftHand",
  "right shoulder": "rightShoulder",
  "right arm": "rightUpperArm",
  "right elbow": "rightLowerArm",
  "right wrist": "rightHand",
  "left leg": "leftUpperLeg",
  "left knee": "leftLowerLeg",
  "left ankle": "leftFoot",
  "left toe": "leftToes",
  "right leg": "rightUpperLeg",
  "right knee": "rightLowerLeg",
  "right ankle": "rightFoot",
  "right toe": "rightToes",
};

for (const side of ["left", "right"] as const) {
  // CATS / VRChat finger names: Thumb0_L…Thumb2_L, IndexFinger1_L…LittleFinger3_L.
  CATS_TO_HUMAN[`${side} thumb0`] = `${side}ThumbMetacarpal`;
  CATS_TO_HUMAN[`${side} thumb1`] = `${side}ThumbProximal`;
  CATS_TO_HUMAN[`${side} thumb2`] = `${side}ThumbDistal`;
  for (const finger of ["Index", "Middle", "Ring", "Little"] as const) {
    const cats = `${side} ${finger.toLowerCase()}finger`;
    CATS_TO_HUMAN[`${cats}1`] = `${side}${finger}Proximal`;
    CATS_TO_HUMAN[`${cats}2`] = `${side}${finger}Intermediate`;
    CATS_TO_HUMAN[`${cats}3`] = `${side}${finger}Distal`;
  }
}

/**
 * Buzzar: 3ds Max Biped finger names, which turn up in rigs otherwise named some other way (e.g. CATS):
 * `Bip001 L Finger0` (thumb) … `Finger4` (little), each followed by a joint digit (none, 1, 2), maybe with an
 * exporter's `_0112` suffix. Returns the humanoid finger bone, or undefined.
 */
export function bipedFingerBone(name: string): HumanBone | undefined {
  const match = /^bip\d*[-_ ]?(l|r)[-_ ]?finger([0-4])([12]?)(?:[._]\d+)?$/i.exec(name.trim());
  if (!match) return undefined;
  const side = match[1].toLowerCase() === "l" ? "left" : "right";
  const finger = Number(match[2]);
  const joint = match[3] === "" ? 0 : Number(match[3]);
  if (finger === 0) return `${side}Thumb${(["Metacarpal", "Proximal", "Distal"] as const)[joint]}`;
  const name4 = (["Index", "Middle", "Ring", "Little"] as const)[finger - 1];
  return `${side}${name4}${(["Proximal", "Intermediate", "Distal"] as const)[joint]}`;
}

function normalizeCatsName(name: string): string {
  return name
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^(.*?) ?\b(l|r)$/, (_, base, side) => `${side === "l" ? "left" : "right"} ${base}`);
}

// --- Parsing -------------------------------------------------------------------------------------

/** VRM 0.x used different thumb names. */
const VRM0_RENAMES: Record<string, HumanBone> = {
  leftThumbProximal: "leftThumbMetacarpal",
  leftThumbIntermediate: "leftThumbProximal",
  rightThumbProximal: "rightThumbMetacarpal",
  rightThumbIntermediate: "rightThumbProximal",
};

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validNodeIndex(root: GLTFRoot, value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < (root.nodes?.length ?? 0);
}

export function getHumanoidMapping(root: GLTFRoot): HumanoidMapping | undefined {
  const extensions = (root.extensions ?? {}) as AnyRecord;

  // VRM 1.0
  const vrmc = extensions.VRMC_vrm;
  if (isRecord(vrmc) && isRecord(vrmc.humanoid) && isRecord(vrmc.humanoid.humanBones)) {
    const bones = new Map<HumanBone, number>();
    for (const [name, def] of Object.entries(vrmc.humanoid.humanBones)) {
      if (HUMAN_BONE_SET.has(name) && isRecord(def) && validNodeIndex(root, def.node)) {
        bones.set(name as HumanBone, def.node);
      }
    }
    if (bones.has("hips")) return { format: "vrm1", bones, facesNegativeZ: false };
  }

  // VRM 0.x
  const vrm0 = extensions.VRM;
  if (isRecord(vrm0) && isRecord(vrm0.humanoid) && Array.isArray(vrm0.humanoid.humanBones)) {
    const bones = new Map<HumanBone, number>();
    for (const def of vrm0.humanoid.humanBones) {
      if (!isRecord(def) || typeof def.bone !== "string" || !validNodeIndex(root, def.node)) continue;
      const name = VRM0_RENAMES[def.bone] ?? def.bone;
      if (HUMAN_BONE_SET.has(name)) bones.set(name as HumanBone, def.node);
    }
    if (bones.has("hips")) return { format: "vrm0", bones, facesNegativeZ: true };
  }

  // Name-based: Mixamo, then CATS
  const nodes = root.nodes ?? [];
  const mixamo = new Map<HumanBone, number>();
  const cats = new Map<HumanBone, number>();
  const fingers = new Map<HumanBone, number>();
  nodes.forEach((node, index) => {
    const name = node.name;
    if (!name) return;
    const stripped = stripMixamoPrefix(name);
    if (stripped && MIXAMO_TO_HUMAN[stripped] && !mixamo.has(MIXAMO_TO_HUMAN[stripped])) {
      mixamo.set(MIXAMO_TO_HUMAN[stripped], index);
    }
    const catsBone = CATS_TO_HUMAN[normalizeCatsName(name)];
    if (catsBone && !cats.has(catsBone)) cats.set(catsBone, index);
    const finger = bipedFingerBone(name);
    if (finger && !fingers.has(finger)) fingers.set(finger, index);
  });
  // Fingers named the Biped way fill in whatever the main naming scheme didn't name.
  for (const map of [mixamo, cats]) {
    for (const [bone, index] of fingers) if (!map.has(bone)) map.set(bone, index);
  }

  if (mixamo.has("hips") && mixamo.size >= 10) return { format: "mixamo", bones: mixamo, facesNegativeZ: false };
  if (cats.has("hips") && cats.size >= 10) return { format: "cats", bones: cats, facesNegativeZ: false };

  return undefined;
}

// --- Limits ---------------------------------------------------------------------------------------

export interface AvatarLimits {
  maxFileBytes: number;
  maxTriangles: number;
  maxBones: number;
  maxMaterials: number;
  maxSkinnedMeshes: number;
  maxImages: number;
}

/** Defaults are roughly VRChat's PC "Poor" rank; anything heavier is hidden by default. */
export const DEFAULT_AVATAR_LIMITS: AvatarLimits = {
  maxFileBytes: 60 * 1024 * 1024,
  maxTriangles: 150_000,
  maxBones: 400,
  maxMaterials: 32,
  maxSkinnedMeshes: 16,
  maxImages: 40,
};

export interface AvatarStats {
  fileBytes?: number;
  triangles: number;
  bones: number;
  materials: number;
  skinnedMeshes: number;
  images: number;
}

const TRIANGLE_MODES = new Set([4, undefined]); // TRIANGLES (default)

export function computeAvatarStats(root: GLTFRoot, fileBytes?: number): AvatarStats {
  const accessors = root.accessors ?? [];
  const meshes = root.meshes ?? [];
  let triangles = 0;
  let skinnedMeshes = 0;

  for (const node of root.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = meshes[node.mesh];
    if (!mesh) continue;
    if (node.skin !== undefined) skinnedMeshes++;
    for (const primitive of mesh.primitives ?? []) {
      if (!TRIANGLE_MODES.has(primitive.mode)) continue;
      const count =
        primitive.indices !== undefined
          ? accessors[primitive.indices]?.count ?? 0
          : accessors[primitive.attributes?.POSITION as number]?.count ?? 0;
      triangles += Math.floor(count / 3);
    }
  }

  const bones = (root.skins ?? []).reduce((total, skin) => total + (skin.joints?.length ?? 0), 0);

  return {
    fileBytes,
    triangles,
    bones,
    materials: root.materials?.length ?? 0,
    skinnedMeshes,
    images: root.images?.length ?? 0,
  };
}

/** Returns human-readable reasons the avatar exceeds the limits (empty = OK). */
export function checkAvatarLimits(stats: AvatarStats, limits: AvatarLimits = DEFAULT_AVATAR_LIMITS): string[] {
  const reasons: string[] = [];
  if (stats.fileBytes !== undefined && stats.fileBytes > limits.maxFileBytes) {
    reasons.push(`file is ${(stats.fileBytes / 1048576).toFixed(1)} MB (max ${limits.maxFileBytes / 1048576} MB)`);
  }
  if (stats.triangles > limits.maxTriangles) reasons.push(`${stats.triangles} triangles (max ${limits.maxTriangles})`);
  if (stats.bones > limits.maxBones) reasons.push(`${stats.bones} bones (max ${limits.maxBones})`);
  if (stats.materials > limits.maxMaterials) reasons.push(`${stats.materials} materials (max ${limits.maxMaterials})`);
  if (stats.skinnedMeshes > limits.maxSkinnedMeshes) {
    reasons.push(`${stats.skinnedMeshes} skinned meshes (max ${limits.maxSkinnedMeshes})`);
  }
  if (stats.images > limits.maxImages) reasons.push(`${stats.images} textures (max ${limits.maxImages})`);
  return reasons;
}
