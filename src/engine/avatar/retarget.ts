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
  leftFoot: "leftToes",
  rightFoot: "rightToes",
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
  /**
   * Buzzar: bone → [turn, roll] in degrees about the world's up and forward axes, applied after its direction and
   * bend (for a body lying prone: turn bends it sideways, roll twists it about its length).
   */
  sway?: Partial<Record<HumanBone, [number, number]>>;
  /** Move the hips so both feet stay where they are at rest (on the ground, under the body). */
  groundFeet?: boolean;
  /** Put the hips at this fraction of their rest height (e.g. lying down). */
  hipsHeight?: number;
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

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
    const sway = bone ? spec.sway?.[bone] : undefined;
    if (sway) {
      current.premultiply(swing.setFromAxisAngle(Y_AXIS, (sway[0] * sideSign * Math.PI) / 180));
      current.premultiply(swing.setFromAxisAngle(Z_AXIS, (sway[1] * sideSign * Math.PI) / 180));
    }

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
  // Buzzar: a sneaking crouch, not a chair or a squat: thighs forward and a little out, knees ahead of the feet,
  // hips low and back, and the upper body leaning in with the head up to keep looking ahead.
  directions: {
    // Knees out a little, shins back in, so each foot lands under its own hip.
    leftUpperLeg: [0.2, -0.3, 0.93],
    rightUpperLeg: [-0.2, -0.3, 0.93],
    leftLowerLeg: [-0.2, -0.9, -0.42],
    rightLowerLeg: [0.2, -0.9, -0.42],
  },
  // The whole upper body leans in from the hips (hips pushed back behind the heels), head up to look ahead.
  hipsPitch: 34,
  bends: { spine: 6, chest: 4, neck: -26, head: -18 },
  groundFeet: true,
};

/**
 * Buzzar: metres per second a generated walking clip covers at time scale 1, by clip name (retargeted copies keep the
 * name; avatars differ in size, but close enough to keep the feet from visibly sliding).
 */
export const CLIP_SPEED = new Map<string, number>();

/**
 * Buzzar: walking crouched, generated rather than layering the crouch on the walk (whose leg swing twisted the bent
 * legs). Each foot is placed on the ground, planted while the body passes over it and then lifted forward, and the
 * leg reaches it with two-bone IK (knee forward and a little out). Arms swing gently against the legs, the body
 * leans in like the static crouch, and the hips sway and bob a little. Its ground speed is recorded in CLIP_SPEED
 * so playback can match the player's speed (feet don't slide).
 */
