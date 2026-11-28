/**
 * Buzzar: how an avatar's arms and hands hold an Item: hand frames worked out from the finger bones, two-bone IK
 * that puts a palm on a grip, and curled fingers. Pure three.js, no game state, so tests and the dev pose lab can use
 * it as it is; holdPose.ts decides where the Item is and calls poseHands each frame.
 */
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { HumanBone } from "./humanoid";
import { HoldGrip, HoldSpec } from "./holdSpec";

interface Finger {
  name: (typeof FINGERS)[number];
  bone: Object3D;
  /** Curl axis in the bone's own space. */
  axis: Vector3;
  amount: number;
}

export interface ArmChain {
  side: "left" | "right";
  upper: Object3D;
  lower: Object3D;
  hand: Object3D;
  /** handshake frame = hand bone world rotation × toFrame. */
  toFrame: Quaternion;
  /** The palm's centre, in the hand bone's space. */
  palm: Vector3;
  fingers: Finger[];
  /** Shoulder to elbow plus elbow to wrist, and wrist to palm (metres, from the bind pose: bones keep their length). */
  length: number;
  palmLength: number;
  /** The shoulder from between the eyes in the bind pose, in the avatar root's space (see restShoulder). */
  shoulderFromEyes?: Vector3;
}

export interface HoldRig {
  right?: ArmChain;
  left?: ArmChain;
  /** Bones we posed last frame: their rotation before, and what we left them at. */
  touched: Map<Object3D, { before: Quaternion; after: Quaternion }>;
  /** The avatar's root, when the rig knows where the shoulders rest (restShoulder). */
  root?: Object3D;
  /** The chest bones (chest, upperChest; spine without them), for bladeTorso. */
  chest: Object3D[];
  /** Spine bones from the hips up, each with the body's up axis in its own space (bind pose), for unturnTorso. */
  spine: { bone: Object3D; up: Vector3 }[];
  /** The top spine bone's bind-pose rotation in the root's space. */
  torsoRest?: Quaternion;
  /** The neck and head, the same way, for unturnHead. */
  neckChain: { bone: Object3D; up: Vector3 }[];
  headRest?: Quaternion;
}

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
const JOINTS = ["Metacarpal", "Proximal", "Intermediate", "Distal"] as const;

export function worldPos(obj: Object3D | undefined) {
  return obj ? new Vector3().setFromMatrixPosition(obj.matrixWorld) : undefined;
}

function buildArm(side: "left" | "right", boneFor: (bone: HumanBone) => Object3D | undefined): ArmChain | undefined {
  const bone = (name: string) => boneFor(`${side}${name}` as HumanBone);
  const upper = bone("UpperArm");
  const lower = bone("LowerArm");
  const hand = bone("Hand");
  if (!upper || !lower || !hand) return undefined;

  const handPos = worldPos(hand)!;
  const lowerPos = worldPos(lower)!;
  const index = worldPos(bone("IndexProximal"));
  const little = worldPos(bone("LittleProximal")) ?? worldPos(bone("RingProximal"));
  const middle = worldPos(bone("MiddleProximal")) ?? index;
  const thumb = worldPos(bone("ThumbDistal")) ?? worldPos(bone("ThumbIntermediate")) ?? worldPos(bone("ThumbProximal"));

  let along: Vector3;
  let palm: Vector3;
  let curl: Vector3 | undefined;
  if (index && little && middle && thumb) {
    // As retarget.ts handFrame: across the knuckles, pointed so curling swings the fingers to the thumb's side.
    along = middle.clone().sub(handPos).normalize();
    const across = index.clone().sub(little).normalize();
    const palmward = new Vector3().crossVectors(across, along);
    const thumbOffset = thumb.clone().sub(handPos);
    thumbOffset.addScaledVector(along, -thumbOffset.dot(along)).addScaledVector(across, -thumbOffset.dot(across));
    curl = thumbOffset.dot(palmward) >= 0 ? across : across.negate();
    palm = new Vector3().crossVectors(curl, along).normalize();
  } else {
    // No fingers: the hand points on from the forearm, palm down (as in a T-pose).
    along = handPos.clone().sub(lowerPos).normalize();
    palm = new Vector3(0, -1, 0).addScaledVector(along, along.y).normalize();
  }

  // The handshake frame in world space: fingers along -Z, palm facing -X (right hand) or +X (left), thumb up.
  const z = along.clone().negate();
  const x = side === "right" ? palm.clone().negate() : palm.clone();
  const y = new Vector3().crossVectors(z, x).normalize();
  x.crossVectors(y, z).normalize();
  const frame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  const handWorld = hand.getWorldQuaternion(new Quaternion());
  const toFrame = handWorld.clone().invert().multiply(frame);

  const reach = middle ? middle.clone().sub(handPos) : along.clone().multiplyScalar(handPos.distanceTo(lowerPos) * 0.3);
  const palmCentre = hand.worldToLocal(handPos.clone().addScaledVector(reach, 0.5));

  const fingers: Finger[] = [];
  if (curl) {
    for (const finger of FINGERS) {
      for (const joint of JOINTS) {
        const obj = bone(`${finger}${joint}`);
        if (!obj) continue;
        const inverse = obj.getWorldQuaternion(new Quaternion()).invert();
        fingers.push({
          name: finger,
          bone: obj,
          axis: curl.clone().applyQuaternion(inverse).normalize(),
          amount: finger === "Thumb" ? 0.5 : 1,
        });
      }
    }
  }
  const length = worldPos(upper)!.distanceTo(lowerPos) + lowerPos.distanceTo(handPos);
  const palmLength = handPos.distanceTo(hand.localToWorld(palmCentre.clone()));
  return { side, upper, lower, hand, toFrame, palm: palmCentre, fingers, length, palmLength };
}

