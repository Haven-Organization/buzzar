/**
 * Buzzar: secondary motion for avatars ("spring bones"): hair, ears, tails, skirts, ribbons and the like sway
 * and bounce as the avatar moves.
 *
 * Sources, in order of preference:
 * 1. VRM 1.0 `VRMC_springBone` (springs, joints, sphere/capsule colliders).
 * 2. VRM 0.x `VRM.secondaryAnimation` (bone groups + collider groups).
 * 3. Detection for plain glTF avatars: non-humanoid skin joints whose names say hair/ear/tail/skirt/… and that
 *    hang off the humanoid skeleton, with per-kind defaults.
 *
 * Animal ears also move on their own now and then (see EarMotion): both pinned back for a moment, like a horse's, or
 * one flicked. That tilts the ear's rest direction and lets the spring carry it there and back.
 *
 * The simulation is the standard VRM one (as in three-vrm): each joint keeps a "tail" point in world space,
 * moved by inertia, a stiffness force back toward the rest pose, and gravity; the tail is kept at bone length
 * and pushed out of colliders, and the joint is rotated to point at it. It runs on the three.js object graph
 * the animation mixer drives, right after the mixer (so springs follow the animated pose) and before the bones
 * are synced to the engine. Every viewer simulates everyone locally; nothing is networked.
 */
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

import type { HumanoidMapping } from "./humanoid";

export interface SpringSettings {
  /** Pull back toward the rest pose (VRM "stiffness"/"stiffiness"), roughly 0–4. */
  stiffness: number;
  /** Strength of gravity (VRM "gravityPower"), roughly 0–2. */
  gravityPower: number;
  /** World-space gravity direction (unit vector). */
  gravityDir: Vector3;
  /** 0 = keeps swinging, 1 = no inertia. */
  dragForce: number;
  /** Radius of the joint for collisions, in the joint's world scale. */
  hitRadius: number;
}

export type SpringCollider =
  | { node: Object3D; kind: "sphere"; offset: Vector3; radius: number }
  | { node: Object3D; kind: "capsule"; offset: Vector3; tail: Vector3; radius: number };

interface SpringJoint {
  bone: Object3D;
  /** The child the joint points at, if any (otherwise a virtual tail along the bone). */
  child?: Object3D;
  settings: SpringSettings;
  colliders: SpringCollider[];
  initialLocalMatrix: Matrix4;
  initialLocalRotation: Quaternion;
  /** Unit direction from the joint to its tail, in the joint's local (rest) space. */
  boneAxis: Vector3;
  /** Tail offset in the joint's local space (for the bone length). */
  initialLocalChildPosition: Vector3;
  currentTail: Vector3;
  prevTail: Vector3;
  initialized: boolean;
  /** Buzzar: a turn of the rest direction (an ear folding), applied to what the stiffness pulls toward. */
  restOffset?: Quaternion;
}

/** Buzzar: an ear that moves on its own: the first simulated joint(s) of an ear chain. */
interface EarJoint {
  joint: SpringJoint;
  /** Which ear (chains are numbered), so one can flick on its own. */
  ear: number;
  /** The rest turn that folds it fully back and down. */
  fold: Quaternion;
  /** The rest turn for a quick flick (part of the way back, and outward). */
  flick: Quaternion;
  /** How far folded (0–1) right now, and toward what. */
  amount: number;
  goal: number;
  pose: "fold" | "flick";
}

/** Buzzar: idle ear motion for one avatar. */
interface EarMotion {
  joints: EarJoint[];
  ears: number;
  /** Seconds until the next move, and until the current one ends. */
  untilNext: number;
  untilRelax: number;
}

export interface SpringRig {
  joints: SpringJoint[];
  /** Buzzar: ears that fold and flick now and then. */
  ears?: EarMotion;
  /** Where the avatar was last frame, to detect teleports. */
  lastRootPosition: Vector3;
  hasLastRoot: boolean;
}

