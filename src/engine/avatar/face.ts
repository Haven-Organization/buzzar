/**
 * Buzzar: avatar faces come alive: eyes blink and look at nearby players.
 *
 * Blinking, from (first match wins):
 * 1. VRM 1.0 expressions (`blink`, else `blinkLeft` + `blinkRight`) and VRM 0.x blend shape groups (`blink`,
 *    else `blink_l` + `blink_r`): morph target binds.
 * 2. Morph targets named like a blink (Blink, eyes_close, Fcl_EYE_Close, まばたき, ARKit eyeBlinkLeft/Right…).
 * 3. Eyelid bones (rigs from games, e.g. "eyelid_up_L" / "eyelid_lo_L"): upper lids slide down to the lower ones.
 *
 * Looking, from VRM look-at data (bone type) or eye bones (humanoid leftEye/rightEye, or named "eyeball"…):
 * the eyes turn toward the nearest player's head in front of the avatar, within natural limits, and otherwise
 * make small random movements around straight ahead.
 *
 * Runs right after the animation mixer (and spring bones), on the three.js animation graph for bones and on the
 * nodes' morph weights for blend shapes. Each viewer animates everyone locally; nothing is networked.
 */
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

import type { HumanoidMapping } from "./humanoid";

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

interface GLTFLike {
  nodes?: { name?: string; mesh?: number; children?: number[] }[];
  meshes?: { name?: string; extras?: AnyRecord; primitives?: { extras?: AnyRecord; targets?: unknown[] }[] }[];
  extensions?: AnyRecord;
}

/** A morph target to drive: on every node that uses `mesh` (VRM 0.x, names) or on `node` (VRM 1.0). */
export interface MorphBindSpec {
  node?: number;
  mesh?: number;
  index: number;
  /** 0–1 */
  weight: number;
}

export interface LidSpec {
  /** Upper lid bones and how far (in their parent's space) each moves when fully closed. */
  moves: { node: number; delta: [number, number, number] }[];
}

export interface LookRange {
  /** Degrees the eyes turn at most, left/right and up/down. */
  yaw: number;
  pitchUp: number;
  pitchDown: number;
}

export interface FaceSpec {
  blink: MorphBindSpec[];
  lids?: LidSpec;
  eyes: number[];
  look: LookRange;
}

const DEFAULT_LOOK: LookRange = { yaw: 12, pitchUp: 8, pitchDown: 10 };

// --- Parsing --------------------------------------------------------------------------------------

function vrm1Blink(gltf: GLTFLike): MorphBindSpec[] | undefined {
  const vrm = gltf.extensions?.VRMC_vrm;
  if (!isRecord(vrm) || !isRecord(vrm.expressions) || !isRecord(vrm.expressions.preset)) return undefined;
  const preset = vrm.expressions.preset as AnyRecord;
  const binds = (name: string) => {
    const e = preset[name];
    if (!isRecord(e) || !Array.isArray(e.morphTargetBinds)) return [];
    return e.morphTargetBinds
      .filter(isRecord)
      .filter((b) => typeof b.node === "number" && typeof b.index === "number")
      .map((b) => ({ node: b.node as number, index: b.index as number, weight: num(b.weight, 1) }));
  };
  const both = binds("blink");
  return both.length > 0 ? both : [...binds("blinkLeft"), ...binds("blinkRight")];
}

function vrm0Blink(gltf: GLTFLike): MorphBindSpec[] | undefined {
  const vrm = gltf.extensions?.VRM;
  const master = isRecord(vrm) ? vrm.blendShapeMaster : undefined;
  if (!isRecord(master) || !Array.isArray(master.blendShapeGroups)) return undefined;
  const groups = master.blendShapeGroups.filter(isRecord);
  const binds = (preset: string) => {
    const g = groups.find((x) => String(x.presetName ?? "").toLowerCase() === preset);
    if (!g || !Array.isArray(g.binds)) return [];
    return g.binds
      .filter(isRecord)
      .filter((b) => typeof b.mesh === "number" && typeof b.index === "number")
      .map((b) => ({ mesh: b.mesh as number, index: b.index as number, weight: num(b.weight, 100) / 100 }));
  };
  const both = binds("blink");
  return both.length > 0 ? both : [...binds("blink_l"), ...binds("blink_r")];
}

