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
    //   q_t = R'_t(pt)⁻¹ · R_s(a) · chain_s(a→b, t) · R_s(b)⁻¹ · R'_t(b)
    // With no ancestor, R_s(a) = identity and the chain runs from the source root (includes align).
    const targetParentRestWorldInv = targetObj.parent
      ? restWorldQuat(target, targetObj.parent, new Quaternion()).invert()
      : new Quaternion();
    const left = sourceAncestor
      ? targetParentRestWorldInv.clone().multiply(restWorldQuat(source, sourceAncestor, _a))
      : targetParentRestWorldInv.clone();
    const right = restWorldQuat(source, sourceObj, _b).clone().invert().multiply(restWorldQuat(target, targetObj));

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