/** Description used to build a rig, before objects are resolved. Exported for tests. */
export interface SpringChainSpec {
  /** Joint node indices, parent first. A joint's tail is its next entry if that is its child, else its child. */
  joints: number[];
  /** Shared by all joints, or one per joint (VRM 1.0 sets them per joint). */
  settings: SpringSettings | SpringSettings[];
  /** VRM 1.0: the last joint only marks where the previous one ends; it isn't simulated itself. */
  lastIsTip?: boolean;
  /** Buzzar: what it is, when detected by name ("ear", "tail", …). */
  kind?: string;
  colliders: { node: number; offset: [number, number, number]; radius: number; tail?: [number, number, number] }[];
}

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const vec = (v: unknown, fallback: [number, number, number]): [number, number, number] => {
  if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "number")) return [v[0], v[1], v[2]];
  if (isRecord(v)) return [num(v.x, fallback[0]), num(v.y, fallback[1]), num(v.z, fallback[2])];
  return fallback;
};

const DOWN: [number, number, number] = [0, -1, 0];
/** More joints than this per avatar are ignored (bounded cost per avatar per frame). */
export const MAX_SPRING_JOINTS = 256;

interface GLTFNodeLike {
  name?: string;
  children?: number[];
}
interface GLTFLike {
  nodes?: GLTFNodeLike[];
  skins?: { joints: number[] }[];
  extensions?: AnyRecord;
}

// --- Parsing --------------------------------------------------------------------------------------

/** VRM 1.0 `VRMC_springBone`. */
export function parseVRM1Springs(gltf: GLTFLike): SpringChainSpec[] | undefined {
  const ext = gltf.extensions?.VRMC_springBone;
  if (!isRecord(ext) || !Array.isArray(ext.springs)) return undefined;
  const colliderDefs = Array.isArray(ext.colliders) ? ext.colliders : [];
  const groupDefs = Array.isArray(ext.colliderGroups) ? ext.colliderGroups : [];

  const colliders = colliderDefs.map((c) => {
    if (!isRecord(c) || typeof c.node !== "number" || !isRecord(c.shape)) return undefined;
    const { sphere, capsule } = c.shape as AnyRecord;
    if (isRecord(sphere)) return { node: c.node, offset: vec(sphere.offset, [0, 0, 0]), radius: num(sphere.radius, 0) };
    if (isRecord(capsule)) {
      return {
        node: c.node,
        offset: vec(capsule.offset, [0, 0, 0]),
        radius: num(capsule.radius, 0),
        tail: vec(capsule.tail, [0, 0, 0]),
      };
    }
    return undefined;
  });
  const groups = groupDefs.map((g) =>
    isRecord(g) && Array.isArray(g.colliders)
      ? g.colliders.map((i) => (typeof i === "number" ? colliders[i] : undefined)).filter((c) => !!c)
      : []
  );

  const chains: SpringChainSpec[] = [];
  for (const spring of ext.springs) {
    if (!isRecord(spring) || !Array.isArray(spring.joints)) continue;
    const joints = spring.joints.filter(isRecord).filter((j) => typeof j.node === "number");
    if (joints.length === 0) continue;
    const groupIdx = Array.isArray(spring.colliderGroups) ? spring.colliderGroups : [];
    const springColliders = groupIdx.flatMap((i) => (typeof i === "number" ? groups[i] ?? [] : []));
    chains.push({
      joints: joints.map((j) => j.node as number),
      settings: joints.map((j) => ({
        stiffness: num(j.stiffness, 1),
        gravityPower: num(j.gravityPower, 0),
        gravityDir: new Vector3(...vec(j.gravityDir, DOWN)).normalize(),
        dragForce: num(j.dragForce, 0.5),
        hitRadius: num(j.hitRadius, 0),
      })),
      lastIsTip: joints.length > 1,
      colliders: springColliders as SpringChainSpec["colliders"],
    });
  }
  return chains;
}