export function buildCrouchWalkClip(
  rig: RetargetRig,
  name = "CrouchWalk",
  duration = 1.1,
  /** Buzzar: step towards the character's left instead of forwards (played in reverse for the right). */
  sideways = false
): AnimationClip {
  type V = [number, number, number];
  const FRAMES = 24;
  const TAU = Math.PI * 2;
  const STANCE = 0.6;
  const HIPS_HEIGHT = 0.64;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const pos = (bone: HumanBone) => {
    const obj = rig.bones.get(bone);
    return obj ? new Vector3().setFromMatrixPosition(restWorldMatrix(rig, obj)) : undefined;
  };
  const hips = pos("hips");
  const legs = (["left", "right"] as const).map((side) => ({
    side,
    hip: pos(`${side}UpperLeg`),
    knee: pos(`${side}LowerLeg`),
    foot: pos(`${side}Foot`),
  }));
  if (!hips || legs.some((l) => !l.hip || !l.knee || !l.foot)) {
    return buildPoseClip(rig, name, CROUCH_POSE); // can't place feet: hold the static crouch
  }
  // Rig space may have the character's left on −x; directions are given left = +x and mirrored by buildPoseClip.
  const sideSign = legs[0].hip!.x < hips.x ? -1 : 1;
  const legLength = legs[0].hip!.distanceTo(legs[0].knee!) + legs[0].knee!.distanceTo(legs[0].foot!);
  // Sideways steps are shorter (the feet must not meet) and the stance a little wider.
  const stride = (sideways ? 0.16 : 0.55) * legLength;
  const width = sideways ? 1.9 : 1.15;
  // Rig-space x of the character's left (the left hip's side of the hips).
  const leftX = legs[0].hip!.x > hips.x ? 1 : -1;
  const lift = 0.14 * legLength;
  const drop = hips.y * (1 - HIPS_HEIGHT);

  const ik = (hip: Vector3, foot: Vector3, l1: number, l2: number, out: number): [V, V] => {
    const v = foot.clone().sub(hip);
    const d = Math.min(Math.max(v.length(), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
    v.normalize();
    const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    const hint = new Vector3(0.3 * out, 0, 1);
    const perp = hint.sub(v.clone().multiplyScalar(hint.dot(v))).normalize();
    const knee = hip
      .clone()
      .add(v.clone().multiplyScalar(Math.cos(a) * l1))
      .add(perp.multiplyScalar(Math.sin(a) * l1));
    const thigh = knee.clone().sub(hip).normalize();
    const shin = hip.clone().add(v.multiplyScalar(d)).sub(knee).normalize();
    return [
      [thigh.x * sideSign, thigh.y, thigh.z],
      [shin.x * sideSign, shin.y, shin.z],
    ];
  };

  const frames: AnimationClip[] = [];
  const times: number[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const phase = f / FRAMES;
    const directions: PoseSpec["directions"] = {};
    legs.forEach(({ side, hip, knee, foot }, i) => {
      const p = (phase + i * 0.5) % 1;
      let z: number;
      let y = 0;
      let toe = 0; // foot pitch: toes down while lifting off, up as it reaches
      if (p < STANCE) {
        z = stride / 2 - (p / STANCE) * stride;
      } else {
        const t = (p - STANCE) / (1 - STANCE);
        z = -stride / 2 + smooth(t) * stride;
        y = lift * Math.sin(Math.PI * t);
        toe = Math.sin(Math.PI * t) * (t < 0.5 ? -0.5 : 0.3);
      }
      const out = side === "left" ? 1 : -1;
      const hipPosed = hip!.clone().setY(hip!.y - drop);
      // Feet a little ahead of the hips (the hips sit back) and a little wider than standing. Planted feet move
      // back (forwards walk) or to the right (sideways walk) relative to the body as it travels.
      const target = foot!.clone();
      target.x = hips.x + (foot!.x - hips.x) * width + (sideways ? z * leftX : 0);
      target.z = hipPosed.z + 0.18 * legLength + (sideways ? 0 : z);
      target.y = foot!.y + y;
      const [thigh, shin] = ik(hipPosed, target, hip!.distanceTo(knee!), knee!.distanceTo(foot!), out * sideSign);
      directions[`${side}UpperLeg`] = thigh;
      directions[`${side}LowerLeg`] = shin;
      directions[`${side}Foot`] = [0, -0.35 + toe, 1];
      // Arms hang forward and swing against their leg.
      const swing = Math.cos(TAU * p) * -1; // arm forward while the opposite... same-side leg is back
      directions[`${side}UpperArm`] = [0.22 * out, -0.92, 0.2 + 0.22 * swing];
      directions[`${side}LowerArm`] = [0.08 * out, -0.75, 0.6 + 0.2 * swing];
    });
    const c = Math.cos(TAU * phase);
    const bob = (1 + Math.cos(TAU * 2 * phase)) / 2; // lowest as a foot passes under the body
    const spec: PoseSpec = {
      ...CROUCH_POSE,
      directions,
      groundFeet: false,
      hipsHeight: HIPS_HEIGHT - 0.015 * (1 - bob),
      sway: { hips: [5 * c, 3 * c], chest: [-4 * c, -2 * c], head: [-1 * c, 0] },
    };
    frames.push(buildPoseClip(rig, `${name}${f}`, spec));
    times.push((f / FRAMES) * duration);
  }
  times.push(duration);
  const tracks = frames[0].tracks.map((track) => {
    const size = track.getValueSize();
    const values: number[] = [];
    for (const index of [...frames.keys(), 0]) {
      const other = frames[index].tracks.find((t) => t.name === track.name) ?? track;
      values.push(...Array.from(other.values.slice(0, size)));
    }
    const TrackType = track.constructor as new (name: string, times: number[], values: number[]) => KeyframeTrack;
    return new TrackType(track.name, times, values);
  });
  const clip = new AnimationClip(name, duration, tracks);
  CLIP_SPEED.set(name, stride / (STANCE * duration));
  return clip;
}

/**
 * Buzzar: an army crawl, generated as continuous motion: each arm reaches far forward, plants and drags its elbow back
 * along the ground, then lifts and swings forward again (the arms half a cycle apart); each knee slides up along the
 * ground and then pushes the leg straight back, with the opposite arm. The hips and chest roll and swing against each
 * other and the body lifts a little on each push. Sampled into a looping clip.
 */
export function buildCrawlClip(rig: RetargetRig, name = "Crawl", duration = 1.6): AnimationClip {
  type V = [number, number, number];
  const FRAMES = 24;
  const TAU = Math.PI * 2;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const mix = (a: V, b: V, t: number): V => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const wrap = (x: number) => x - Math.floor(x);
  // Left side is +x; the right side mirrors x.
  const side = (v: V, s: number): V => [v[0] * s, v[1], v[2]];

  // Arm cycle a ∈ [0,1): 0–0.55 pull (planted, reach → elbow dragged back), 0.55–1 recover (lifted, swing forward).
  const UPPER_REACH: V = [0.14, -0.2, 1];
  const UPPER_PULLED: V = [0.85, -0.42, -0.2];
  const LOWER_REACH: V = [0.03, -0.12, 1];
  const LOWER_PULLED: V = [-0.4, -0.15, 0.9];
  const arm = (a: number): [V, V] => {
    if (a < 0.55) {
      const t = smooth(a / 0.55);
      return [mix(UPPER_REACH, UPPER_PULLED, t), mix(LOWER_REACH, LOWER_PULLED, t)];
    }
    const t = smooth((a - 0.55) / 0.45);
    const lift = Math.sin(Math.PI * t);
    const upper = mix(UPPER_PULLED, UPPER_REACH, t);
    const lower = mix(LOWER_PULLED, LOWER_REACH, t);
    upper[1] += 0.35 * lift; // shoulder lifts the arm clear of the ground
    lower[1] += 0.25 * lift;
    lower[0] += 0.2 * lift; // hand swings round the outside
    return [upper, lower];
  };

  // Leg cycle l ∈ [0,1): 0–0.5 push (knee up → leg straight back), 0.5–1 draw the knee up along the ground.
  const THIGH_UP: V = [0.9, -0.1, -0.2];
  const THIGH_STRAIGHT: V = [0.08, 0, -1];
  const SHIN_UP: V = [-0.4, 0.02, -0.92];
  const SHIN_STRAIGHT: V = [0.06, 0.06, -1];
  const leg = (l: number): [V, V] => {
    const t = l < 0.5 ? 1 - smooth(l / 0.5) : smooth((l - 0.5) / 0.5); // 1 = knee fully up
    return [mix(THIGH_STRAIGHT, THIGH_UP, t), mix(SHIN_STRAIGHT, SHIN_UP, t)];
  };

  const times: number[] = [];
  const frames: AnimationClip[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const phase = f / FRAMES;
    // Left arm reaches at phase 0 while the right knee is up; everything else follows from that.
    const [lUpperArm, lLowerArm] = arm(phase);
    const [rUpperArm, rLowerArm] = arm(wrap(phase + 0.5));
    const [lUpperLeg, lLowerLeg] = leg(wrap(phase + 0.5));
    const [rUpperLeg, rLowerLeg] = leg(phase);
    const c = Math.cos(TAU * phase); // +1: right knee up / left arm reaching; −1: the other side
    const push = (1 - Math.cos(TAU * 2 * phase)) / 2; // twice a cycle, mid-push
    const spec: PoseSpec = {
      ...PRONE_POSE,
      directions: {
        ...PRONE_POSE.directions,
        leftUpperArm: lUpperArm,
        leftLowerArm: lLowerArm,
        rightUpperArm: side(rUpperArm, -1),
        rightLowerArm: side(rLowerArm, -1),
        leftUpperLeg: lUpperLeg,
        leftLowerLeg: lLowerLeg,
        rightUpperLeg: side(rUpperLeg, -1),
        rightLowerLeg: side(rLowerLeg, -1),
      },
      // Hips swing and roll toward the drawn-up knee; the chest counters toward the reaching arm; head steadies.
      sway: {
        hips: [-14 * c, -12 * c],
        spine: [7 * c, 5 * c],
        chest: [9 * c, 9 * c],
        neck: [-5 * c, -4 * c],
        head: [-3 * c, -3 * c],
      },
      hipsHeight: (PRONE_POSE.hipsHeight ?? 0.2) + 0.025 * push,
    };
    frames.push(buildPoseClip(rig, `${name}${f}`, spec));
    times.push((f / FRAMES) * duration);
  }
  times.push(duration);
  const tracks = frames[0].tracks.map((track) => {
    const size = track.getValueSize();
    const values: number[] = [];
    for (const index of [...frames.keys(), 0]) {
      const other = frames[index].tracks.find((t) => t.name === track.name) ?? track;
      values.push(...Array.from(other.values.slice(0, size)));
    }
    const TrackType = track.constructor as new (name: string, times: number[], values: number[]) => KeyframeTrack;
    return new TrackType(track.name, times, values);
  });
  return new AnimationClip(name, duration, tracks);
}

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
