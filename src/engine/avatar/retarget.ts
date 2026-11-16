/**
 * Buzzar: retarget humanoid animation clips from one skeleton to another.
 *
 * Both skeletons are assumed to share a rest pose (T-pose: Mixamo, VRM 0.x/1.0 and most VRChat rigs).
 * For each humanoid bone we transfer its *world-space rotation delta from rest*:
 *
 *   D(b, t)  = W_s(b, t) · R_s(b)⁻¹                       source world rotation relative to rest
 *   W_t(b,t) = D(b, t) · R'_t(b)                          same delta applied to the target rest
 *   q_t(b,t) = W_t(parent_t(b), t)⁻¹ · W_t(b, t)          target local rotation
 *
 * where R are rest world rotations (relative to each rig's root, the target pre-rotated into the source's
 * facing by `align`). The target parent moves rigidly with its nearest *mapped* humanoid ancestor `a`, so
 * W_t(parent_t(b), t) = D(a, t) · R'_t(parent_t(b)). D(a)⁻¹·D(b) only needs the source chain between a and
 * b, which handles skeletons that skip bones (e.g. no upperChest) without accumulating error.
 *
 * Hips translation is transferred as a world-space offset from rest, scaled by relative hip height.
 *
 * Buzzar: rests that aren't a T-pose (e.g. game avatars bound in an A-pose, arms 40° down) are corrected per limb:
 * fix(b) rotates the target's rest bone direction onto the source's, and C_t(b) = fix(b) · R'_t(b) replaces R'_t(b)
 * above. Hands/feet and fingers/toes take the fix of their limb; the spine and head take none. A target node
 * between mapped bones moves rigidly with its mapped ancestor a, so its corrected rest is fix(a) · R'_t(node).
 */