/** VRM 0.x `VRM.secondaryAnimation`. VRM 0.x is authored in Unity space: z is flipped. */
export function parseVRM0Springs(gltf: GLTFLike): SpringChainSpec[] | undefined {
  const vrm = gltf.extensions?.VRM;
  const sec = isRecord(vrm) ? vrm.secondaryAnimation : undefined;
  if (!isRecord(sec) || !Array.isArray(sec.boneGroups)) return undefined;
  const nodes = gltf.nodes ?? [];

  const colliderGroups = (Array.isArray(sec.colliderGroups) ? sec.colliderGroups : []).map((g) => {
    if (!isRecord(g) || typeof g.node !== "number" || !Array.isArray(g.colliders)) return [];
    const node = g.node;
    return g.colliders.filter(isRecord).map((c) => {
      const [x, y, z] = vec(c.offset, [0, 0, 0]);
      return { node, offset: [x, y, -z] as [number, number, number], radius: num(c.radius, 0) };
    });
  });

  const chains: SpringChainSpec[] = [];
  for (const group of sec.boneGroups) {
    if (!isRecord(group) || !Array.isArray(group.bones)) continue;
    const [gx, gy, gz] = vec(group.gravityDir, [0, -1, 0]);
    const settings: SpringSettings = {
      stiffness: num(group.stiffiness ?? group.stiffness, 1),
      gravityPower: num(group.gravityPower, 0),
      gravityDir: new Vector3(gx, gy, -gz).normalize(),
      dragForce: num(group.dragForce, 0.4),
      hitRadius: num(group.hitRadius, 0.02),
    };
    const colliders = (Array.isArray(group.colliderGroups) ? group.colliderGroups : []).flatMap((i) =>
      typeof i === "number" ? colliderGroups[i] ?? [] : []
    );
    // Each listed bone is a root: it and every descendant are springs.
    for (const root of group.bones) {
      if (typeof root !== "number") continue;
      const joints: number[] = [];
      const visit = (i: number) => {
        joints.push(i);
        for (const c of nodes[i]?.children ?? []) visit(c);
      };
      visit(root);
      chains.push({ joints, settings, colliders });
    }
  }
  return chains;
}

/** Kinds of secondary bones recognised by name, with defaults that look natural for each. */
const EAR = /(^|[^a-z])(ear|mimi|kemomimi)/i;
const DETECTED_KINDS: { kind: string; pattern: RegExp; settings: Omit<SpringSettings, "gravityDir"> }[] = [
  // Animal ears: stiff, they flick and settle quickly.
  { kind: "ear", pattern: EAR, settings: { stiffness: 3.2, gravityPower: 0, dragForce: 0.6, hitRadius: 0.01 } },
  { kind: "tail", pattern: /tail|shippo/i, settings: { stiffness: 1.2, gravityPower: 0.1, dragForce: 0.35, hitRadius: 0.02 } },
  { kind: "skirt", pattern: /skirt|dress|sukato/i, settings: { stiffness: 1.6, gravityPower: 0.2, dragForce: 0.5, hitRadius: 0.03 } },
  { kind: "breast", pattern: /breast|bust|boob|oppai|mune/i, settings: { stiffness: 2.6, gravityPower: 0.05, dragForce: 0.6, hitRadius: 0.02 } },
  { kind: "hat", pattern: /hat|cap|brim|hood/i, settings: { stiffness: 3.0, gravityPower: 0.05, dragForce: 0.6, hitRadius: 0.02 } },
  { kind: "hair", pattern: /hair|ahoge|bang|fringe|kami|ponytail|twintail|braid/i, settings: { stiffness: 1.3, gravityPower: 0.15, dragForce: 0.45, hitRadius: 0.02 } },
  { kind: "cloth", pattern: /ribbon|bow|ribon|cape|cloak|scarf|sleeve|sode|cloth|strap|string|chain|tassel|frill/i, settings: { stiffness: 1.2, gravityPower: 0.2, dragForce: 0.4, hitRadius: 0.02 } },
]; // prettier-ignore

/** Bones that look like secondary bones by name but are part of the rig (twist bones, IK targets, …). */
const NOT_SPRING =
  /twist|roll|(^|[^a-z])ik([^a-z]|$)|pole|target|eye|finger|thumb|toe|heel|knee|elbow|shoulder|clavicle/i;

/**
 * Plain glTF avatars (no VRM spring data): find chains of non-humanoid skin joints named like secondary bones
 * (see DETECTED_KINDS) hanging off the skeleton. A chain starts at the first matching joint below a joint that
 * isn't one; the whole subtree below it springs with that kind's settings.
 */
