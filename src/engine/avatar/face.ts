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

/** Mouth shapes for lip sync, in VISEMES order (aa, ih, ou, ee, oh). */
export type MouthShapes = MorphBindSpec[][];

/**
 * Lip bones (rigs without mouth blend shapes): how far each moves, in its parent's space, when the mouth is fully
 * open, rounded ("ou") and spread ("ee"/"ih").
 */
export interface LipSpec {
  moves: {
    node: number;
    open: [number, number, number];
    round: [number, number, number];
    wide: [number, number, number];
  }[];
}

export interface FaceSpec {
  blink: MorphBindSpec[];
  lids?: LidSpec;
  eyes: number[];
  look: LookRange;
  /** Lip sync: blend shapes per viseme, else a jaw bone, else lip bones. */
  mouth?: MouthShapes;
  jaw?: number;
  lips?: LipSpec;
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

const VISEME_PRESETS_VRM1 = ["aa", "ih", "ou", "ee", "oh"];
const VISEME_PRESETS_VRM0 = ["a", "i", "u", "e", "o"];

function vrm1Mouth(gltf: GLTFLike): MouthShapes | undefined {
  const vrm = gltf.extensions?.VRMC_vrm;
  if (!isRecord(vrm) || !isRecord(vrm.expressions) || !isRecord(vrm.expressions.preset)) return undefined;
  const preset = vrm.expressions.preset as AnyRecord;
  const shapes = VISEME_PRESETS_VRM1.map((name) => {
    const e = preset[name];
    if (!isRecord(e) || !Array.isArray(e.morphTargetBinds)) return [];
    return e.morphTargetBinds
      .filter(isRecord)
      .filter((b) => typeof b.node === "number" && typeof b.index === "number")
      .map((b) => ({ node: b.node as number, index: b.index as number, weight: num(b.weight, 1) }));
  });
  return shapes.some((x) => x.length > 0) ? shapes : undefined;
}

function vrm0Mouth(gltf: GLTFLike): MouthShapes | undefined {
  const vrm = gltf.extensions?.VRM;
  const master = isRecord(vrm) ? vrm.blendShapeMaster : undefined;
  if (!isRecord(master) || !Array.isArray(master.blendShapeGroups)) return undefined;
  const groups = master.blendShapeGroups.filter(isRecord);
  const shapes = VISEME_PRESETS_VRM0.map((preset) => {
    const g = groups.find((x) => String(x.presetName ?? "").toLowerCase() === preset);
    if (!g || !Array.isArray(g.binds)) return [];
    return g.binds
      .filter(isRecord)
      .filter((b) => typeof b.mesh === "number" && typeof b.index === "number")
      .map((b) => ({ mesh: b.mesh as number, index: b.index as number, weight: num(b.weight, 100) / 100 }));
  });
  return shapes.some((x) => x.length > 0) ? shapes : undefined;
}

/** Blend shape names per viseme: VRoid (Fcl_MTH_A), VRChat (vrc.v_aa), MMD (あ), generic (mouth_a), ARKit. */
const VISEME_NAMES: RegExp[] = [
  /fcl_mth_a$|(^|[^a-z])v_aa$|(^|[^a-z])mouth_?a$|^a$|^あ$|^jawopen$/i,
  /fcl_mth_i$|(^|[^a-z])v_ih$|(^|[^a-z])mouth_?i$|^i$|^い$/i,
  /fcl_mth_u$|(^|[^a-z])v_ou$|(^|[^a-z])mouth_?u$|^u$|^う$|^mouthfunnel$|^mouthpucker$/i,
  /fcl_mth_e$|(^|[^a-z])v_ee$|(^|[^a-z])mouth_?e$|^e$|^え$/i,
  /fcl_mth_o$|(^|[^a-z])v_oh$|(^|[^a-z])mouth_?o$|^o$|^お$/i,
];

function namedMouth(gltf: GLTFLike): MouthShapes | undefined {
  const shapes: MouthShapes = VISEME_NAMES.map(() => []);
  (gltf.meshes ?? []).forEach((mesh, meshIndex) => {
    targetNames(mesh).forEach((name, index) => {
      const v = VISEME_NAMES.findIndex((re) => re.test(name));
      if (v >= 0) shapes[v].push({ mesh: meshIndex, index, weight: 1 });
    });
  });
  return shapes.some((x) => x.length > 0) ? shapes : undefined;
}

const JAW = /(^|[^a-z])jaw([^a-z]|$)|^jaw|_jaw|ago(_|$)/i;
const LIP = /lip/i;
const LIP_LOWER = /lo(wer)?_?lip|lip_?lo(wer)?|lolip|(^|[^a-z])lo([^a-z]|$)|under|bottom|down/i;
const LIP_UPPER = /up(per)?_?lip|lip_?up(per)?|uplip|(^|[^a-z])up([^a-z]|$)|top/i;
const LIP_CORNER = /co(rner)?_?lip|lip_?co(rner)?|colip|corner/i;

/**
 * Lip and teeth bones, moved in the mouth's own frame (left–right from the corners, so it works when the head is
 * turned or tilted in the rest pose), by fractions of the mouth's width. Tuned by rendering an avatar with
 * game-style face bones (lip corners, upper/lower lips, lower teeth) in Blender.
 */
const LIP_RULES = {
  corner: { open: [0, -0.12, 0], round: [-0.28, 0, 0.08], wide: [0.14, 0.04, 0] },
  lower: { open: [0, -0.42, 0], round: [-0.14, 0, 0.12], wide: [0, 0, 0] },
  upper: { open: [0, 0.06, 0], round: [-0.14, 0, 0.12], wide: [0, 0, 0] },
  teeth: { open: [0, -0.36, 0], round: [0, 0, 0], wide: [0, 0, 0] },
} as const;
const TEETH_LOWER = /(yachi|teeth|tooth|ha_?).*(lo|low|down|bottom|under)|(lo|lower|bottom).*(teeth|tooth)/i;

export type LipKind = keyof typeof LIP_RULES;
export interface LipBone {
  node: number;
  kind: LipKind;
}

/** Lip and teeth bones by name (rigs without mouth blend shapes). */
export function findLipBones(gltf: GLTFLike): LipBone[] {
  const kindOf = (name: string): LipKind | undefined => {
    if (TEETH_LOWER.test(name)) return "teeth";
    if (!LIP.test(name)) return undefined;
    if (LIP_CORNER.test(name)) return "corner";
    if (LIP_LOWER.test(name)) return "lower";
    if (LIP_UPPER.test(name)) return "upper";
    return undefined;
  };
  return topLipBones(
    gltf,
    (gltf.nodes ?? []).flatMap((n, i) => {
      const kind = kindOf(n.name ?? "");
      return kind ? [{ node: i, kind }] : [];
    })
  );
}

/**
 * Drops lip bones whose parent (or any ancestor) is also listed: they move with it anyway. Rigs often give each lip
 * bone a "_end" tip several centimetres out; counted as lips, two corner tips became the "corners" of the mouth,
 * tilting its left-right axis so every lip moved askew (a lopsided mouth on Mint).
 */
export function topLipBones(gltf: GLTFLike, bones: LipBone[]): LipBone[] {
  const parent = new Map<number, number>();
  (gltf.nodes ?? []).forEach((n, i) => {
    for (const child of n.children ?? []) parent.set(child, i);
  });
  const listed = new Set(bones.map((b) => b.node));
  const underListed = (node: number) => {
    for (let p = parent.get(node), guard = 0; p !== undefined && guard < 256; p = parent.get(p), guard++) {
      if (listed.has(p)) return true;
    }
    return false;
  };
  return bones.filter((b) => !underListed(b.node));
}

export function detectLips(
  gltf: GLTFLike,
  restWorld: (node: number) => Vector3 | undefined,
  toParent: (node: number, offset: Vector3) => Vector3 | undefined,
  head?: number,
  chosen: LipBone[] = findLipBones(gltf)
): LipSpec | undefined {
  // Files baked before tips were left out can still list them.
  const bones = topLipBones(gltf, chosen)
    .map((b) => ({ i: b.node, kind: b.kind, pos: restWorld(b.node) }))
    .filter((b): b is typeof b & { pos: Vector3 } => !!b.pos);
  const lips = bones.filter((b) => b.kind !== "teeth");
  if (lips.length < 2) return undefined;

  // Mouth frame: right = from one corner to the other (or the widest pair of lip bones).
  const corners = lips.filter((b) => b.kind === "corner");
  const ends = corners.length >= 2 ? corners : lips;
  let a = ends[0];
  let b = ends[1];
  for (const x of ends) for (const y of ends) if (x.pos.distanceTo(y.pos) > a.pos.distanceTo(b.pos)) [a, b] = [x, y];
  const right = new Vector3().subVectors(b.pos, a.pos);
  const width = right.length();
  if (width < 1e-4) return undefined;
  right.normalize();
  const up = new Vector3(0, 1, 0).addScaledVector(right, -right.y).normalize();
  const mid = lips.reduce((acc, l) => acc.add(l.pos), new Vector3()).multiplyScalar(1 / lips.length);
  const forward = new Vector3().crossVectors(right, up).normalize();
  const headPos = head !== undefined ? restWorld(head) : undefined;
  if (headPos ? forward.dot(new Vector3().subVectors(mid, headPos)) < 0 : forward.z < 0) forward.negate();

  const toFrame = (v: readonly number[], side: number) =>
    new Vector3()
      .addScaledVector(right, v[0] * side)
      .addScaledVector(up, v[1])
      .addScaledVector(forward, v[2])
      .multiplyScalar(width);
  const moves: LipSpec["moves"] = [];
  for (const bone of bones) {
    // -1 at the right-hand corner … +1 at the left-hand one: corners move most, the middle not sideways at all.
    const side = Math.max(-1, Math.min(1, new Vector3().subVectors(bone.pos, mid).dot(right) / (width / 2)));
    const rule = LIP_RULES[bone.kind];
    const o = toParent(bone.i, toFrame(rule.open, side));
    const r = toParent(bone.i, toFrame(rule.round, side));
    const w = toParent(bone.i, toFrame(rule.wide, side));
    if (!o || !r || !w) continue;
    moves.push({ node: bone.i, open: [o.x, o.y, o.z], round: [r.x, r.y, r.z], wide: [w.x, w.y, w.z] });
  }
  return moves.length > 0 ? { moves } : undefined;
}

export function detectJaw(gltf: GLTFLike, mapping: HumanoidMapping): number | undefined {
  const jaw = mapping.bones.get("jaw" as never);
  if (jaw !== undefined) return jaw;
  const i = (gltf.nodes ?? []).findIndex((n) => JAW.test(n.name ?? "") && !/line|end$/i.test(n.name ?? ""));
  return i >= 0 ? i : undefined;
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
/** Upper and lower eyelid bones by name. */
export function findLidBones(gltf: GLTFLike): { upper: number[]; lower: number[] } {
  const lids = (gltf.nodes ?? []).map((n, i) => ({ i, name: n.name ?? "" })).filter((n) => LID.test(n.name));
  return {
    upper: lids.filter((n) => LID_UP.test(n.name) && !LID_LO.test(n.name.replace(/lid/i, ""))).map((n) => n.i),
    lower: lids.filter((n) => LID_LO.test(n.name.replace(/lid/i, "")) && !LID_UP.test(n.name)).map((n) => n.i),
  };
}

export function detectLids(
  gltf: GLTFLike,
  restWorld: (node: number) => Vector3 | undefined,
  toParent: (node: number, offset: Vector3) => Vector3 | undefined,
  chosen: { upper: number[]; lower: number[] } = findLidBones(gltf)
): LidSpec | undefined {
  const nodes = gltf.nodes ?? [];
  const named = (i: number) => ({ i, name: nodes[i]?.name ?? "" });
  const up = chosen.upper.map(named);
  const lo = chosen.lower.map(named);
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

/**
 * Buzzar: the face parts an avatar file chooses for itself (HAVEN_avatar_motion `face`): which morph targets blink and
 * shape the mouth, and which bones are the eyes, eyelids, jaw and lips. Any part it gives replaces Buzzar's guess; a
 * part it leaves out is still detected. Bone movements are still worked out from the rest pose when the avatar loads.
 */
export interface HavenFace {
  blink?: MorphBindSpec[];
  /**
   * For rigs without blink shapes: which bones are the upper and lower lids (Buzzar slides each upper one down to the
   * nearest lower one), or `moves`: exactly how far each bone moves, in its parent's space, when the eyes are shut.
   */
  eyelids?: { upper: number[]; lower: number[]; moves?: LidSpec["moves"] };
  eyes?: number[];
  look?: LookRange;
  /** Lip sync: give one of `mouth` (blend shapes per viseme: aa, ih, ou, ee, oh), `jaw` or `lips`; the others none. */
  mouth?: MouthShapes;
  jaw?: number;
  lips?: LipBone[];
}

const LIP_KINDS: LipKind[] = ["corner", "upper", "lower", "teeth"];

export function parseHavenFace(gltf: GLTFLike): HavenFace | undefined {
  const ext = gltf.extensions?.HAVEN_avatar_motion;
  const face = isRecord(ext) ? ext.face : undefined;
  if (!isRecord(face)) return undefined;
  const nodeCount = gltf.nodes?.length ?? 0;
  const meshCount = gltf.meshes?.length ?? 0;
  const isNode = (i: unknown): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < nodeCount;
  const nodeList = (v: unknown) => (Array.isArray(v) ? v.filter(isNode) : undefined);
  const binds = (v: unknown): MorphBindSpec[] | undefined =>
    Array.isArray(v)
      ? v.filter(isRecord).flatMap((b): MorphBindSpec[] => {
          const index = b.index;
          if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return [];
          const weight = Math.min(1, Math.max(0, num(b.weight, 1)));
          if (isNode(b.node)) return [{ node: b.node, index, weight }];
          if (typeof b.mesh === "number" && Number.isInteger(b.mesh) && b.mesh >= 0 && b.mesh < meshCount)
            return [{ mesh: b.mesh, index, weight }];
          return [];
        })
      : undefined;

  const out: HavenFace = {};
  const blink = binds(face.blink);
  if (blink) out.blink = blink;
  if (isRecord(face.eyelids)) {
    out.eyelids = { upper: nodeList(face.eyelids.upper) ?? [], lower: nodeList(face.eyelids.lower) ?? [] };
    if (Array.isArray(face.eyelids.moves)) {
      out.eyelids.moves = face.eyelids.moves.filter(isRecord).flatMap((m) => {
        const d = m.delta;
        return isNode(m.node) &&
          Array.isArray(d) &&
          d.length === 3 &&
          d.every((x) => typeof x === "number" && Number.isFinite(x))
          ? [{ node: m.node, delta: [d[0], d[1], d[2]] as [number, number, number] }]
          : [];
      });
    }
  }
  const eyes = nodeList(face.eyes);
  if (eyes) out.eyes = eyes;
  if (isRecord(face.look)) {
    out.look = {
      yaw: Math.max(num(face.look.yaw, DEFAULT_LOOK.yaw), 1),
      pitchUp: Math.max(num(face.look.pitchUp, DEFAULT_LOOK.pitchUp), 1),
      pitchDown: Math.max(num(face.look.pitchDown, DEFAULT_LOOK.pitchDown), 1),
    };
  }
  if (Array.isArray(face.mouth))
    out.mouth = VISEME_NAMES.map((_, v) => binds(face.mouth && (face.mouth as unknown[])[v]) ?? []);
  if (isNode(face.jaw)) out.jaw = face.jaw;
  if (Array.isArray(face.lips)) {
    out.lips = face.lips
      .filter(isRecord)
      .flatMap((l) =>
        isNode(l.node) && LIP_KINDS.includes(l.kind as LipKind) ? [{ node: l.node, kind: l.kind as LipKind }] : []
      );
  }
  return out;
}

/** Whether a face block says how the mouth moves (then nothing else is detected for lip sync). */
const givesMouth = (face: HavenFace | undefined) => !!face && ("mouth" in face || "jaw" in face || "lips" in face);
/** Whether a face block says how the eyes close. */
const givesBlink = (face: HavenFace | undefined) => !!face && ("blink" in face || "eyelids" in face);

/** The face parts Buzzar would choose for an avatar today (for writing into its file; see bake-gltf.ts). */
export function bakeFace(gltf: GLTFLike, mapping: HumanoidMapping): HavenFace {
  const own = parseHavenFace(gltf);
  const blink = givesBlink(own) ? own?.blink ?? [] : vrm1Blink(gltf) ?? vrm0Blink(gltf) ?? namedBlink(gltf);
  const lids: HavenFace["eyelids"] = givesBlink(own) ? own?.eyelids : blink.length > 0 ? undefined : findLidBones(gltf);
  const mouth = givesMouth(own) ? own?.mouth : vrm1Mouth(gltf) ?? vrm0Mouth(gltf) ?? namedMouth(gltf);
  const jaw = givesMouth(own) ? own?.jaw : mouth ? undefined : detectJaw(gltf, mapping);
  const lips = givesMouth(own) ? own?.lips : mouth || jaw !== undefined ? undefined : findLipBones(gltf);
  const out: HavenFace = {
    blink,
    eyes: own?.eyes ?? detectEyes(gltf, mapping),
    look: own?.look ?? lookRange(gltf),
  };
  if (lids && (lids.upper.length > 0 || lids.lower.length > 0 || lids.moves?.length)) out.eyelids = lids;
  if (mouth) out.mouth = mouth;
  if (jaw !== undefined) out.jaw = jaw;
  if (lips && lips.length > 0) out.lips = lips;
  return out;
}

export function getFaceSpec(
  gltf: GLTFLike,
  mapping: HumanoidMapping,
  restWorld: (node: number) => Vector3 | undefined,
  toParent: (node: number, offset: Vector3) => Vector3 | undefined
): FaceSpec {
  const own = parseHavenFace(gltf);
  const head = mapping.bones.get("head");

  let blink: MorphBindSpec[];
  let lids: LidSpec | undefined;
  if (givesBlink(own)) {
    blink = own?.blink ?? [];
    lids = own?.eyelids?.moves
      ? own.eyelids.moves.length > 0
        ? { moves: own.eyelids.moves }
        : undefined
      : own?.eyelids
      ? detectLids(gltf, restWorld, toParent, own.eyelids)
      : undefined;
  } else {
    const vrm = vrm1Blink(gltf) ?? vrm0Blink(gltf) ?? [];
    blink = vrm.length > 0 ? vrm : namedBlink(gltf);
    lids = blink.length > 0 ? undefined : detectLids(gltf, restWorld, toParent);
  }

  let mouth: MouthShapes | undefined;
  let jaw: number | undefined;
  let lips: LipSpec | undefined;
  if (givesMouth(own)) {
    mouth = own?.mouth;
    jaw = own?.jaw;
    lips = own?.lips ? detectLips(gltf, restWorld, toParent, head, own.lips) : undefined;
  } else {
    mouth = vrm1Mouth(gltf) ?? vrm0Mouth(gltf) ?? namedMouth(gltf);
    jaw = mouth ? undefined : detectJaw(gltf, mapping);
    lips = mouth || jaw !== undefined ? undefined : detectLips(gltf, restWorld, toParent, head);
  }

  return {
    blink,
    lids,
    eyes: own?.eyes ?? detectEyes(gltf, mapping),
    look: own?.look ?? lookRange(gltf),
    mouth,
    jaw,
    lips,
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

/** Bind channels: 0 = blink, 1–5 = visemes (aa, ih, ou, ee, oh). */
const BLINK_CHANNEL = 0;

export interface FaceRig {
  blinker: Blinker;
  binds: { weights: Float32Array[]; index: number; weight: number; channel: number }[];
  /** Binds not resolved to morph weights yet (see FaceRigInput.weightsFor). */
  pendingBinds?: {
    specs: (MorphBindSpec & { channel: number })[];
    weightsFor: FaceRigInput["weightsFor"];
    tries: number;
  };
  jaw?: { bone: Object3D; rest: Quaternion; right: Vector3 };
  lips: { bone: Object3D; rest: Vector3; open: Vector3; round: Vector3; wide: Vector3 }[];
  /** Whether the face has anything to lip sync. */
  hasMouth: boolean;
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

  const bindSpecs = [
    ...spec.blink.map((b) => ({ ...b, channel: BLINK_CHANNEL })),
    ...(spec.mouth ?? []).flatMap((shape, v) => shape.map((b) => ({ ...b, channel: 1 + v }))),
  ];

  let jaw: FaceRig["jaw"];
  const jawBone = spec.jaw !== undefined ? objectFor(spec.jaw) : undefined;
  if (jawBone?.parent) {
    jawBone.parent.updateWorldMatrix(true, false);
    _q.setFromRotationMatrix(_m.extractRotation(jawBone.parent.matrixWorld)).invert();
    const f = forward.clone().applyQuaternion(_q);
    const u = up.clone().applyQuaternion(_q);
    jaw = { bone: jawBone, rest: jawBone.quaternion.clone(), right: new Vector3().crossVectors(u, f).normalize() };
  }

  const lipBones = (spec.lips?.moves ?? [])
    .map((m) => {
      const bone = objectFor(m.node);
      return (
        bone && {
          bone,
          rest: bone.position.clone(),
          open: new Vector3(...m.open),
          round: new Vector3(...m.round),
          wide: new Vector3(...m.wide),
        }
      );
    })
    .filter((l): l is NonNullable<typeof l> => !!l);

  const hasMouth = (spec.mouth?.some((x) => x.length > 0) ?? false) || !!jaw || lipBones.length > 0;
  if (bindSpecs.length === 0 && lids.length === 0 && eyes.length === 0 && !hasMouth) return undefined;
  return {
    blinker: new Blinker(),
    binds: [],
    pendingBinds: bindSpecs.length > 0 ? { specs: bindSpecs, weightsFor, tries: 0 } : undefined,
    jaw,
    lips: lipBones,
    hasMouth,
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
    .map((b) => ({ weights: pending.weightsFor(b), index: b.index, weight: b.weight, channel: b.channel }))
    .filter((b) => b.weights.length > 0);
  // Give the loader a few frames; then stop looking (the avatar has no usable morph targets).
  if (binds.length > 0 || ++pending.tries > 10) {
    rig.binds = binds;
    rig.pendingBinds = undefined;
  }
}

/** Total viseme weight at which lip bones take a vowel's full shape. */
const SHAPE_FULL_AT = 0.3;
/** Jaw opens at most this far (degrees). */
const JAW_MAX = 14;
const _channels = new Float32Array(6);

/** How open the mouth is overall for a set of visemes (for jaw and lip bones). */
export function mouthOpenness(v: ArrayLike<number>): number {
  return Math.min(1, v[0] + 0.75 * v[4] + 0.5 * v[2] + 0.45 * v[3] + 0.35 * v[1]);
}

function applyFace(rig: FaceRig, closed: number, visemes: ArrayLike<number> | undefined) {
  _channels[BLINK_CHANNEL] = closed;
  for (let i = 0; i < 5; i++) _channels[1 + i] = visemes ? visemes[i] : 0;
  // Several channels can share a blend shape; the strongest wins rather than the last.
  for (const b of rig.binds) for (const w of b.weights) w[b.index] = 0;
  for (const b of rig.binds) {
    const value = _channels[b.channel] * b.weight;
    for (const w of b.weights) if (value > w[b.index]) w[b.index] = value;
  }
  for (const l of rig.lids) l.bone.position.copy(l.rest).addScaledVector(l.delta, closed);

  if (rig.jaw || rig.lips.length > 0) {
    const open = visemes ? mouthOpenness(visemes) : 0;
    // The lips take the vowel's shape fully as soon as there's voice (an "oo" is pursed however quietly it's
    // said); only how far the mouth opens follows loudness.
    let total = 0;
    if (visemes) for (let i = 0; i < 5; i++) total += visemes[i];
    const strength = Math.min(1, total / SHAPE_FULL_AT);
    const frac = (i: number) => (total > 0 && visemes ? visemes[i] / total : 0);
    const round = Math.min(1, frac(2) + 0.6 * frac(4)) * strength;
    const wide = Math.min(1, frac(3) + frac(1)) * strength;
    if (rig.jaw) {
      _q.setFromAxisAngle(rig.jaw.right, open * JAW_MAX * DEG);
      rig.jaw.bone.quaternion.copy(_q).multiply(rig.jaw.rest);
    }
    for (const l of rig.lips) {
      l.bone.position
        .copy(l.rest)
        .addScaledVector(l.open, open)
        .addScaledVector(l.round, round)
        .addScaledVector(l.wide, wide);
    }
  }
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
  random: () => number = Math.random,
  visemes?: ArrayLike<number>
) {
  if (rig.pendingBinds) resolveBinds(rig);
  applyFace(rig, rig.forceBlink ?? rig.blinker.update(dt), visemes);
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
