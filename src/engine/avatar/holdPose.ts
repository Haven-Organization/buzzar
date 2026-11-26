/**
 * Buzzar: avatars holding Things in their hands (HAVEN_thing `hold`, holdSpec.ts).
 *
 * When you hold a Thing that says how it's held, it stops floating in front of you:
 * - "aim" Things (a water gun) point where you look, held out from your shoulder; your hands reach for their grips.
 * - "hand" Things ride in your hand as your arm swings.
 * Either way your arms are posed with two-bone IK so the hands sit on the grips, the wrists turn to them, and the
 * fingers curl round. Your client places the Thing (it becomes kinematic while held, and its position goes out as
 * usual); everyone else is told who holds what (NetworkAction.HavenHold) and poses your avatar's arms to reach it.
 *
 * The arm posing runs in each avatar's animation post-update (avatar.game.ts), after the animation mixer, on the
 * game thread's copy of the skeleton.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { hasComponent } from "bitecs";
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { getPeerIndexFromNetworkId, NetworkModule } from "../network/network.game";
import { NetworkAction } from "../network/NetworkAction";
import { registerInboundMessageHandler } from "../network/inbound.game";
import { broadcastReliable } from "../network/outbound.game";
import { writeMetadata } from "../network/serialization.game";
import { Networked } from "../network/NetworkComponents";
import { createCursorView, readUint32, sliceCursorView, writeUint32 } from "../allocator/CursorView";
import { PhysicsModule } from "../physics/physics.game";
import { getCamera } from "../player/getCamera";
import { OurPlayer } from "../player/Player";
import { RemoteNode } from "../resource/RemoteResources";
import { getRemoteResource } from "../resource/resource.game";
import { HumanBone } from "./humanoid";
import { HoldGrip, HoldSpec } from "./holdSpec";

/* ---------- Who holds what ---------- */

interface LocalHold {
  eid: number;
  node: RemoteNode;
  spec: HoldSpec;
  /** ctx.tick when the avatar last placed it (else holdFallback places it from the camera). */
  placedTick: number;
  announcedAt: number;
}

let localHold: LocalHold | undefined;
/** peerId → network id of the Thing they hold. */
const remoteHolds = new Map<string, number>();
/** peerId → the entity we made a sensor for them (put back when they let go). */
const remoteSensors = new Map<string, RemoteNode>();
/** How a Thing (by entity) is held, if it says (set by the Things plugin: thingFile.ts). */
let resolveHold: (eid: number) => HoldSpec | undefined = () => undefined;

export function setHoldResolver(resolver: (eid: number) => HoldSpec | undefined) {
  resolveHold = resolver;
}

export function getLocalHold() {
  return localHold;
}

const messageView = createCursorView(new ArrayBuffer(16));
/** Repeated this often while holding, so people who arrive later see it too. */
const REANNOUNCE_MS = 4000;

function announce(ctx: GameContext, eid: number | undefined) {
  writeMetadata(messageView, NetworkAction.HavenHold);
  writeUint32(messageView, eid !== undefined && hasComponent(ctx.world, Networked, eid) ? Networked.networkId[eid] : 0);
  broadcastReliable(ctx, getModule(ctx, NetworkModule), sliceCursorView(messageView));
}

/**
 * Things held in someone's hands don't collide: one at your shoulder would sit inside your own player capsule and
 * shove you around (and anyone you walk past). Entities made sensors here, to put back when let go.
 */
const madeSensors = new Set<number>();

function setHeldCollisions(node: RemoteNode, held: boolean) {
  const body = node.physicsBody?.body;
  if (!body) return;
  if (held === madeSensors.has(node.eid)) return;
  for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(held);
  if (held) madeSensors.add(node.eid);
  else madeSensors.delete(node.eid);
}