const BLINK_NAME = /(^|[^a-z])(blink|まばたき)|eyes?_?close|close_?eyes?|eyeblink/i;
const NOT_BLINK = /half|joy|fun|angry|sorrow|sad|surprise|smile|wink|happy|relax|ura|>/i;
const SIDED = /(^|[^a-z])(l|r|left|right)([^a-z]|$)|(left|right)$|_[lr]$/i;

/** Morph target names from the usual places exporters put them. */
function targetNames(mesh: NonNullable<GLTFLike["meshes"]>[number]): string[] {
  const fromMesh = mesh.extras?.targetNames;
  if (Array.isArray(fromMesh)) return fromMesh.map(String);
  const fromPrim = mesh.primitives?.[0]?.extras?.targetNames;
  if (Array.isArray(fromPrim)) return fromPrim.map(String);
  return [];
}

function namedBlink(gltf: GLTFLike): MorphBindSpec[] {
  const both: MorphBindSpec[] = [];
  const sided: MorphBindSpec[] = [];
  (gltf.meshes ?? []).forEach((mesh, meshIndex) => {
    targetNames(mesh).forEach((name, index) => {
      if (!BLINK_NAME.test(name) || NOT_BLINK.test(name)) return;
      (SIDED.test(name) ? sided : both).push({ mesh: meshIndex, index, weight: 1 });
    });
  });
  // Prefer a both-eyes shape; with only per-eye shapes, drive them all.
  const firstPerMesh = new Map<number, MorphBindSpec>();
  for (const b of both) if (!firstPerMesh.has(b.mesh!)) firstPerMesh.set(b.mesh!, b);
  return firstPerMesh.size > 0 ? [...firstPerMesh.values()] : sided;
}

const LID = /lid|mabuta/i;
const LID_UP = /up|upper|top/i;
const LID_LO = /(^|[^a-z])lo|low|bottom|down|under/i;
const LEFT = /(^|[^a-z])(l|left)([^a-z]|$)|left/i;
const EYEBALL = /eye_?ball|(^|[^a-z])eye_?[lr]([^a-z]|$)|(left|right)_?eye|eye_?(left|right)/i;
const NOT_EYEBALL = /lid|brow|lash|corner|co_|eyeco|highlight|gaoguang|look|target|end$/i;

/**
 * Eyelid bones: each upper-lid bone slides most of the way to the nearest lower-lid bone on the same side.
 * `restWorld(i)` gives a node's rest position in avatar space; `toParent(i, v)` turns an avatar-space offset into
 * the node's parent space.
 */
export function detectLids(
  gltf: GLTFLike,
  restWorld: (node: number) => Vector3 | undefined,
  toParent: (node: number, offset: Vector3) => Vector3 | undefined
): LidSpec | undefined {
  const nodes = gltf.nodes ?? [];
  const lids = nodes.map((n, i) => ({ i, name: n.name ?? "" })).filter((n) => LID.test(n.name));
  const up = lids.filter((n) => LID_UP.test(n.name) && !LID_LO.test(n.name.replace(/lid/i, "")));
  const lo = lids.filter((n) => LID_LO.test(n.name.replace(/lid/i, "")) && !LID_UP.test(n.name));
  if (up.length === 0 || lo.length === 0) return undefined;

  const moves: LidSpec["moves"] = [];
  for (const u of up) {
    const uPos = restWorld(u.i);
    if (!uPos) continue;
    const side = LEFT.test(u.name);
    let best: Vector3 | undefined;
    let bestDist = Infinity;
    for (const l of lo) {
      if (LEFT.test(l.name) !== side) continue;
      const lPos = restWorld(l.i);
      if (!lPos) continue;
      const d = Math.hypot(lPos.x - uPos.x, lPos.z - uPos.z);
      if (d < bestDist) {
        bestDist = d;
        best = lPos;
      }
    }
    if (!best || best.y >= uPos.y) continue;
    // Slide down to just above the lower lid; ease forward a little so the lid stays over the eyeball's curve.
    const drop = best.y - uPos.y;
    const offset = new Vector3(0, drop * 0.88, 0);
    const delta = toParent(u.i, offset);
    if (delta) moves.push({ node: u.i, delta: [delta.x, delta.y, delta.z] });
  }
  return moves.length > 0 ? { moves } : undefined;
}

