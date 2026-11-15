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
  Vector3,
} from "three";

import { HumanBone } from "./humanoid";
import { buildSitClip, captureRestTransforms, retargetClip, RetargetRig } from "./retarget";

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

describe("buildSitClip", () => {
  // T-pose facing +Z with the character's left on +X; bones point along +Y in their own space like Mixamo,
  // with rest rotations so the legs hang down and the arms point out to the sides.
  const legs: Spec[] = [
    ["hips", undefined, [0, 1, 0], [0, 0, 0]],
    ["spine", "hips", [0, 0.1, 0], [0, 0, 0]],
    ["leftUpperArm", "spine", [0.2, 0.4, 0], [0, 0, -90]],
    ["leftLowerArm", "leftUpperArm", [0, 0.3, 0], [0, 0, 0]],
    ["leftHand", "leftLowerArm", [0, 0.25, 0], [0, 0, 0]],
    ["leftUpperLeg", "hips", [0.1, -0.05, 0], [0, 0, 180]],
    ["leftLowerLeg", "leftUpperLeg", [0, 0.45, 0], [0, 0, 0]],
    ["leftFoot", "leftLowerLeg", [0, 0.45, 0], [0, 0, 0]],
    ["rightUpperLeg", "hips", [-0.1, -0.05, 0], [0, 0, 180]],
    ["rightLowerLeg", "rightUpperLeg", [0, 0.45, 0], [0, 0, 0]],
    ["rightFoot", "rightLowerLeg", [0, 0.45, 0], [0, 0, 0]],
  ];

  function posedDirection(rig: RetargetRig, from: HumanBone, to: HumanBone) {
    const clip = buildSitClip(rig);
    const mixer = new AnimationMixer(rig.root);
    mixer.clipAction(clip).play();
    mixer.update(0);
    rig.root.updateMatrixWorld(true);
    const a = new Vector3().setFromMatrixPosition(rig.bones.get(from)!.matrixWorld);
    const b = new Vector3().setFromMatrixPosition(rig.bones.get(to)!.matrixWorld);
    return b.sub(a).normalize();
  }

  test("thighs point forward and shins hang down", () => {
    const thigh = posedDirection(buildRig(legs), "leftUpperLeg", "leftLowerLeg");
    expect(thigh.z).toBeGreaterThan(0.95);
    expect(thigh.x).toBeGreaterThan(0); // slightly apart, towards the character's left

    const shin = posedDirection(buildRig(legs), "leftLowerLeg", "leftFoot");
    expect(shin.y).toBeLessThan(-0.95);
  });

  test("arms hang down instead of the T-pose", () => {
    const arm = posedDirection(buildRig(legs), "leftUpperArm", "leftLowerArm");
    expect(arm.y).toBeLessThan(-0.8);
  });

  test("mirrors for rigs whose left side is on -X", () => {
    const mirrored = legs.map(([n, p, pos, e]) => [n, p, [-pos[0], pos[1], pos[2]], [e[0], e[1], -e[2]]] as Spec);
    const thigh = posedDirection(buildRig(mirrored), "leftUpperLeg", "leftLowerLeg");
    expect(thigh.z).toBeGreaterThan(0.95);
    expect(thigh.x).toBeLessThan(0);
  });
});

describe("normalizeRestPose", () => {
  function armDirection(rig: RetargetRig) {
    rig.root.updateMatrixWorld(true);
    const a = new Vector3().setFromMatrixPosition(rig.bones.get("leftUpperArm")!.matrixWorld);
    const b = new Vector3().setFromMatrixPosition(rig.bones.get("leftLowerArm")!.matrixWorld);
    return b.sub(a).normalize();
  }

  test("an A-pose avatar follows a T-pose clip's arm directions", () => {
    const source = buildRig(sourceSpecs);
    // Same skeleton, but bound with the upper arm angled 40° down (an A-pose).
    const target = buildRig(
      sourceSpecs.map(([name, parent, position, euler]) =>
        name === "leftUpperArm" ? [name, parent, position, [0, 0, -40]] : [name, parent, position, euler]
      ) as Spec[]
    );
    const clip = makeSourceClip(source);
    const retargeted = retargetClip(clip, source, target, { normalizeRestPose: true });
    for (const time of [0, 0.5, 1]) {
      pose(source, clip, time);
      pose(target, retargeted, time);
      expect(armDirection(target).dot(armDirection(source))).toBeCloseTo(1, 4);
    }
  });

  test("without it, the A-pose offset carries into the animation", () => {
    const source = buildRig(sourceSpecs);
    const target = buildRig(
      sourceSpecs.map(([name, parent, position, euler]) =>
        name === "leftUpperArm" ? [name, parent, position, [0, 0, -40]] : [name, parent, position, euler]
      ) as Spec[]
    );
    const clip = makeSourceClip(source);
    pose(source, clip, 0);
    pose(target, retargetClip(clip, source, target), 0);
    expect(armDirection(target).dot(armDirection(source))).toBeLessThan(0.8);
  });
});