export function detectSpringChains(gltf: GLTFLike, mapping: HumanoidMapping): SpringChainSpec[] {
  const nodes = gltf.nodes ?? [];
  const jointSet = new Set<number>();
  for (const skin of gltf.skins ?? []) for (const j of skin.joints ?? []) jointSet.add(j);
  const humanoid = new Set(mapping.bones.values());

  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));

  // Humanoid bones are never springs, so plain body-part names (arm, leg, head) need no special handling here.
  const kindOf = (i: number) => {
    const name = nodes[i]?.name ?? "";
    if (!name || NOT_SPRING.test(name)) return undefined;
    return DETECTED_KINDS.find((k) => k.pattern.test(name));
  };

  const chains: SpringChainSpec[] = [];
  const claimed = new Set<number>();
  // Walk from each humanoid bone's descendants; anything under a humanoid bone that matches starts a chain.
  const roots = [...jointSet].filter((i) => !humanoid.has(i) && kindOf(i) && !claimed.has(i));
  for (const root of roots) {
    if (claimed.has(root)) continue;
    // Only start where the parent isn't itself a spring of some kind (so a chain is claimed by its top joint).
    const parent = parentOf.get(root);
    if (parent !== undefined && !humanoid.has(parent) && kindOf(parent) && jointSet.has(parent)) continue;
    // Must hang off the humanoid skeleton somewhere above.
    let a = parent;
    while (a !== undefined && !humanoid.has(a)) a = parentOf.get(a);
    if (a === undefined) continue;

    const kind = kindOf(root)!;
    const joints: number[] = [];
    // Only skin joints are simulated: helper nodes beside them (game rigs' "…_Handle", "…_end") would make every
    // joint look like a hub with several strands, which stays still.
    const visit = (i: number) => {
      if (humanoid.has(i) || claimed.has(i)) return;
      claimed.add(i);
      if (jointSet.has(i)) joints.push(i);
      for (const c of nodes[i]?.children ?? []) visit(c);
    };
    visit(root);
    if (joints.length === 0) continue;
    chains.push({
      joints,
      kind: kind.kind,
      settings: { ...kind.settings, gravityDir: new Vector3(0, -1, 0) },
      colliders: [],
    });
  }
  return chains;
}

/** The spring chains for an avatar from its glTF JSON, or [] if it has none. */
export function getSpringChains(gltf: GLTFLike, mapping: HumanoidMapping): SpringChainSpec[] {
  return parseVRM1Springs(gltf) ?? parseVRM0Springs(gltf) ?? detectSpringChains(gltf, mapping);
}

// --- Rig ------------------------------------------------------------------------------------------