function lookRange(gltf: GLTFLike): LookRange {
  const v1 = gltf.extensions?.VRMC_vrm;
  if (isRecord(v1) && isRecord(v1.lookAt)) {
    const out = (k: string, d: number) => {
      const m = (v1.lookAt as AnyRecord)[k];
      return isRecord(m) ? num(m.outputScale, d) : d;
    };
    return {
      yaw: Math.max(out("rangeMapHorizontalOuter", DEFAULT_LOOK.yaw), 1),
      pitchUp: Math.max(out("rangeMapVerticalUp", DEFAULT_LOOK.pitchUp), 1),
      pitchDown: Math.max(out("rangeMapVerticalDown", DEFAULT_LOOK.pitchDown), 1),
    };
  }
  const v0 = gltf.extensions?.VRM;
  const fp = isRecord(v0) && isRecord(v0.firstPerson) ? v0.firstPerson : undefined;
  if (fp) {
    const out = (k: string, d: number) => (isRecord(fp[k]) ? num((fp[k] as AnyRecord).yRange, d) : d);
    return {
      yaw: Math.max(out("lookAtHorizontalOuter", DEFAULT_LOOK.yaw), 1),
      pitchUp: Math.max(out("lookAtVerticalUp", DEFAULT_LOOK.pitchUp), 1),
      pitchDown: Math.max(out("lookAtVerticalDown", DEFAULT_LOOK.pitchDown), 1),
    };
  }
  return DEFAULT_LOOK;
}

function lookUsesBones(gltf: GLTFLike): boolean {
  const v1 = gltf.extensions?.VRMC_vrm;
  if (isRecord(v1) && isRecord(v1.lookAt) && v1.lookAt.type === "expression") return false;
  const v0 = gltf.extensions?.VRM;
  if (isRecord(v0) && isRecord(v0.firstPerson) && v0.firstPerson.lookAtTypeName === "BlendShape") return false;
  return true;
}

export function detectEyes(gltf: GLTFLike, mapping: HumanoidMapping): number[] {
  if (!lookUsesBones(gltf)) return [];
  const left = mapping.bones.get("leftEye");
  const right = mapping.bones.get("rightEye");
  if (left !== undefined && right !== undefined) return [left, right];
  return (gltf.nodes ?? [])
    .map((n, i) => ({ i, name: n.name ?? "" }))
    .filter((n) => EYEBALL.test(n.name) && !NOT_EYEBALL.test(n.name))
    .slice(0, 2)
    .map((n) => n.i);
}

export function getFaceSpec(
  gltf: GLTFLike,
  mapping: HumanoidMapping,
  restWorld: (node: number) => Vector3 | undefined,
  toParent: (node: number, offset: Vector3) => Vector3 | undefined
): FaceSpec {
  const blink = vrm1Blink(gltf) ?? vrm0Blink(gltf) ?? [];
  const named = blink.length > 0 ? blink : namedBlink(gltf);
  return {
    blink: named,
    lids: named.length > 0 ? undefined : detectLids(gltf, restWorld, toParent),
    eyes: detectEyes(gltf, mapping),
    look: lookRange(gltf),
  };
}

// --- Blink timing ----------------------------------------------------------------------------------

/** Closing 60 ms, closed 30 ms, opening 80 ms. */
const BLINK_CLOSE = 0.06;
const BLINK_HOLD = 0.03;
const BLINK_OPEN = 0.08;
const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;

export class Blinker {
  private untilNext: number;
  private t = -1;

  constructor(private random: () => number = Math.random) {
    this.untilNext = 0.5 + random() * 3;
  }