/** Starts holding `node` in our hands: it becomes kinematic, and everyone is told. */
export function beginLocalHold(ctx: GameContext, node: RemoteNode, spec: HoldSpec) {
  if (localHold) endLocalHold(ctx);
  const body = node.physicsBody?.body;
  if (body) {
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    body.setAngvel({ x: 0, y: 0, z: 0 }, false);
  }
  setHeldCollisions(node, true);
  localHold = { eid: node.eid, node, spec, placedTick: -1, announcedAt: Date.now() };
  announce(ctx, node.eid);
}

/** Stops holding: the Thing is a normal physical object again (call before throwing it). */
export function endLocalHold(ctx: GameContext) {
  if (!localHold) return;
  const body = localHold.node.physicsBody?.body;
  if (body && getRemoteResource<RemoteNode>(ctx, localHold.eid)) {
    setHeldCollisions(localHold.node, false);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }
  madeSensors.delete(localHold.eid);
  localHold = undefined;
  announce(ctx, undefined);
}

/** Re-announces now and then, and places the Thing from the camera when no avatar did this frame (none loaded). */
export function updateLocalHold(ctx: GameContext, player: RemoteNode | undefined) {
  if (!localHold) return;
  if (!getRemoteResource<RemoteNode>(ctx, localHold.eid)) {
    localHold = undefined;
    announce(ctx, undefined);
    return;
  }
  if (Date.now() - localHold.announcedAt > REANNOUNCE_MS) {
    localHold.announcedAt = Date.now();
    announce(ctx, localHold.eid);
  }
  if (player && localHold.placedTick < ctx.tick - 1) placeAimed(ctx, player, localHold, undefined);
}

export function registerHoldNetwork(ctx: GameContext) {
  const network = getModule(ctx, NetworkModule);
  registerInboundMessageHandler(network, NetworkAction.HavenHold, (_ctx, v, peerId) => {
    const nid = readUint32(v);
    const previous = remoteSensors.get(peerId);
    if (previous) {
      setHeldCollisions(previous, false);
      remoteSensors.delete(peerId);
    }
    if (nid === 0) {
      remoteHolds.delete(peerId);
      return;
    }
    // Only something of theirs.
    if (getPeerIndexFromNetworkId(nid) !== network.peerIdToIndex.get(peerId)) return;
    remoteHolds.set(peerId, nid);
  });
}

/* ---------- The avatar's arms ---------- */

interface Finger {
  bone: Object3D;
  /** Curl axis in the bone's own space. */
  axis: Vector3;
  amount: number;
}

interface ArmChain {
  side: "left" | "right";
  upper: Object3D;
  lower: Object3D;
  hand: Object3D;
  /** handshake frame = hand bone world rotation × toFrame. */
  toFrame: Quaternion;
  /** The palm's centre, in the hand bone's space. */
  palm: Vector3;
  fingers: Finger[];
}

export interface HoldRig {
  right?: ArmChain;
  left?: ArmChain;
  /** Bones we posed last frame: their rotation before, and what we left them at. */
  touched: Map<Object3D, { before: Quaternion; after: Quaternion }>;
}

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
const JOINTS = ["Metacarpal", "Proximal", "Intermediate", "Distal"] as const;

function worldPos(obj: Object3D | undefined) {
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
          bone: obj,
          axis: curl.clone().applyQuaternion(inverse).normalize(),
          amount: finger === "Thumb" ? 0.5 : 1,
        });
      }
    }
  }
  return { side, upper, lower, hand, toFrame, palm: palmCentre, fingers };
}

/**
 * The hold rig for an avatar: its arm chains and hand frames, worked out from the skeleton as it is now (call while
 * it's in its bind pose, with world matrices up to date).
 */
export function createHoldRig(boneFor: (bone: HumanBone) => Object3D | undefined): HoldRig | undefined {
  const right = buildArm("right", boneFor);
  const left = buildArm("left", boneFor);
  return right || left ? { right, left, touched: new Map() } : undefined;
}