/** Builds a spring rig on the animation object graph (in its rest pose). `objectFor` maps node index → object. */
export function createSpringRig(
  chains: SpringChainSpec[],
  objectFor: (nodeIndex: number) => Object3D | undefined,
  { facesNegativeZ = false }: { facesNegativeZ?: boolean } = {}
): SpringRig | undefined {
  const joints: SpringJoint[] = [];
  const seen = new Set<Object3D>();
  const earJoints: EarJoint[] = [];
  let ears = 0;

  for (const chain of chains) {
    const colliders: SpringCollider[] = [];
    for (const c of chain.colliders) {
      const node = objectFor(c.node);
      if (!node) continue;
      colliders.push(
        c.tail
          ? { node, kind: "capsule", offset: new Vector3(...c.offset), tail: new Vector3(...c.tail), radius: c.radius }
          : { node, kind: "sphere", offset: new Vector3(...c.offset), radius: c.radius }
      );
    }
    const objs = chain.joints.map(objectFor);
    const inChain = new Set(objs.filter((o): o is Object3D => !!o));
    const count = chain.lastIsTip ? objs.length - 1 : objs.length;
    const isEar = chain.kind === "ear" || (!chain.kind && EAR.test(objs[0]?.name ?? ""));
    const chainStart = joints.length;
    for (let i = 0; i < count; i++) {
      const bone = objs[i];
      if (!bone || seen.has(bone) || joints.length >= MAX_SPRING_JOINTS) continue;
      // A hub that several strands branch from (a hat's crown, a hair root) stays put; its strands swing. Swinging
      // it would move all of them as one rigid piece.
      if (bone.children.filter((c) => inChain.has(c)).length > 1) continue;
      // The tail: the next listed joint if it's a child, else the first child, else a virtual tail.
      const next = objs[i + 1];
      const child = next && next.parent === bone ? next : bone.children[0];
      const settings = Array.isArray(chain.settings) ? chain.settings[i] ?? chain.settings[0] : chain.settings;
      seen.add(bone);

      const initialLocalChildPosition = child
        ? child.position.clone()
        : bone.position.lengthSq() > 1e-10
        ? bone.position.clone().normalize().multiplyScalar(0.07)
        : new Vector3(0, 0.07, 0);
      if (initialLocalChildPosition.lengthSq() < 1e-12) continue;

      joints.push({
        bone,
        child,
        settings,
        colliders,
        initialLocalMatrix: new Matrix4().compose(bone.position, bone.quaternion, bone.scale),
        initialLocalRotation: bone.quaternion.clone(),
        boneAxis: initialLocalChildPosition.clone().normalize(),
        initialLocalChildPosition,
        currentTail: new Vector3(),
        prevTail: new Vector3(),
        initialized: false,
      });
    }
    if (isEar) {
      // The chain's first simulated joints (under any hub) fold; the rest of the ear follows as springs.
      const chainJoints = joints.slice(chainStart);
      // Game rigs put a tiny-scaled helper pivot at the ear's base (e.g. Umamusume's Sp_He_Ear0, scale 0.01):
      // fold the first full-size joint instead.
      const fullSize = chainJoints.filter((j) => {
        const scale = j.bone.getWorldScale(_earScale).x;
        return scale > 0.2 && scale < 5;
      });
      const candidates = fullSize.length > 0 ? fullSize : chainJoints;
      const bones = new Set(candidates.map((j) => j.bone));
      const firsts = candidates.filter((j) => {
        for (let p = j.bone.parent; p; p = p.parent) if (bones.has(p)) return false;
        return true;
      });
      for (const joint of firsts) {
        const folds = earFolds(joint, facesNegativeZ);
        if (folds) earJoints.push({ joint, ear: ears, ...folds, amount: 0, goal: 0, pose: "fold" });
      }
      if (firsts.length > 0) ears++;
    }
  }
  if (joints.length === 0) return undefined;
  const rig: SpringRig = { joints, lastRootPosition: new Vector3(), hasLastRoot: false };
  if (earJoints.length > 0) rig.ears = { joints: earJoints, ears, untilNext: 2 + Math.random() * 4, untilRelax: 0 };
  return rig;
}

/** Back (away from the face), and down. */
const _back = new Vector3();
const _earScale = new Vector3();
const _earDir = new Vector3();
const _earWorld = new Quaternion();
/** A folded ear points this far from back-and-down toward its rest direction (0 = all the way). */
const FOLD_KEEP = 0.2;

/**
 * The rest turns that fold an ear back and down (horses pin their ears back) and flick it (part way back and out),
 * computed in the rest pose the rig is built in, with the avatar facing +Z (or -Z).
 */
function earFolds(joint: SpringJoint, facesNegativeZ: boolean) {
  const bone = joint.bone;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_earWorld);
  const inverse = _earWorld.clone().invert();
  _back.set(0, -0.55, facesNegativeZ ? 0.85 : -0.85).normalize();
  const axisWorld = joint.boneAxis.clone().applyQuaternion(_earWorld);
  // Folded: mostly back-and-down, a little of the rest direction kept.
  _earDir.copy(_back).lerp(axisWorld, FOLD_KEEP).normalize().applyQuaternion(inverse);
  if (_earDir.lengthSq() < 1e-8) return undefined;
  const fold = new Quaternion().setFromUnitVectors(joint.boneAxis, _earDir.normalize());
  // Flicked: outward (away from the head's middle) and a bit back.
  const out = new Vector3().setFromMatrixPosition(bone.matrixWorld);
  out.set(Math.sign(out.x) || 1, 0, 0);
  _earDir.copy(axisWorld).addScaledVector(out, 0.7).addScaledVector(_back, 0.5).normalize().applyQuaternion(inverse);
  const flick = new Quaternion().setFromUnitVectors(joint.boneAxis, _earDir.normalize());
  return { fold, flick };
}

const _noTurn = new Quaternion();

