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
import { Matrix4, Quaternion, Vector3 } from "three";

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
import { HoldSpec } from "./holdSpec";
import { ArmChain, gripMatrix, HoldRig, poseHands, restoreUntouched, worldPos } from "./holdRig";

export { createHoldRig, handFrameNow, reachFor } from "./holdRig";
export type { HoldRig } from "./holdRig";

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

// The header (writeMetadata) alone is 13 bytes.
const messageView = createCursorView(new ArrayBuffer(64));
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

/**
 * How far the off hand has moved from its `offhand` grip right now, in the Thing's space (metres), by Thing entity:
 * set while something moves it, such as a water gun's pump stroke (HAVEN_sprayer pumpStroke).
 */
export const offhandShift = new Map<number, [number, number, number]>();

/* ---------- Placing your own held Thing ---------- */

const AIM_REACH = 0.62; // of the arm's length, out from the shoulder
/** Where an aimed Thing's grip sits from that point, in view space (x towards the holding hand's side): out past
 * the shoulder and a little down, so it's held low at the side of the view like a first-person shooter's, not
 * in the middle. */
const AIM_SIDE = 0.06;
const AIM_DROP = 0.08;
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
      .add(new Vector3(AIM_SIDE * side, -AIM_DROP, 0).applyQuaternion(camRot));
  } else {
    anchor = camPos.clone().add(new Vector3(0.24 * side, -0.27, -0.45).applyQuaternion(camRot));
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
  const body = new Quaternion().setFromRotationMatrix(
    new Matrix4().fromArray(player.worldMatrix as unknown as number[])
  );

  let thingMatrix: Matrix4;
  if (ours && spec.pose === "hand" && primary) thingMatrix = placeInHand(ctx, ours, primary);
  else if (ours) thingMatrix = placeAimed(ctx, player, ours, primary);
  else thingMatrix = new Matrix4().fromArray(thing.worldMatrix as unknown as number[]);

  poseHands(rig, spec, thingMatrix, body, !(ours && spec.pose === "hand"), offhandShift.get(thing.eid));
}