/**
 * The hold rig for an avatar: its arm chains and hand frames, worked out from the skeleton as it is now (call while
 * it's in its bind pose, with world matrices up to date).
 */
export function createHoldRig(
  boneFor: (bone: HumanBone) => Object3D | undefined,
  root?: Object3D
): HoldRig | undefined {
  const right = buildArm("right", boneFor);
  const left = buildArm("left", boneFor);
  if (!right && !left) return undefined;
  // Where each shoulder rests from the eyes (the first-person camera), so an aimed Item can be placed from the
  // camera alone: the live shoulder sways with the idle animation, and the Item jumped with it.
  const head = worldPos(boneFor("head"));
  const leftEye = worldPos(boneFor("leftEye"));
  const rightEye = worldPos(boneFor("rightEye"));
  if (root && head) {
    const up = root.localToWorld(new Vector3(0, 1, 0)).sub(root.localToWorld(new Vector3())).normalize();
    const eyes =
      leftEye && rightEye ? leftEye.clone().add(rightEye).multiplyScalar(0.5) : head.clone().addScaledVector(up, 0.08);
    const local = (v: Vector3) => root.worldToLocal(v.clone());
    for (const arm of [right, left]) if (arm) arm.shoulderFromEyes = local(worldPos(arm.upper)!).sub(local(eyes));
  }
  const chest = (["chest", "upperChest"] as const).flatMap((name) => boneFor(name) ?? []);
  if (chest.length === 0) chest.push(...(boneFor("spine") ? [boneFor("spine")!] : []));
  const rootUp = root ? new Vector3(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new Quaternion())) : undefined;
  const chain = (names: readonly HumanBone[]) =>
    rootUp
      ? names.flatMap((name) => {
          const bone = boneFor(name);
          if (!bone) return [];
          return [{ bone, up: rootUp.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()) }];
        })
      : [];
  const restOf = (bone: Object3D | undefined) =>
    root && bone
      ? root.getWorldQuaternion(new Quaternion()).invert().multiply(bone.getWorldQuaternion(new Quaternion()))
      : undefined;
  const spine = chain(["spine", "chest", "upperChest"]);
  const neckChain = chain(["neck", "head"]);
  return {
    right,
    left,
    touched: new Map(),
    root,
    chest,
    spine,
    torsoRest: restOf(spine[spine.length - 1]?.bone),
    neckChain,
    headRest: restOf(neckChain[neckChain.length - 1]?.bone),
  };
}

/**
 * Undoes the turn the walk animation gives the chest (the strafe clips turn it towards the step), so a two-handed
 * aimed Item, placed from where the shoulders rest, stays in reach of both hands. Each spine bone twists about its
 * own up axis, so the animation's lean is kept (turning about the vertical swung a lean sideways and tipped the
 * head over).
 */
export function unturnTorso(rig: HoldRig) {
  unturn(rig, rig.spine, rig.torsoRest);
}

/**
 * Turns the head back to face the way the avatar does. The strafe clips turn the neck against the chest's turn to
 * keep the head ahead; with the chest unturned (and bladed), that left the head looking off to the side.
 */
export function unturnHead(rig: HoldRig) {
  unturn(rig, rig.neckChain, rig.headRest);
}