  /** Advances by `dt` seconds; returns how closed the eyes are (0 open – 1 closed). */
  update(dt: number): number {
    if (this.t < 0) {
      this.untilNext -= dt;
      if (this.untilNext > 0) return 0;
      this.t = 0;
    } else {
      this.t += dt;
    }
    const t = this.t;
    if (t >= BLINK_TOTAL) {
      this.t = -1;
      // Usually 2–6 s apart; now and then a quick double blink.
      this.untilNext = this.random() < 0.12 ? 0.12 : 2 + this.random() * 4;
      return 0;
    }
    if (t < BLINK_CLOSE) return smooth(t / BLINK_CLOSE);
    if (t < BLINK_CLOSE + BLINK_HOLD) return 1;
    return 1 - smooth((t - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN);
  }
}

const smooth = (x: number) => x * x * (3 - 2 * x);

// --- Runtime ---------------------------------------------------------------------------------------

export interface FaceRigInput {
  spec: FaceSpec;
  /** Animation-graph object for a node index. */
  objectFor: (node: number) => Object3D | undefined;
  /**
   * Morph weight arrays to write for a bind (every instance node using that mesh, or that node). Called lazily,
   * from the first update on: the loader attaches morph weights after the animation graph is built.
   */
  weightsFor: (bind: MorphBindSpec) => Float32Array[];
  /** Model space: which way the avatar faces (+Z for glTF/VRM 1.0/Mixamo, -Z for VRM 0.x). */
  facesNegativeZ: boolean;
}

interface EyeJoint {
  bone: Object3D;
  rest: Quaternion;
  /** Forward and up of the face, in the eye's parent space at rest. */
  forward: Vector3;
  up: Vector3;
}

export interface FaceRig {
  blinker: Blinker;
  binds: { weights: Float32Array[]; index: number; weight: number }[];
  /** Blink binds not resolved to morph weights yet (see FaceRigInput.weightsFor). */
  pendingBinds?: { specs: MorphBindSpec[]; weightsFor: FaceRigInput["weightsFor"]; tries: number };
  lids: { bone: Object3D; rest: Vector3; delta: Vector3 }[];
  eyes: EyeJoint[];
  look: LookRange;
  /** Current gaze in degrees (smoothed) and the wandering offset. */
  yaw: number;
  pitch: number;
  wanderYaw: number;
  wanderPitch: number;
  untilWander: number;
  /** Override for testing: force eyes closed (1) or open (0). */
  forceBlink?: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _right = new Vector3();
const _dir = new Vector3();

export function createFaceRig({ spec, objectFor, weightsFor, facesNegativeZ }: FaceRigInput): FaceRig | undefined {
  const lids = (spec.lids?.moves ?? [])
    .map((m) => {
      const bone = objectFor(m.node);
      return bone && { bone, rest: bone.position.clone(), delta: new Vector3(...m.delta) };
    })
    .filter((l): l is NonNullable<typeof l> => !!l);

  // Face forward/up in avatar (root) space, carried into each eye's parent space at rest.
  const forward = new Vector3(0, 0, facesNegativeZ ? -1 : 1);
  const up = new Vector3(0, 1, 0);
  const eyes: EyeJoint[] = [];
  for (const node of spec.eyes) {
    const bone = objectFor(node);
    if (!bone?.parent) continue;
    bone.parent.updateWorldMatrix(true, false);
    _q.setFromRotationMatrix(_m.extractRotation(bone.parent.matrixWorld)).invert();
    eyes.push({
      bone,
      rest: bone.quaternion.clone(),
      forward: forward.clone().applyQuaternion(_q).normalize(),
      up: up.clone().applyQuaternion(_q).normalize(),
    });
  }

  if (spec.blink.length === 0 && lids.length === 0 && eyes.length === 0) return undefined;
  return {
    blinker: new Blinker(),
    binds: [],
    pendingBinds: spec.blink.length > 0 ? { specs: spec.blink, weightsFor, tries: 0 } : undefined,
    lids,
    eyes,
    look: spec.look,
    yaw: 0,
    pitch: 0,
    wanderYaw: 0,
    wanderPitch: 0,
    untilWander: 1,
  };
}

/** Beyond this, nobody is "near" enough to look at. */
const LOOK_DISTANCE = 4;
/** Only look at people within this angle of where the face points (degrees). */
const LOOK_FOV = 70;
const DEG = Math.PI / 180;

function resolveBinds(rig: FaceRig) {
  const pending = rig.pendingBinds;
  if (!pending) return;
  const binds = pending.specs
    .map((b) => ({ weights: pending.weightsFor(b), index: b.index, weight: b.weight }))
    .filter((b) => b.weights.length > 0);
  // Give the loader a few frames; then stop looking (the avatar has no usable morph targets).
  if (binds.length > 0 || ++pending.tries > 10) {
    rig.binds = binds;
    rig.pendingBinds = undefined;
  }
}

function setBlink(rig: FaceRig, closed: number) {
  for (const b of rig.binds) for (const w of b.weights) w[b.index] = closed * b.weight;
  for (const l of rig.lids) l.bone.position.copy(l.rest).addScaledVector(l.delta, closed);
}

/**
 * Advances blinking and gaze. `root` is the animation graph root, already carrying the avatar's world matrix with
 * up-to-date world matrices (see updateSpringRig / syncRootMatrix); `targets` are world positions of other
 * players' heads.
 */
export function updateFaceRig(
  rig: FaceRig,
  dt: number,
  targets: Iterable<ArrayLike<number>>,
  random: () => number = Math.random
) {
  if (rig.pendingBinds) resolveBinds(rig);
  setBlink(rig, rig.forceBlink ?? rig.blinker.update(dt));
  if (rig.eyes.length === 0) return;

  // Wander: small random glances every 1–3 s.
  rig.untilWander -= dt;
  if (rig.untilWander <= 0) {
    rig.untilWander = 1 + random() * 2;
    rig.wanderYaw = (random() * 2 - 1) * rig.look.yaw * 0.4;
    rig.wanderPitch = (random() * 2 - 1) * rig.look.pitchDown * 0.3;
  }

  // Pick the nearest head in front of the first eye.
  const eye = rig.eyes[0];
  const parent = eye.bone.parent!;
  _m.copy(parent.matrixWorld).invert();
  const eyePos = _v2.copy(eye.bone.position);
  let goalYaw = rig.wanderYaw;
  let goalPitch = rig.wanderPitch;
  let bestDist = LOOK_DISTANCE;
  _right.crossVectors(eye.up, eye.forward).normalize();
  for (const t of targets) {
    _v.set(t[0], t[1], t[2]).applyMatrix4(_m); // into the eye's parent space
    _dir.subVectors(_v, eyePos);
    const dist = _dir.length() * _v.setFromMatrixScale(parent.matrixWorld).x;
    if (dist < 0.3 || dist > bestDist) continue;
    _dir.normalize();
    const fwd = _dir.dot(eye.forward);
    const yaw = Math.atan2(_dir.dot(_right), fwd) / DEG;
    const pitch = Math.asin(Math.min(1, Math.max(-1, _dir.dot(eye.up)))) / DEG;
    if (Math.abs(yaw) > LOOK_FOV || Math.abs(pitch) > LOOK_FOV) continue;
    bestDist = dist;
    // Natural eyes turn only part of the way; the rest would be a head turn.
    goalYaw = (Math.max(-LOOK_FOV, Math.min(LOOK_FOV, yaw)) / LOOK_FOV) * rig.look.yaw;
    goalPitch =
      pitch >= 0 ? (Math.min(pitch, LOOK_FOV) / LOOK_FOV) * rig.look.pitchUp : (pitch / LOOK_FOV) * rig.look.pitchDown;
  }

  // Eyes move fast (saccades): close most of the gap within ~50 ms.
  const k = 1 - Math.exp(-dt * 40);
  rig.yaw += (goalYaw - rig.yaw) * k;
  rig.pitch += (goalPitch - rig.pitch) * k;

  for (const e of rig.eyes) {
    _right.crossVectors(e.up, e.forward).normalize();
    // Yaw about the face's up axis, then pitch about its right axis (positive pitch looks up).
    _q.setFromAxisAngle(e.up, rig.yaw * DEG);
    _dir.copy(e.forward).applyQuaternion(_q);
    _q.setFromAxisAngle(_right.applyQuaternion(_q), -rig.pitch * DEG);
    _dir.applyQuaternion(_q);
    _q.setFromUnitVectors(e.forward, _dir.normalize());
    e.bone.quaternion.copy(_q).multiply(e.rest);
  }
}
