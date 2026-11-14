import { describe, expect, test } from "vitest";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Euler,
  Group,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";

import { HumanBone } from "./humanoid";
import { captureRestTransforms, retargetClip, RetargetRig } from "./retarget";

type Spec = [HumanBone, HumanBone | undefined, [number, number, number], [number, number, number]];

/** Build a chain-shaped skeleton: [bone, parent, position, rest euler (deg)]. */
function buildRig(specs: Spec[], align = new Quaternion()): RetargetRig {
  const root = new Group();
  const bones = new Map<HumanBone, Object3D>();
  for (const [name, parent, position, euler] of specs) {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(...position);
    bone.quaternion.setFromEuler(new Euler(...euler.map((d) => (d * Math.PI) / 180)));
    (parent ? bones.get(parent)! : root).add(bone);
    bones.set(name, bone);
  }
  return { root, bones, rest: captureRestTransforms(root), align };
}

function worldQuat(rig: RetargetRig, obj: Object3D): Quaternion {
  const q = new Quaternion();
  let cur: Object3D | null = obj;
  while (cur && cur !== rig.root) {
    q.premultiply(cur.quaternion);
    cur = cur.parent;
  }
  return q.premultiply(rig.align);
}

function restWorldQuat(rig: RetargetRig, obj: Object3D): Quaternion {
  const q = new Quaternion();
  let cur: Object3D | null = obj;
  while (cur && cur !== rig.root) {
    q.premultiply(rig.rest.get(cur)!.quaternion);
    cur = cur.parent;
  }
  return q.premultiply(rig.align);
}

/** World rotation delta from rest, D = W · R⁻¹. */
function delta(rig: RetargetRig, obj: Object3D) {
  return worldQuat(rig, obj).multiply(restWorldQuat(rig, obj).invert());
}

function expectQuatClose(a: Quaternion, b: Quaternion) {
  // q and -q are the same rotation
  expect(Math.abs(a.dot(b))).toBeCloseTo(1, 4);
}

function pose(rig: RetargetRig, clip: AnimationClip, time: number) {
  const mixer = new AnimationMixer(rig.root);
  mixer.clipAction(clip).play();
  mixer.setTime(time);
}

const sourceSpecs: Spec[] = [
  ["hips", undefined, [0, 1, 0], [0, 0, 0]],
  ["spine", "hips", [0, 0.1, 0], [0, 0, 0]],
  ["chest", "spine", [0, 0.15, 0], [0, 0, 0]],
  ["neck", "chest", [0, 0.2, 0], [0, 0, 0]],
  ["head", "neck", [0, 0.1, 0], [0, 0, 0]],
  ["leftUpperArm", "chest", [0.2, 0.15, 0], [0, 0, 0]],
  ["leftLowerArm", "leftUpperArm", [0.25, 0, 0], [0, 0, 0]],
];

function makeSourceClip(rig: RetargetRig): AnimationClip {
  const track = (bone: HumanBone, e0: number[], e1: number[]) => {
    const q0 = new Quaternion().setFromEuler(new Euler(...e0.map((d) => (d * Math.PI) / 180)));
    const q1 = new Quaternion().setFromEuler(new Euler(...e1.map((d) => (d * Math.PI) / 180)));
    const obj = rig.bones.get(bone)!;
    return new QuaternionKeyframeTrack(`${obj.uuid}.quaternion`, [0, 1], [...q0.toArray(), ...q1.toArray()]);
  };
  return new AnimationClip("Walk", 1, [
    track("hips", [0, 0, 0], [0, 30, 0]),
    track("spine", [0, 0, 0], [10, 0, 5]),
    track("chest", [0, 0, 0], [-20, 15, 0]),
    track("neck", [0, 0, 0], [5, -10, 0]),
    track("head", [0, 0, 0], [0, 20, 10]),
    track("leftUpperArm", [0, 0, 0], [0, 0, -70]),
    track("leftLowerArm", [0, 0, 0], [0, -45, 0]),
  ]);
}

describe("retargetClip", () => {
  test("transfers world-space rotation deltas to a rig with different rest orientations", () => {
    const source = buildRig(sourceSpecs);
    // Same shape, but every bone's local axes are rotated differently (like Blender vs Unity exports).
    const target = buildRig([
      ["hips", undefined, [0, 0.9, 0], [90, 0, 0]],
      ["spine", "hips", [0, 0, 0.1], [-90, 0, 30]],
      ["chest", "spine", [0, 0.15, 0], [0, 45, 0]],
      ["neck", "chest", [0, 0.2, 0], [10, 0, -20]],
      ["head", "neck", [0, 0.1, 0], [0, 0, 90]],
      ["leftUpperArm", "chest", [0.2, 0.15, 0], [0, 90, 0]],
      ["leftLowerArm", "leftUpperArm", [0.25, 0, 0], [33, 0, 12]],
    ]);

    const retargeted = retargetClip(makeSourceClip(source), source, target);
    pose(source, makeSourceClip(source), 0.7);
    pose(target, retargeted, 0.7);

    for (const bone of source.bones.keys()) {
      expectQuatClose(delta(target, target.bones.get(bone)!), delta(source, source.bones.get(bone)!));
    }
  });

  test("handles a target skeleton that skips a humanoid bone", () => {
    const source = buildRig(sourceSpecs);
    // No chest: neck and arm hang directly off spine.
    const target = buildRig([
      ["hips", undefined, [0, 0.9, 0], [0, 0, 20]],
      ["spine", "hips", [0, 0.25, 0], [0, 30, 0]],
      ["neck", "spine", [0, 0.2, 0], [15, 0, 0]],
      ["head", "neck", [0, 0.1, 0], [0, 0, 0]],
      ["leftUpperArm", "spine", [0.2, 0.15, 0], [0, 0, 45]],
      ["leftLowerArm", "leftUpperArm", [0.25, 0, 0], [0, 0, 0]],
    ]);

    const clip = makeSourceClip(source);
    const retargeted = retargetClip(clip, source, target);
    pose(source, clip, 1);
    pose(target, retargeted, 1);

    for (const bone of ["hips", "spine", "neck", "head", "leftUpperArm", "leftLowerArm"] as HumanBone[]) {
      expectQuatClose(delta(target, target.bones.get(bone)!), delta(source, source.bones.get(bone)!));
    }
  });

  test("accounts for a target that faces the opposite way (VRM 0.x)", () => {
    const source = buildRig(sourceSpecs);
    const align = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as any, Math.PI);
    const target = buildRig(sourceSpecs, align);

    const clip = makeSourceClip(source);
    const retargeted = retargetClip(clip, source, target);
    pose(source, clip, 0.5);
    pose(target, retargeted, 0.5);

    for (const bone of source.bones.keys()) {
      expectQuatClose(delta(target, target.bones.get(bone)!), delta(source, source.bones.get(bone)!));
    }
  });
});