/** Twists `chain` (each bone about its own up axis) until its last bone is turned as `rest` says (root space). */
function unturn(rig: HoldRig, chain: { bone: Object3D; up: Vector3 }[], rest: Quaternion | undefined) {
  const { root } = rig;
  if (!root || !rest || chain.length === 0) return;
  const rootRotation = root.getWorldQuaternion(new Quaternion());
  const up = new Vector3(0, 1, 0).applyQuaternion(rootRotation);
  const top = chain[chain.length - 1].bone;
  for (let pass = 0; pass < 2; pass++) {
    const expected = rootRotation.clone().multiply(rest);
    const off = top.getWorldQuaternion(new Quaternion()).multiply(expected.invert());
    if (off.w < 0) off.set(-off.x, -off.y, -off.z, -off.w);
    const angle = 2 * Math.atan2(off.x * up.x + off.y * up.y + off.z * up.z, off.w);
    if (Math.abs(angle) < 1e-3) return;
    for (const { bone, up: localUp } of chain) {
      const twist = new Quaternion().setFromAxisAngle(localUp, -angle / chain.length);
      setLocalRotation(rig, bone, bone.quaternion.clone().multiply(twist));
    }
  }
}

/** Turns `bone` by `angle` about the world axis `axis`. */
function turnBone(rig: HoldRig, bone: Object3D, axis: Vector3, angle: number) {
  const parent = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  const turn = new Quaternion().setFromAxisAngle(axis, angle);
  setLocalRotation(rig, bone, parent.clone().invert().multiply(turn).multiply(parent).multiply(bone.quaternion));
}

/**
 * Turns the chest towards the holding hand's side, as people stand to hold a long gun to the shoulder: the other
 * shoulder comes forward, so that arm reaches the forend in front of the chest instead of across (through) it.
 * Follow it with unturnHead so the head still faces forward.
 */
export function bladeTorso(rig: HoldRig, hand: "left" | "right", degrees: number) {
  if (!rig.root || rig.chest.length === 0 || !degrees) return;
  const up = new Vector3(0, 1, 0).applyQuaternion(rig.root.getWorldQuaternion(new Quaternion()));
  // Turning right is clockwise seen from above: negative about up.
  const angle = ((hand === "right" ? -1 : 1) * degrees * Math.PI) / 180;
  for (const bone of rig.chest) turnBone(rig, bone, up, angle / rig.chest.length);
}

/**
 * Where `arm`'s shoulder rests for a camera at `eyes`: its bind-pose place turned with the avatar, not where the
 * animation has it this frame. Falls back to the live shoulder.
 */
export function restShoulder(rig: HoldRig, arm: ArmChain, eyes: Vector3) {
  if (!rig.root || !arm.shoulderFromEyes) return worldPos(arm.upper)!;
  const origin = rig.root.localToWorld(new Vector3());
  return rig.root.localToWorld(arm.shoulderFromEyes.clone()).sub(origin).add(eyes);
}

/** Undo last frame's posing on bones the animation didn't write this frame (else it would build up). */
export function restoreUntouched(rig: HoldRig) {
  for (const [bone, { before, after }] of rig.touched) if (bone.quaternion.equals(after)) bone.quaternion.copy(before);
  rig.touched.clear();
}