/** Undo last frame's posing on bones the animation didn't write this frame (else it would build up). */
function restoreUntouched(rig: HoldRig) {
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
function solveArm(rig: HoldRig, arm: ArmChain, palmTarget: Vector3, frameRotation: Quaternion, pole: Vector3) {
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

function curlFingers(rig: HoldRig, arm: ArmChain, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  for (const finger of arm.fingers) {
    _q2.setFromAxisAngle(finger.axis, radians * finger.amount);
    setLocalRotation(rig, finger.bone, finger.bone.quaternion.clone().multiply(_q2));
  }
}

function gripMatrix(grip: HoldGrip) {
  return new Matrix4().compose(new Vector3(...grip.position), new Quaternion(...grip.rotation), new Vector3(1, 1, 1));
}

/** Where the elbow points: down, out to the side and a little back from the shoulder. */
function elbowPole(arm: ArmChain, body: Quaternion) {
  const shoulder = worldPos(arm.upper)!;
  const out = new Vector3(arm.side === "right" ? 1 : -1, 0, 0).applyQuaternion(body);
  const back = new Vector3(0, 0, 1).applyQuaternion(body);
  return shoulder.addScaledVector(new Vector3(0, -1, 0), 0.6).addScaledVector(out, 0.35).addScaledVector(back, 0.2);
}

/* ---------- Placing your own held Thing ---------- */

const AIM_REACH = 0.62; // of the arm's length, out from the shoulder
const MAX_AIM_DISTANCE = 30;
const MIN_AIM_DISTANCE = 1.5;
const MAX_CONVERGE = (12 * Math.PI) / 180;
const _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
const isSolid = (collider: RAPIER.Collider) => !collider.isSensor();

/**
 * Places an aimed Thing: pointed where you look, its grip held out from your shoulder (or, without an avatar, low
 * and to the side of your view), and turned slightly so its aim line meets what you're looking at.
 */
function placeAimed(ctx: GameContext, player: RemoteNode, hold: LocalHold, arm: ArmChain | undefined): Matrix4 {
  const { spec, node } = hold;
  const camera = getCamera(ctx, player);
  const camMatrix = new Matrix4().fromArray(camera.worldMatrix as unknown as number[]);
  const camPos = new Vector3().setFromMatrixPosition(camMatrix);
  const camRot = new Quaternion().setFromRotationMatrix(camMatrix);
  const forward = new Vector3(0, 0, -1).applyQuaternion(camRot);
  const side = spec.hand === "right" ? 1 : -1;

  let anchor: Vector3;
  if (arm) {
    const shoulder = worldPos(arm.upper)!;
    const length =
      worldPos(arm.upper)!.distanceTo(worldPos(arm.lower)!) + worldPos(arm.lower)!.distanceTo(worldPos(arm.hand)!);
    anchor = shoulder
      .addScaledVector(forward, length * AIM_REACH)
      .add(new Vector3(-0.06 * side, -0.04, 0).applyQuaternion(camRot));
  } else {
    anchor = camPos.clone().add(new Vector3(0.16 * side, -0.24, -0.45).applyQuaternion(camRot));
  }

  // Point the Thing's aim direction where the camera looks, keeping it upright with the view.
  const aimDir = new Vector3(...spec.aim.direction);
  const rotation = camRot.clone().multiply(new Quaternion().setFromUnitVectors(aimDir, new Vector3(0, 0, -1)));
  // Its grip's palm on the anchor.
  const position = anchor.clone().sub(new Vector3(...spec.grip.position).applyQuaternion(rotation));

  // Converge: turn about the anchor so the aim line meets what's under the crosshair.
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  _ray.origin = { x: camPos.x, y: camPos.y, z: camPos.z };
  _ray.dir = { x: forward.x, y: forward.y, z: forward.z };
  const exclude = player.physicsBody?.body;
  const hit = physicsWorld.castRay(
    _ray,
    MAX_AIM_DISTANCE,
    true,
    undefined,
    undefined,
    undefined,
    exclude,
    (c) => isSolid(c) && c.parent() !== node.physicsBody?.body
  );
  const distance = Math.max(MIN_AIM_DISTANCE, hit ? hit.toi : MAX_AIM_DISTANCE);
  const lookAt = camPos.clone().addScaledVector(forward, distance);
  const muzzle = new Vector3(...spec.aim.position).applyQuaternion(rotation).add(position);
  const current = aimDir.clone().applyQuaternion(rotation);
  const wanted = lookAt.sub(muzzle).normalize();
  const angle = current.angleTo(wanted);
  if (angle > 1e-4) {
    const turn = new Quaternion().setFromUnitVectors(current, wanted);
    if (angle > MAX_CONVERGE) turn.slerp(new Quaternion(), 1 - MAX_CONVERGE / angle);
    position.sub(anchor).applyQuaternion(turn).add(anchor);
    rotation.premultiply(turn);
  }

  position.toArray(node.position);
  rotation.toArray(node.quaternion);
  hold.placedTick = ctx.tick;
  return new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
}

/** Places a carried Thing in the animated hand. */
function placeInHand(ctx: GameContext, hold: LocalHold, arm: ArmChain): Matrix4 {
  const frame = arm.hand.getWorldQuaternion(new Quaternion()).multiply(arm.toFrame);
  const palm = arm.hand.localToWorld(arm.palm.clone());
  const handFrame = new Matrix4().compose(palm, frame, new Vector3(1, 1, 1));
  const thing = handFrame.multiply(gripMatrix(hold.spec.grip).invert());
  const position = new Vector3();
  const rotation = new Quaternion();
  thing.decompose(position, rotation, new Vector3());
  position.toArray(hold.node.position);
  rotation.toArray(hold.node.quaternion);
  hold.placedTick = ctx.tick;
  return new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
}

/**
 * Poses an avatar holding a Thing, if its player holds one that says how (called each frame after the animation
 * mixer, with world matrices up to date). Puts the arms back when it no longer does.
 */
export function updateHoldPose(ctx: GameContext, rig: HoldRig, avatarNode: RemoteNode) {
  restoreUntouched(rig);
  const player = avatarNode.parent;
  if (!player) return;

  let thing: RemoteNode | undefined;
  let spec: HoldSpec | undefined;
  let ours: LocalHold | undefined;
  if (hasComponent(ctx.world, OurPlayer, player.eid)) {
    ours = localHold;
    thing = ours?.node;
    spec = ours?.spec;
  } else if (player.name) {
    const nid = remoteHolds.get(player.name);
    const eid = nid !== undefined ? getModule(ctx, NetworkModule).networkIdToEntityId.get(nid) : undefined;
    thing = eid !== undefined ? getRemoteResource<RemoteNode>(ctx, eid) : undefined;
    spec = thing ? resolveHold(thing.eid) : undefined;
    if (thing && spec && remoteSensors.get(player.name) !== thing) {
      setHeldCollisions(thing, true);
      remoteSensors.set(player.name, thing);
    }
  }
  if (!thing || !spec) return;

  const primary = rig[spec.hand];
  const other = rig[spec.hand === "right" ? "left" : "right"];
  const body = new Quaternion().setFromRotationMatrix(
    new Matrix4().fromArray(player.worldMatrix as unknown as number[])
  );

  let thingMatrix: Matrix4;
  if (ours && spec.pose === "hand" && primary) thingMatrix = placeInHand(ctx, ours, primary);
  else if (ours) thingMatrix = placeAimed(ctx, player, ours, primary);
  else thingMatrix = new Matrix4().fromArray(thing.worldMatrix as unknown as number[]);

  const pose = (arm: ArmChain | undefined, grip: HoldGrip | undefined, move: boolean) => {
    if (!arm || !grip) return;
    if (move) {
      const frame = thingMatrix.clone().multiply(gripMatrix(grip));
      frame.decompose(_a, _q2, _b);
      solveArm(rig, arm, _a.clone(), _q2.clone(), elbowPole(arm, body));
    }
    curlFingers(rig, arm, spec!.curl);
  };
  // A carried Thing follows the animated hand, which needn't move; an aimed one is reached for.
  pose(primary, spec.grip, !(ours && spec.pose === "hand"));
  pose(other, spec.offhand, true);
}