/** Picks the next ear move now and then, and eases each ear toward where it should be. */
function updateEars(ears: EarMotion, dt: number, random: () => number) {
  ears.untilNext -= dt;
  ears.untilRelax -= dt;
  if (ears.untilRelax <= 0) for (const e of ears.joints) e.goal = 0;
  if (ears.untilNext <= 0) {
    if (random() < 0.55 || ears.ears < 2) {
      // Both ears pinned back for a moment.
      for (const e of ears.joints) {
        e.pose = "fold";
        e.goal = 0.75 + random() * 0.25;
      }
      ears.untilRelax = 0.7 + random() * 1.1;
    } else {
      // One ear flicks.
      const which = Math.floor(random() * ears.ears);
      for (const e of ears.joints) {
        if (e.ear !== which) continue;
        e.pose = "flick";
        e.goal = 1;
      }
      ears.untilRelax = 0.25 + random() * 0.25;
    }
    ears.untilNext = ears.untilRelax + 2.5 + random() * 6;
  }
  // Quick to move, a little slower to relax; the spring adds the overshoot.
  for (const e of ears.joints) {
    const rate = e.goal > e.amount ? 10 : 5;
    e.amount += (e.goal - e.amount) * (1 - Math.exp(-dt * rate));
    if (e.amount < 0.001 && e.goal === 0) {
      e.joint.restOffset = undefined;
      continue;
    }
    e.joint.restOffset ??= new Quaternion();
    e.joint.restOffset.copy(_noTurn).slerp(e.pose === "fold" ? e.fold : e.flick, e.amount);
  }
}

const _worldPos = new Vector3();
const _parentWorldRot = new Quaternion();
const _tmpQ = new Quaternion();
const _inertia = new Vector3();
const _stiff = new Vector3();
const _next = new Vector3();
const _tmpV = new Vector3();
const _tmpV2 = new Vector3();
const _localTarget = new Vector3();
const _m = new Matrix4();
const _mInv = new Matrix4();
const _cPos = new Vector3();
const _cTail = new Vector3();
const _rootPos = new Vector3();
const _identity = new Matrix4();

/** Longest step simulated at once; longer frames are split so springs don't explode on hitches. */
const MAX_STEP = 1 / 30;
/** The avatar moved further than this in one frame (teleport, respawn): reset springs to rest. */
const TELEPORT_DISTANCE = 2;

function worldBoneLength(joint: SpringJoint): number {
  _tmpV.copy(joint.initialLocalChildPosition).applyMatrix4(joint.bone.matrixWorld);
  return _tmpV.distanceTo(_worldPos.setFromMatrixPosition(joint.bone.matrixWorld));
}

function resetJoint(joint: SpringJoint) {
  joint.bone.quaternion.copy(joint.initialLocalRotation);
  joint.bone.updateMatrixWorld(true);
  joint.currentTail.copy(joint.initialLocalChildPosition).applyMatrix4(joint.bone.matrixWorld);
  joint.prevTail.copy(joint.currentTail);
  joint.initialized = true;
}

function collide(joint: SpringJoint, worldPos: Vector3, tail: Vector3, boneLength: number) {
  const radius = joint.settings.hitRadius;
  for (const c of joint.colliders) {
    const m = c.node.matrixWorld;
    _cPos.copy(c.offset).applyMatrix4(m);
    const scale = _tmpV2.setFromMatrixScale(m).x;
    let closest = _cPos;
    if (c.kind === "capsule") {
      _cTail.copy(c.tail).applyMatrix4(m);
      // Closest point on the capsule segment to the tail.
      _tmpV.subVectors(_cTail, _cPos);
      const lenSq = _tmpV.lengthSq();
      const t = lenSq > 0 ? Math.min(Math.max(_tmpV2.subVectors(tail, _cPos).dot(_tmpV) / lenSq, 0), 1) : 0;
      closest = _cTail.copy(_cPos).addScaledVector(_tmpV, t);
    }
    const r = radius + c.radius * scale;
    _tmpV.subVectors(tail, closest);
    const dist = _tmpV.length();
    if (dist > 0 && dist < r) {
      tail.copy(closest).addScaledVector(_tmpV, r / dist);
      // Keep the bone length.
      tail.sub(worldPos).normalize().multiplyScalar(boneLength).add(worldPos);
    }
  }
}