function setLocalRotation(rig: HoldRig, bone: Object3D, rotation: Quaternion) {
  const record = rig.touched.get(bone);
  const before = record?.before ?? bone.quaternion.clone();
  bone.quaternion.copy(rotation);
  bone.updateMatrixWorld(true);
  rig.touched.set(bone, { before, after: bone.quaternion.clone() });
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();

/** Turns `bone` (in world space) so the point `from` moves toward `to`. */
function swingBone(rig: HoldRig, bone: Object3D, from: Vector3, to: Vector3) {
  const origin = worldPos(bone)!;
  const u = from.clone().sub(origin);
  const w = to.clone().sub(origin);
  if (u.lengthSq() < 1e-10 || w.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(u.normalize(), w.normalize());
  const world = bone.getWorldQuaternion(new Quaternion()).premultiply(_q);
  const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
  setLocalRotation(rig, bone, parentWorld.invert().multiply(world));
}

/** Two-bone IK: the palm to `palmTarget` with the handshake frame at `frameRotation`, the elbow toward `pole`. */
export function solveArm(rig: HoldRig, arm: ArmChain, palmTarget: Vector3, frameRotation: Quaternion, pole: Vector3) {
  const handRotation = frameRotation.clone().multiply(arm.toFrame.clone().invert());
  // Where the hand bone must be for the palm to land on the target.
  const scale = arm.hand.getWorldScale(new Vector3());
  const palmOffset = arm.palm.clone().multiply(scale).applyQuaternion(handRotation);
  const target = palmTarget.clone().sub(palmOffset);

  const a = worldPos(arm.upper)!;
  const b = worldPos(arm.lower)!;
  const c = worldPos(arm.hand)!;
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  const toTarget = target.clone().sub(a);
  const d = Math.min(Math.max(toTarget.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const dir = toTarget.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const bend = pole.clone().sub(a);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(dir, -dir.y);
  bend.normalize();
  const elbow = a.clone().addScaledVector(dir, along).addScaledVector(bend, h);
  const reach = a.clone().addScaledVector(dir, d);

  swingBone(rig, arm.upper, b, elbow);
  swingBone(rig, arm.lower, worldPos(arm.hand)!, reach);
  const lowerWorld = arm.lower.getWorldQuaternion(new Quaternion());
  setLocalRotation(rig, arm.hand, lowerWorld.invert().multiply(handRotation));
}

/** Poses one arm so its palm reaches `palmTarget` with the handshake frame at `frameRotation` (also for tests). */
export function reachFor(
  rig: HoldRig,
  side: "left" | "right",
  palmTarget: Vector3,
  frameRotation: Quaternion,
  pole: Vector3
) {
  const arm = rig[side];
  if (arm) solveArm(rig, arm, palmTarget, frameRotation, pole);
}

/** Where a hand's palm is and which way its handshake frame faces, now (for tests). */
export function handFrameNow(rig: HoldRig, side: "left" | "right") {
  const arm = rig[side];
  if (!arm) return undefined;
  return {
    palm: arm.hand.localToWorld(arm.palm.clone()),
    rotation: arm.hand.getWorldQuaternion(new Quaternion()).multiply(arm.toFrame),
  };
}

/** Curls a hand's fingers `degrees` at each joint (the thumb half as much), the index finger `index` if given. */
export function curlFingers(rig: HoldRig, arm: ArmChain, degrees: number, index?: number) {
  for (const finger of arm.fingers) {
    const amount = finger.name === "Index" && index !== undefined ? index : degrees;
    _q2.setFromAxisAngle(finger.axis, ((amount * Math.PI) / 180) * finger.amount);
    setLocalRotation(rig, finger.bone, finger.bone.quaternion.clone().multiply(_q2));
  }
}

export function gripMatrix(grip: HoldGrip) {
  return new Matrix4().compose(new Vector3(...grip.position), new Quaternion(...grip.rotation), new Vector3(1, 1, 1));
}

/** Where the elbow points: down, out to the side and a little back from the shoulder. */
function elbowPole(arm: ArmChain, body: Quaternion) {
  const shoulder = worldPos(arm.upper)!;
  const out = new Vector3(arm.side === "right" ? 1 : -1, 0, 0).applyQuaternion(body);
  const back = new Vector3(0, 0, 1).applyQuaternion(body);
  return shoulder.addScaledVector(new Vector3(0, -1, 0), 0.6).addScaledVector(out, 0.35).addScaledVector(back, 0.2);
}

/**
 * Poses both arms on an Item at `itemMatrix` (world): the holding hand on `grip` (moved there only when
 * `movePrimary`; a carried Item follows the animated hand instead), the other on `offhand`, moved by `shift` (the
 * Item's space) if given, and the fingers curled. `body` is the avatar's world rotation. Also for the pose lab.
 */
export function poseHands(
  rig: HoldRig,
  spec: HoldSpec,
  itemMatrix: Matrix4,
  body: Quaternion,
  movePrimary: boolean,
  shift?: [number, number, number],
  /** The Item is in use (a water gun spraying): a hand on a `trigger` squeezes it. */
  using = false
) {
  const primary = rig[spec.hand];
  const other = rig[spec.hand === "right" ? "left" : "right"];
  const pose = (arm: ArmChain | undefined, grip: HoldGrip | undefined, move: boolean, shifted = false) => {
    if (!arm || !grip) return;
    if (shifted && shift) {
      const [x, y, z] = grip.position;
      grip = { ...grip, position: [x + shift[0], y + shift[1], z + shift[2]] };
    }
    if (move) {
      const frame = itemMatrix.clone().multiply(gripMatrix(grip));
      frame.decompose(_a, _q2, _b);
      solveArm(rig, arm, _a.clone(), _q2.clone(), elbowPole(arm, body));
    }
    curlFingers(rig, arm, grip.curl ?? spec.curl, grip.trigger ? 0 : undefined);
    if (grip.trigger) {
      const target = new Vector3(...grip.trigger.position).applyMatrix4(itemMatrix);
      reachTrigger(rig, arm, target, using ? grip.trigger.pull : 0);
    }
  };
  pose(primary, spec.grip, movePrimary);
  pose(other, spec.offhand, true, true);
}

/** How much of its full reach an arm stretches to for a grip: a little short, so the elbow stays slightly bent. */
const OFFHAND_REACH = 0.93;

/**
 * How far to bring an aimed Item back towards you (along `back`, metres) so the other hand can reach its `offhand`
 * grip, given where it would be (`position`, `rotation`). A long Item held out from one shoulder can have its
 * forend out of the other arm's reach, which left that hand stretched and unable to follow a pump.
 */
export function offhandPullback(
  rig: HoldRig,
  spec: HoldSpec,
  position: Vector3,
  rotation: Quaternion,
  back: Vector3,
  eyes?: Vector3
) {
  const arm = rig[spec.hand === "right" ? "left" : "right"];
  if (!arm || !spec.offhand) return 0;
  const shoulder = eyes ? restShoulder(rig, arm, eyes) : worldPos(arm.upper)!;
  // The bind-pose lengths: measuring the live bones read a stale pose once per idle loop, and the Item jumped.
  const { length } = arm;
  const reach = (length + arm.palmLength) * OFFHAND_REACH;
  const grip = new Vector3(...spec.offhand.position).applyQuaternion(rotation).add(position);
  let pull = 0;
  for (let i = 0; i < 6; i++) {
    const at = grip.clone().addScaledVector(back, pull).sub(shoulder);
    const distance = at.length();
    if (distance <= reach + 1e-3) break;
    // How fast the distance shrinks as it comes back; if it doesn't, coming back can't help.
    const rate = -at.dot(back) / distance;
    if (rate < 0.05) break;
    pull += (distance - reach) / rate;
  }
  return Math.min(pull, length * 0.5);
}

/** The index finger's joints (proximal first), the point its pad touches with, and how far that is from `target`. */
function indexPad(arm: ArmChain) {
  const joints = arm.fingers.filter((f) => f.name === "Index");
  const n = joints.length;
  if (n < 2) return undefined;
  const pad = () => {
    // Halfway along the last bone, plus as far again past its joint as it is long (the fingertip's pad).
    const last = worldPos(joints[n - 1].bone)!;
    const before = worldPos(joints[n - 2].bone)!;
    return last.clone().addScaledVector(last.clone().sub(before), 0.6);
  };
  return { joints, pad };
}

const MAX_TRIGGER_SWING = (35 * Math.PI) / 180;

/**
 * Puts the index finger's pad on a trigger at `target` (world space): turns the finger at its knuckle towards it
 * (up to 35°) and curls it as far as brings the pad closest, then `pull` degrees more (squeezing).
 */
function reachTrigger(rig: HoldRig, arm: ArmChain, target: Vector3, pull: number) {
  const index = indexPad(arm);
  if (!index) return;
  const { joints, pad } = index;
  // The knuckle bone (skip a metacarpal: it hardly moves in a real hand).
  const curling = joints.filter((f) => !/Metacarpal/.test(f.bone.name) || joints.length < 4);
  const base = curling[0].bone;
  const rest = curling.map((f) => f.bone.quaternion.clone());
  const setCurl = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    curling.forEach((f, i) => f.bone.quaternion.copy(rest[i]).multiply(_q2.setFromAxisAngle(f.axis, radians)));
    base.updateMatrixWorld(true);
  };
  const bestCurl = () => {
    let best = 0;
    let bestDistance = Infinity;
    for (let degrees = 0; degrees <= 90; degrees += 3) {
      setCurl(degrees);
      const distance = pad().distanceTo(target);
      if (distance < bestDistance) [best, bestDistance] = [degrees, distance];
    }
    return best;
  };
  for (let pass = 0; pass < 2; pass++) {
    const curl = bestCurl();
    setCurl(curl);
    // Turn at the knuckle so the pad meets the target, a little at most.
    const origin = worldPos(base)!;
    _q.setFromUnitVectors(pad().sub(origin).normalize(), target.clone().sub(origin).normalize());
    const angle = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
    if (angle > MAX_TRIGGER_SWING) _q.slerp(new Quaternion(), 1 - MAX_TRIGGER_SWING / angle);
    const world = base.getWorldQuaternion(new Quaternion()).premultiply(_q);
    const parentWorld = base.parent ? base.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
    // The turned knuckle, with its curl taken back out, is the new rest for the curl search.
    rest[0]
      .copy(parentWorld.invert().multiply(world))
      .multiply(_q2.setFromAxisAngle(curling[0].axis, (-curl * Math.PI) / 180));
  }
  const curl = bestCurl() + pull;
  curling.forEach((f, i) =>
    setLocalRotation(rig, f.bone, rest[i].clone().multiply(_q2.setFromAxisAngle(f.axis, (curl * Math.PI) / 180)))
  );
}