import {
  AnimationClip,
  KeyframeTrack,
  Matrix4,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";

import { HumanBone, nearestMappedAncestor } from "./humanoid";

export interface RestTransform {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

/** A rig whose rest transforms were captured before any animation ran. */
export interface RetargetRig {
  root: Object3D;
  bones: Map<HumanBone, Object3D>;
  rest: Map<Object3D, RestTransform>;
  /** Rotation that turns this rig's space into the shared facing (identity for the source). */
  align: Quaternion;
}

export function captureRestTransforms(root: Object3D): Map<Object3D, RestTransform> {
  const rest = new Map<Object3D, RestTransform>();
  root.traverse((obj) => {
    rest.set(obj, {
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });
  return rest;
}

/**
 * Replace the rest transforms of skin joints with their *bind pose*.
 *
 * glTF node transforms are whatever pose the exporter was in (often the first animation frame), so they
 * are not a reliable rest pose. The bind pose is encoded in each skin's inverse bind matrices:
 * bindWorld(joint) = meshWorld · IBM⁻¹ (relative to the rig root). `jointBindWorld` maps joint objects to
 * that matrix; non-joint objects keep their node transforms.
 */
export function applyBindPose(
  rest: Map<Object3D, RestTransform>,
  root: Object3D,
  jointBindWorld: Map<Object3D, Matrix4>
) {
  const world = new Map<Object3D, Matrix4>();
  const local = new Matrix4();
  const parentInv = new Matrix4();

  root.traverse((obj) => {
    const parentWorld = obj === root || !obj.parent ? new Matrix4() : world.get(obj.parent) ?? new Matrix4();
    const bind = jointBindWorld.get(obj);
    const restTransform = rest.get(obj);
    if (!restTransform) return;

    if (bind && obj !== root) {
      local.copy(parentInv.copy(parentWorld).invert()).multiply(bind);
      local.decompose(restTransform.position, restTransform.quaternion, restTransform.scale);
      world.set(obj, bind.clone());
    } else {
      local.compose(restTransform.position, restTransform.quaternion, restTransform.scale);
      world.set(obj, obj === root ? new Matrix4() : parentWorld.clone().multiply(local));
    }
  });
}

function restLocal(rig: RetargetRig, obj: Object3D): RestTransform {
  const rest = rig.rest.get(obj);
  if (!rest) throw new Error("retarget: object has no captured rest transform");
  return rest;
}

/** Rest world rotation relative to the rig root, including `align`. */
function restWorldQuat(rig: RetargetRig, obj: Object3D, target = new Quaternion()): Quaternion {
  target.identity();
  let cur: Object3D | null = obj;
  while (cur && cur !== rig.root) {
    target.premultiply(restLocal(rig, cur).quaternion);
    cur = cur.parent;
  }
  return target.premultiply(rig.align);
}

/** Rest world matrix relative to the rig root, including `align`. */
function restWorldMatrix(rig: RetargetRig, obj: Object3D, target = new Matrix4()): Matrix4 {
  target.identity();
  const local = new Matrix4();
  let cur: Object3D | null = obj;
  while (cur && cur !== rig.root) {
    const rest = restLocal(rig, cur);
    local.compose(rest.position, rest.quaternion, rest.scale);
    target.premultiply(local);
    cur = cur.parent;
  }
  return target.premultiply(new Matrix4().makeRotationFromQuaternion(rig.align));
}

interface TrackSampler {
  times: Float32Array;
  sample(time: number, out: Quaternion | Vector3): void;
}

function parseTrackName(name: string): { uuid: string; property: string } | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  return { uuid: name.slice(0, dot), property: name.slice(dot + 1) };
}

function makeSampler(track: KeyframeTrack): TrackSampler {
  const interpolant = track.createInterpolant();
  return {
    times: track.times as Float32Array,
    sample(time, out) {
      const v = interpolant.evaluate(time);
      if (out instanceof Quaternion) out.set(v[0], v[1], v[2], v[3]).normalize();
      else out.set(v[0], v[1], v[2]);
    },
  };
}

export interface RetargetOptions {
  /** Include hips translation (bobbing, root motion). Default true. */
  hipsTranslation?: boolean;
  /**
   * Correct limbs whose rest pose differs from the source's (A-pose avatars under T-pose animations): each limb
   * bone's rest direction is rotated onto the source's before transferring rotations. Default false.
   */
  normalizeRestPose?: boolean;
}

export function retargetClip(
  clip: AnimationClip,
  source: RetargetRig,
  target: RetargetRig,
  options: RetargetOptions = {}
): AnimationClip {
  // Index source tracks by object.
  const uuidToObject = new Map<string, Object3D>();
  source.root.traverse((obj) => uuidToObject.set(obj.uuid, obj));

  const rotationSamplers = new Map<Object3D, TrackSampler>();
  const positionSamplers = new Map<Object3D, TrackSampler>();
  for (const track of clip.tracks) {
    const parsed = parseTrackName(track.name);
    const obj = parsed && (uuidToObject.get(parsed.uuid) ?? source.root.getObjectByName(parsed.uuid));
    if (!parsed || !obj) continue;
    if (parsed.property === "quaternion") rotationSamplers.set(obj, makeSampler(track));
    else if (parsed.property === "position") positionSamplers.set(obj, makeSampler(track));
  }

  const tracks: KeyframeTrack[] = [];
  const restFix = options.normalizeRestPose ? computeRestFixes(source, target) : new Map<HumanBone, Quaternion>();
  const fixFor = (bone: HumanBone | undefined): Quaternion => {
    if (!bone) return IDENTITY;
    const direct = restFix.get(bone);
    if (direct) return direct;
    const limb = nearestMappedAncestor(bone, restFix);
    return (limb && restFix.get(limb)) || IDENTITY;
  };

  const _a = new Quaternion();
  const _b = new Quaternion();
  const _q = new Quaternion();
  const _chain = new Quaternion();

  /** Product of local rotations along the source chain from (excluding) `ancestor` down to `bone` at time t. */
  function sourceChain(ancestor: Object3D | undefined, bone: Object3D, time: number, out: Quaternion) {
    out.identity();
    let cur: Object3D | null = bone;
    while (cur && cur !== ancestor && cur !== source.root) {
      const sampler = rotationSamplers.get(cur);
      if (sampler) sampler.sample(time, _q);
      else _q.copy(restLocal(source, cur).quaternion);
      out.premultiply(_q);
      cur = cur.parent;
    }
    if (!ancestor) out.premultiply(source.align);
    return out;
  }

  for (const [humanBone, targetObj] of target.bones) {
    const sourceObj = source.bones.get(humanBone);
    if (!sourceObj) continue;

    const sampler = rotationSamplers.get(sourceObj);
    if (!sampler) continue;

    // Nearest humanoid ancestor mapped in BOTH rigs.
    const shared = new Map<HumanBone, true>();
    for (const bone of target.bones.keys()) if (source.bones.has(bone)) shared.set(bone, true);
    const ancestorBone = nearestMappedAncestor(humanBone, shared);
    const sourceAncestor = ancestorBone ? source.bones.get(ancestorBone) : undefined;

    // Constant factors:
    //   q_t = R'_t(pt)⁻¹ · fix(a)⁻¹ · R_s(a) · chain_s(a→b, t) · R_s(b)⁻¹ · fix(b) · R'_t(b)
    // With no ancestor, R_s(a) = fix(a) = identity and the chain runs from the source root (includes align).
    const targetParentRestWorldInv = targetObj.parent
      ? restWorldQuat(target, targetObj.parent, new Quaternion()).invert()
      : new Quaternion();
    const left = sourceAncestor
      ? targetParentRestWorldInv
          .clone()
          .multiply(fixFor(ancestorBone).clone().invert())
          .multiply(restWorldQuat(source, sourceAncestor, _a))
      : targetParentRestWorldInv.clone();
    const right = restWorldQuat(source, sourceObj, _b)
      .clone()
      .invert()
      .multiply(fixFor(humanBone))
      .multiply(restWorldQuat(target, targetObj));

    const times = sampler.times;
    const values = new Float32Array(times.length * 4);
    for (let i = 0; i < times.length; i++) {
      sourceChain(sourceAncestor, sourceObj, times[i], _chain);
      _q.copy(left).multiply(_chain).multiply(right).normalize();
      _q.toArray(values, i * 4);
    }
    tracks.push(new QuaternionKeyframeTrack(`${targetObj.uuid}.quaternion`, Array.from(times), Array.from(values)));
  }

  // Hips translation
  const sourceHips = source.bones.get("hips");
  const targetHips = target.bones.get("hips");
  const hipsSampler = sourceHips && positionSamplers.get(sourceHips);
  if (options.hipsTranslation !== false && sourceHips && targetHips && hipsSampler) {
    const sourceParentWorld = sourceHips.parent
      ? restWorldMatrix(source, sourceHips.parent)
      : new Matrix4().makeRotationFromQuaternion(source.align);
    const sourceRestWorld = new Vector3().setFromMatrixPosition(restWorldMatrix(source, sourceHips));
    const targetRestWorld = new Vector3().setFromMatrixPosition(restWorldMatrix(target, targetHips));
    const targetParentWorldInv = (
      targetHips.parent
        ? restWorldMatrix(target, targetHips.parent)
        : new Matrix4().makeRotationFromQuaternion(target.align)
    ).invert();

    const ratio = sourceRestWorld.y !== 0 ? targetRestWorld.y / sourceRestWorld.y : 1;
    const times = hipsSampler.times;
    const values = new Float32Array(times.length * 3);
    const p = new Vector3();
    for (let i = 0; i < times.length; i++) {
      hipsSampler.sample(times[i], p);
      p.applyMatrix4(sourceParentWorld).sub(sourceRestWorld).multiplyScalar(ratio).add(targetRestWorld);
      p.applyMatrix4(targetParentWorldInv);
      p.toArray(values, i * 3);
    }
    tracks.push(new VectorKeyframeTrack(`${targetHips.uuid}.position`, Array.from(times), Array.from(values)));
  }

  return new AnimationClip(clip.name, clip.duration, tracks);
}

const IDENTITY = new Quaternion();

/**
 * Per-limb rotations that turn the target's rest pose into the source's (e.g. A-pose arms → T-pose arms): for each
 * limb bone, the shortest rotation from the target's rest bone direction to the source's.
 */
export function computeRestFixes(source: RetargetRig, target: RetargetRig): Map<HumanBone, Quaternion> {
  const fixes = new Map<HumanBone, Quaternion>();
  const position = (rig: RetargetRig, obj: Object3D) => new Vector3().setFromMatrixPosition(restWorldMatrix(rig, obj));
  for (const [bone, child] of Object.entries(POSE_DIRECTION_CHILD) as [HumanBone, HumanBone][]) {
    const sb = source.bones.get(bone);
    const sc = source.bones.get(child);
    const tb = target.bones.get(bone);
    const tc = target.bones.get(child);
    if (!sb || !sc || !tb || !tc) continue;
    const sourceDir = position(source, sc).sub(position(source, sb));
    const targetDir = position(target, tc).sub(position(target, tb));
    if (sourceDir.lengthSq() < 1e-10 || targetDir.lengthSq() < 1e-10) continue;
    fixes.set(bone, new Quaternion().setFromUnitVectors(targetDir.normalize(), sourceDir.normalize()));
  }
  return fixes;
}

/** World-space eye height (metres above the rig root) estimated from the head bone. */
export function estimateEyeHeight(rig: RetargetRig): number | undefined {
  const head = rig.bones.get("head");
  if (!head) return undefined;
  const leftEye = rig.bones.get("leftEye");
  const rightEye = rig.bones.get("rightEye");
  const eyeY = (obj: Object3D) => new Vector3().setFromMatrixPosition(restWorldMatrix(rig, obj)).y;
  if (leftEye && rightEye) return (eyeY(leftEye) + eyeY(rightEye)) / 2;
  // Head bone is at the base of the skull; eyes are ~8 cm above it on an adult.
  return eyeY(head) + 0.08;
}

// --- Procedural poses ---------------------------------------------------------------------------

/** Humanoid child used to measure each posed bone's direction (the bone "points" at this child). */
const POSE_DIRECTION_CHILD: Partial<Record<HumanBone, HumanBone>> = {
  leftUpperLeg: "leftLowerLeg",
  rightUpperLeg: "rightLowerLeg",
  leftLowerLeg: "leftFoot",
  rightLowerLeg: "rightFoot",
  leftUpperArm: "leftLowerArm",
  rightUpperArm: "rightLowerArm",
  leftLowerArm: "leftHand",
  rightLowerArm: "rightHand",
};

/**
 * Bone directions for a seated pose, in a rig space facing +Z with the character's left on +X. Thighs point
 * forward along the seat, shins hang down, upper arms hang by the sides and forearms rest on the thighs.
 */
const SIT_DIRECTIONS: Partial<Record<HumanBone, [number, number, number]>> = {
  leftUpperLeg: [0.12, -0.08, 1],
  rightUpperLeg: [-0.12, -0.08, 1],
  leftLowerLeg: [0.04, -1, 0.12],
  rightLowerLeg: [-0.04, -1, 0.12],
  leftUpperArm: [0.28, -0.92, 0.22],
  rightUpperArm: [-0.28, -0.92, 0.22],
  leftLowerArm: [0.15, -0.4, 1],
  rightLowerArm: [-0.15, -0.4, 1],
};

/**
 * Builds a static "Sit" clip for a rig from its rest pose (Buzzar seats, see plugins/seats). Each posed bone is
 * swung from its current direction to the target direction; every other bone keeps its rest *local* rotation,
 * so the spine, head and hands follow naturally. Built on the source rig, it retargets to any avatar like the
 * locomotion clips.
 *
 * The rig must face +Z in its own space (true for the built-in Mixamo rig, whose `align` is identity).
 */
export function buildSitClip(rig: RetargetRig, name = "Sit"): AnimationClip {
  return buildPoseClip(rig, name, { directions: SIT_DIRECTIONS });
}

/** A static body pose, in a rig space facing +Z with the character's left on +X. */
export interface PoseSpec {
  /** Bone → direction to its child (see POSE_DIRECTION_CHILD). */
  directions?: Partial<Record<HumanBone, [number, number, number]>>;
  /** Pitch the whole body forward by this many degrees at the hips (90 = lying face down). */
  hipsPitch?: number;
  /** Bone → extra pitch in degrees (positive leans forward / looks down), applied after its parent. */
  bends?: Partial<Record<HumanBone, number>>;
  /** Move the hips so both feet stay where they are at rest (on the ground, under the body). */
  groundFeet?: boolean;
  /** Put the hips at this fraction of their rest height (e.g. lying down). */
  hipsHeight?: number;
}

const X_AXIS = new Vector3(1, 0, 0);

/**
 * Builds a static pose clip (sitting, crouching, lying prone) on a rig from its rest pose. Bones with a direction
 * are swung to it; bones with a bend are pitched; every other bone keeps its rest *local* rotation, so children
 * follow. With `groundFeet` or `hipsHeight` the clip also moves the hips (a position track, which retargeting
 * scales by hip height).
 */
export function buildPoseClip(rig: RetargetRig, name: string, spec: PoseSpec): AnimationClip {
  const objToBone = new Map<Object3D, HumanBone>();
  for (const [bone, obj] of rig.bones) objToBone.set(obj, bone);

  const restPos = (obj: Object3D) => new Vector3().setFromMatrixPosition(restWorldMatrix(rig, obj));

  // Mirror X if this rig's left side is on -X.
  const hips = rig.bones.get("hips");
  const leftLeg = rig.bones.get("leftUpperLeg");
  const sideSign = hips && leftLeg && restPos(leftLeg).x < restPos(hips).x ? -1 : 1;

  const desiredWorld = new Map<Object3D, Quaternion>();
  const posedMatrix = new Map<Object3D, Matrix4>();
  const tracks: KeyframeTrack[] = [];
  const restWorld = new Quaternion();
  const current = new Quaternion();
  const swing = new Quaternion();
  const direction = new Vector3();
  const target = new Vector3();
  const alignMatrix = new Matrix4().makeRotationFromQuaternion(rig.align);

  rig.root.traverse((obj) => {
    if (obj === rig.root || !rig.rest.has(obj)) return;

    const parent = obj.parent;
    const parentWorld =
      !parent || parent === rig.root
        ? rig.align.clone()
        : desiredWorld.get(parent) ?? restWorldQuat(rig, parent, new Quaternion());

    // Where the bone ends up if it keeps its rest local rotation under the (possibly posed) parent.
    current.copy(parentWorld).multiply(restLocal(rig, obj).quaternion);

    const bone = objToBone.get(obj);
    if (bone === "hips" && spec.hipsPitch) {
      current.premultiply(swing.setFromAxisAngle(X_AXIS, (spec.hipsPitch * Math.PI) / 180));
    }
    const goal = bone ? spec.directions?.[bone] : undefined;
    const childBone = bone ? POSE_DIRECTION_CHILD[bone] : undefined;
    const child = childBone ? rig.bones.get(childBone) : undefined;

    if (goal && child) {
      // Rest direction to the child, carried along by the parent's change from rest.
      direction.copy(restPos(child)).sub(restPos(obj)).normalize();
      restWorldQuat(rig, obj, restWorld);
      direction.applyQuaternion(current.clone().multiply(restWorld.invert()));
      target.set(goal[0] * sideSign, goal[1], goal[2]).normalize();
      swing.setFromUnitVectors(direction, target);
      current.premultiply(swing);
    }
    const bend = bone ? spec.bends?.[bone] : undefined;
    if (bend) current.premultiply(swing.setFromAxisAngle(X_AXIS, (bend * Math.PI) / 180));

    desiredWorld.set(obj, current.clone());

    // Posed world matrix (hips at their rest position), for placing the feet.
    const rest = restLocal(rig, obj);
    const parentMatrix =
      !parent || parent === rig.root ? alignMatrix : posedMatrix.get(parent) ?? restWorldMatrix(rig, parent);
    const localQuat = parentWorld.clone().invert().multiply(current);
    posedMatrix.set(obj, parentMatrix.clone().multiply(new Matrix4().compose(rest.position, localQuat, rest.scale)));

    if (bone) {
      const local = parentWorld.clone().invert().multiply(current);
      const values = [...local.toArray(), ...local.toArray()];
      tracks.push(new QuaternionKeyframeTrack(`${obj.uuid}.quaternion`, [0, 1], values));
    }
  });

  // Hips translation: keep the feet planted, or set the hips height.
  if (hips && (spec.groundFeet || spec.hipsHeight !== undefined)) {
    const delta = new Vector3();
    if (spec.groundFeet) {
      const feet = (["leftFoot", "rightFoot"] as HumanBone[])
        .map((b) => rig.bones.get(b))
        .filter((o): o is Object3D => !!o);
      if (feet.length > 0) {
        const restFeet = feet.reduce((acc, f) => acc.add(restPos(f)), new Vector3()).multiplyScalar(1 / feet.length);
        const posedFeet = feet
          .reduce(
            (acc, f) => acc.add(new Vector3().setFromMatrixPosition(posedMatrix.get(f) ?? new Matrix4())),
            new Vector3()
          )
          .multiplyScalar(1 / feet.length);
        delta.subVectors(restFeet, posedFeet);
      }
    } else if (spec.hipsHeight !== undefined) {
      const hipsY = restPos(hips).y;
      delta.set(0, hipsY * spec.hipsHeight - hipsY, 0);
    }
    // World (rig-space) offset → the hips' parent space.
    const parentInv = (
      hips.parent && hips.parent !== rig.root ? restWorldMatrix(rig, hips.parent) : alignMatrix.clone()
    ).invert();
    const p = restPos(hips).add(delta).applyMatrix4(parentInv);
    tracks.push(new VectorKeyframeTrack(`${hips.uuid}.position`, [0, 1], [...p.toArray(), ...p.toArray()]));
  }

  return new AnimationClip(name, 1, tracks);
}

/**
 * Crouching: knees bent, hips lowered with the feet planted, back leaning forward a little, eyes ahead. Applied on
 * top of walking/idle (additively), so the avatar walks crouched.
 */
export const CROUCH_POSE: PoseSpec = {
  // Buzzar: a real crouch, not a chair: thighs forward and out, shins steeply angled so the knees are ahead of
  // the feet (hips drop low and back), and the upper body leans forward with the head up to keep looking ahead.
  directions: {
    leftUpperLeg: [0.22, -0.2, 0.95],
    rightUpperLeg: [-0.22, -0.2, 0.95],
    leftLowerLeg: [-0.06, -0.8, -0.6],
    rightLowerLeg: [0.06, -0.8, -0.6],
  },
  bends: { spine: 28, chest: 14, neck: -24, head: -14 },
  groundFeet: true,
};

/**
 * Lying prone: face down with the body stretched out behind the hips, propped on the forearms, head up.
 */
export const PRONE_POSE: PoseSpec = {
  hipsPitch: 90,
  directions: {
    leftUpperLeg: [0.1, 0, -1],
    rightUpperLeg: [-0.1, 0, -1],
    leftLowerLeg: [0.08, 0.05, -1],
    rightLowerLeg: [-0.08, 0.05, -1],
    leftUpperArm: [0.32, -0.55, 0.75],
    rightUpperArm: [-0.32, -0.55, 0.75],
    leftLowerArm: [-0.12, -0.05, 1],
    rightLowerArm: [0.12, -0.05, 1],
  },
  bends: { neck: -48, head: -22 },
  hipsHeight: 0.2,
};