function stepJoint(joint: SpringJoint, dt: number, floorY: number) {
  const { bone, settings } = joint;
  const parent = bone.parent;
  const parentWorld = parent ? parent.matrixWorld : _identity;

  _worldPos.setFromMatrixPosition(bone.matrixWorld);
  parentWorld.decompose(_tmpV, _parentWorldRot, _tmpV2);
  const boneLength = worldBoneLength(joint);

  // Verlet: inertia (with drag) + stiffness toward the rest direction + gravity.
  _inertia.subVectors(joint.currentTail, joint.prevTail).multiplyScalar(1 - settings.dragForce);
  _tmpQ.copy(_parentWorldRot).multiply(joint.initialLocalRotation);
  if (joint.restOffset) _tmpQ.multiply(joint.restOffset);
  _stiff
    .copy(joint.boneAxis)
    .applyQuaternion(_tmpQ)
    .multiplyScalar(dt * settings.stiffness);
  _next
    .copy(joint.currentTail)
    .add(_inertia)
    .add(_stiff)
    .addScaledVector(settings.gravityDir, dt * settings.gravityPower);

  // Keep the bone length, then push out of colliders.
  _next.sub(_worldPos).normalize().multiplyScalar(boneLength).add(_worldPos);
  if (joint.colliders.length > 0) collide(joint, _worldPos, _next, boneLength);
  // The ground under the avatar's feet: a tail or long hair lies on it (lying down) instead of sinking through.
  const floor = floorY + settings.hitRadius;
  if (_next.y < floor) {
    // Keep the horizontal direction, put the end on the floor (or straight up if the joint itself is too low).
    const dy = Math.min(Math.max(floor - _worldPos.y, -boneLength), boneLength);
    const across = Math.sqrt(boneLength * boneLength - dy * dy);
    _tmpV.set(_next.x - _worldPos.x, 0, _next.z - _worldPos.z);
    if (_tmpV.lengthSq() < 1e-12) _tmpV.set(1, 0, 0);
    _next.copy(_worldPos).addScaledVector(_tmpV.normalize(), across);
    _next.y = _worldPos.y + dy;
  }

  joint.prevTail.copy(joint.currentTail);
  joint.currentTail.copy(_next);

  // Rotate the joint so its axis points at the new tail.
  _m.multiplyMatrices(parentWorld, joint.initialLocalMatrix);
  _mInv.copy(_m).invert();
  _localTarget.copy(_next).applyMatrix4(_mInv).normalize();
  _tmpQ.setFromUnitVectors(joint.boneAxis, _localTarget);
  bone.quaternion.copy(joint.initialLocalRotation).multiply(_tmpQ);
  bone.updateMatrixWorld(true);
}

/**
 * Advances the springs. `root` is the animation graph's root (the avatar node); `rootWorldMatrix` is that
 * node's world matrix in the engine (column-major), so springs react to the avatar moving through the world.
 */
export function updateSpringRig(
  rig: SpringRig,
  root: Object3D,
  rootWorldMatrix: ArrayLike<number>,
  dt: number,
  random: () => number = Math.random
) {
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(rootWorldMatrix as number[]);
  // The mixer just wrote the animated pose; springs start from their rest rotation each frame.
  for (const joint of rig.joints) joint.bone.quaternion.copy(joint.initialLocalRotation);
  root.updateMatrixWorld(true);

  _rootPos.setFromMatrixPosition(root.matrix);
  const teleported = rig.hasLastRoot && _rootPos.distanceTo(rig.lastRootPosition) > TELEPORT_DISTANCE;
  rig.lastRootPosition.copy(_rootPos);
  rig.hasLastRoot = true;

  if (!(dt > 0)) return;
  if (rig.ears) updateEars(rig.ears, dt, random);
  const steps = Math.min(Math.ceil(dt / MAX_STEP), 4);
  const step = Math.min(dt / steps, MAX_STEP);

  for (const joint of rig.joints) {
    if (!joint.initialized || teleported) resetJoint(joint);
  }
  for (let s = 0; s < steps; s++) {
    // Re-pose each pass so later passes start from the rest rotation like the first.
    if (s > 0) {
      for (const joint of rig.joints) joint.bone.quaternion.copy(joint.initialLocalRotation);
      root.updateMatrixWorld(true);
    }
    for (const joint of rig.joints) stepJoint(joint, step, _rootPos.y);
  }
}
