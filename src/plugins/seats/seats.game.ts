/**
 * Buzzar seats (glTF extension HAVEN_seat), like VRChat stations.
 *
 * A seat node marks where a sitting avatar's hips go; the sitter faces the node's -Z (the same convention as
 * MX_spawn_point and the player rig). Clicking the seat (or pressing E while it is focused) sits you down:
 * your character controller is suspended, your avatar plays the procedural Sit clip (built on the default rig
 * and retargeted to every avatar), and moving or jumping stands you back up where you were.
 *
 * Seat state is broadcast to the other peers (NetworkAction.HavenSeat) so they see you sitting, and repeated
 * every few seconds so people who join later catch up. A seat holds one person.
 *
 * glTF:
 *   "HAVEN_seat": { "size": [0.6, 0.35, 0.6] }   // optional clickable box (metres) centred on the seat point
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { mat4, quat, vec3 } from "gl-matrix";

import { AvatarHips } from "../../engine/avatar/avatar.game";
import { SeatedEntities } from "../../engine/animation/animation.game";
import {
  createCursorView,
  readFloat64,
  readUint32,
  sliceCursorView,
  writeFloat64,
  writeUint32,
} from "../../engine/allocator/CursorView";
import { getYaw } from "../../engine/common/math";
import { addChild, updateMatrixWorld } from "../../engine/component/transform";
import { GameContext } from "../../engine/GameTypes";
import { ButtonActionState } from "../../engine/input/ActionMap";
import { InputModule } from "../../engine/input/input.game";
import { defineModule, getModule, registerMessageHandler } from "../../engine/module/module.common";
import { NetworkAction } from "../../engine/network/NetworkAction";
import { NetworkModule } from "../../engine/network/network.game";
import { registerInboundMessageHandler } from "../../engine/network/inbound.game";
import { broadcastReliable } from "../../engine/network/outbound.game";
import { writeMetadata } from "../../engine/network/serialization.game";
import { addPhysicsBody, addPhysicsCollider, PhysicsModule } from "../../engine/physics/physics.game";
import { AvatarRef } from "../../engine/player/components";
import { KinematicCharacterControllerActions } from "../../engine/player/KinematicCharacterController";
import { ourPlayerQuery } from "../../engine/player/Player";
import { RemoteCollider, RemoteNode, RemotePhysicsBody } from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import { ColliderType, InteractableType, PhysicsBodyType } from "../../engine/resource/schema";
import { getRotationNoAlloc } from "../../engine/utils/getRotationNoAlloc";
import { addInteractableComponent } from "../interaction/interaction.game";

export interface GLTFSeatExtension {
  /** Clickable box size in metres, centred on the seat point. */
  size?: [number, number, number];
}

interface Seat {
  /** glTF node index: identical on every client that loaded the same scene. */
  index: number;
  node: RemoteNode;
  click: RemoteNode;
}

interface LocalSeating {
  seat: Seat;
  standPosition: vec3;
  lastBroadcast: number;
  /** When we sat down (ms since epoch), to settle two people claiming the seat at once. */
  claimedAt: number;
}

interface SeatModuleState {
  seats: Map<number, Seat>;
  local?: LocalSeating;
  /** Remote peer id → seat index they are sitting on. */
  remote: Map<string, number>;
}

const DEFAULT_SIZE: [number, number, number] = [0.6, 0.35, 0.6];
/** How far the body may turn away from the seat's facing while seated. */
const MAX_YAW_OFFSET = (60 * Math.PI) / 180;
const REBROADCAST_SECONDS = 2;
/** Hips sit a little above the seat surface the node marks. */
const HIPS_ABOVE_SEAT = 0.08;

const SitDebugMessage = "software.haven.debug.sit";

const messageView = createCursorView(new ArrayBuffer(64));

/**
 * Seat index + 1 (0 = standing), then (Buzzar) when the seat was claimed, so two people who click the same free
 * seat at once agree on who gets it. Older clients only read the index.
 */
function createSeatMessage(seatIndex: number | undefined, claimedAt = 0) {
  writeMetadata(messageView, NetworkAction.HavenSeat);
  writeUint32(messageView, seatIndex === undefined ? 0 : seatIndex + 1);
  writeFloat64(messageView, claimedAt);
  return sliceCursorView(messageView);
}

/** Whether a remote claim (claimedAt, peerId) beats ours: the earlier claim wins; same time, the smaller id. */
function remoteClaimWins(remoteAt: number, remotePeer: string, ourAt: number, ourPeer: string) {
  if (!remoteAt) return false; // an older client: keep our seat (we saw it free when we sat)
  if (remoteAt !== ourAt) return remoteAt < ourAt;
  return remotePeer < ourPeer;
}

export const SeatModule = defineModule<GameContext, SeatModuleState>({
  name: "seats",
  create() {
    return { seats: new Map(), remote: new Map() };
  },
  init(ctx) {
    const network = getModule(ctx, NetworkModule);
    registerInboundMessageHandler(network, NetworkAction.HavenSeat, (ctx, v, peerId) => {
      const value = readUint32(v);
      const claimedAt = v.byteLength - v.cursor >= 8 ? readFloat64(v) : 0;
      const module = getModule(ctx, SeatModule);
      if (value === 0) {
        module.remote.delete(peerId);
        return;
      }
      module.remote.set(peerId, value - 1);
      // Buzzar: both of us took the same seat at once: the earlier claim keeps it, the other stands up.
      const local = module.local;
      if (
        local &&
        local.seat.index === value - 1 &&
        remoteClaimWins(claimedAt, peerId, local.claimedAt, network.peerId)
      ) {
        stand(ctx, module);
      }
    });

    // Debug: `thirdroom.sit(n)` in the console (input.main.ts).
    return registerMessageHandler(ctx, SitDebugMessage, (ctx: GameContext, message: { type: typeof SitDebugMessage; seat: number }) => {
      const module = getModule(ctx, SeatModule);
      const seat = [...module.seats.values()][message.seat];
      if (seat) sit(ctx, module, seat);
      else stand(ctx, module);
    });
  },
});

export function addSeat(ctx: GameContext, node: RemoteNode, extension: GLTFSeatExtension, index: number) {
  const module = getModule(ctx, SeatModule);
  const physics = getModule(ctx, PhysicsModule);
  const size = extension.size ?? DEFAULT_SIZE;

  const click = new RemoteNode(ctx.resourceManager, { name: "Sit" });
  // Attach first: physics bodies take their world transform when created.
  addChild(node, click);
  updateMatrixWorld(click);

  addPhysicsCollider(
    ctx.world,
    click,
    new RemoteCollider(ctx.resourceManager, {
      type: ColliderType.Box,
      size,
      // A sensor: clickable, but it never blocks anyone walking past or sitting.
      isTrigger: true,
      activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
    })
  );
  addPhysicsBody(
    ctx.world,
    physics,
    click,
    new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Static })
  );
  addInteractableComponent(ctx, physics, click, InteractableType.Interactable);

  module.seats.set(index, { index, node, click });
}

const _seatPos = vec3.create();
const _seatQuat = quat.create();
const _hips = vec3.create();
const _target = vec3.create();
const _v = new RAPIER.Vector3(0, 0, 0);
const _q = new RAPIER.Quaternion(0, 0, 0, 1);

function getOurContainer(ctx: GameContext): RemoteNode | undefined {
  const eid = ourPlayerQuery(ctx.world)[0];
  return eid ? getRemoteResource<RemoteNode>(ctx, eid) : undefined;
}

function moveBody(container: RemoteNode, position: vec3, rotation: quat) {
  const body = container.physicsBody?.body;
  if (!body) return;
  _v.x = position[0];
  _v.y = position[1];
  _v.z = position[2];
  _q.x = rotation[0];
  _q.y = rotation[1];
  _q.z = rotation[2];
  _q.w = rotation[3];
  body.setNextKinematicTranslation(_v);
  body.setNextKinematicRotation(_q);
}

function sit(ctx: GameContext, module: SeatModuleState, seat: Seat) {
  const container = getOurContainer(ctx);
  if (!container) return;
  const network = getModule(ctx, NetworkModule);

  const standPosition = module.local ? module.local.standPosition : vec3.clone(container.position);
  module.local = { seat, standPosition, lastBroadcast: ctx.elapsed, claimedAt: Date.now() };

  // Face the seat's direction straight away.
  getRotationNoAlloc(_seatQuat, seat.node.worldMatrix);
  quat.fromEuler(container.quaternion, 0, (getYaw(_seatQuat) * 180) / Math.PI, 0);

  SeatedEntities.add(container.eid);
  broadcastReliable(ctx, network, createSeatMessage(seat.index, module.local.claimedAt));
}

function stand(ctx: GameContext, module: SeatModuleState) {
  const local = module.local;
  if (!local) return;
  module.local = undefined;

  const container = getOurContainer(ctx);
  if (container) {
    SeatedEntities.delete(container.eid);
    vec3.copy(container.position, local.standPosition);
    moveBody(container, local.standPosition, container.quaternion);
  }

  broadcastReliable(ctx, getModule(ctx, NetworkModule), createSeatMessage(undefined));
}

/** Keeps the seated player's hips on the seat and their body facing roughly the seat's direction. */
function pinToSeat(ctx: GameContext, container: RemoteNode, seat: Seat) {
  mat4.getTranslation(_seatPos, seat.node.worldMatrix);
  getRotationNoAlloc(_seatQuat, seat.node.worldMatrix);
  const seatYaw = getYaw(_seatQuat);

  // Allow looking around a bit, but keep the body turned towards the seat's facing.
  let offset = getYaw(container.quaternion) - seatYaw;
  offset = Math.atan2(Math.sin(offset), Math.cos(offset));
  offset = Math.max(-MAX_YAW_OFFSET, Math.min(MAX_YAW_OFFSET, offset));
  quat.fromEuler(container.quaternion, 0, ((seatYaw + offset) * 180) / Math.PI, 0);

  // Move the container so the avatar's hips land on the seat point. Uses the hips' current offset from the
  // container, which settles once the Sit clip has faded in; works for any avatar's proportions.
  vec3.copy(_target, _seatPos);
  _target[1] += HIPS_ABOVE_SEAT;
  const rig = getRemoteResource<RemoteNode>(ctx, AvatarRef.eid[container.eid]);
  const hips = rig ? AvatarHips.get(rig) : undefined;
  if (hips) {
    mat4.getTranslation(_hips, hips.worldMatrix);
    vec3.sub(_hips, _hips, container.position);
    vec3.sub(_target, _target, _hips);
  } else {
    _target[1] -= 0.5;
  }

  vec3.copy(container.position, _target);
  moveBody(container, _target, container.quaternion);
}

export function SeatSystem(ctx: GameContext) {
  const module = getModule(ctx, SeatModule);
  const network = getModule(ctx, NetworkModule);

  // Forget seats from a previous world.
  for (const [index, seat] of module.seats) {
    if (getRemoteResource(ctx, seat.click.eid) !== seat.click) {
      module.seats.delete(index);
      if (module.local?.seat === seat) {
        SeatedEntities.clear();
        module.local = undefined;
      }
    }
  }

  // Peers that left.
  for (const peerId of module.remote.keys()) {
    if (!network.peers.includes(peerId)) module.remote.delete(peerId);
  }

  const occupied = new Set(module.remote.values());

  for (const seat of module.seats.values()) {
    if (!seat.click.interactable?.pressed) continue;
    if (module.local?.seat === seat) continue;
    if (occupied.has(seat.index)) continue;
    sit(ctx, module, seat);
  }

  const container = getOurContainer(ctx);

  if (module.local && container) {
    const input = getModule(ctx, InputModule);
    const move = input.actionStates.get(KinematicCharacterControllerActions.Move) as Float32Array | undefined;
    const jump = input.actionStates.get(KinematicCharacterControllerActions.Jump) as ButtonActionState | undefined;
    const moving = !!move && Math.hypot(move[0], move[1]) > 0.1;

    if (moving || jump?.pressed) {
      stand(ctx, module);
    } else {
      pinToSeat(ctx, container, module.local.seat);
      if (ctx.elapsed - module.local.lastBroadcast > REBROADCAST_SECONDS * 1000) {
        module.local.lastBroadcast = ctx.elapsed;
        broadcastReliable(ctx, network, createSeatMessage(module.local.seat.index, module.local.claimedAt));
      }
    }
  } else if (module.local && !container) {
    module.local = undefined;
  }

  // Everyone currently sitting, for the animation system and character controller.
  SeatedEntities.clear();
  if (module.local && container) SeatedEntities.add(container.eid);
  for (const peerId of module.remote.keys()) {
    const eid = network.peerIdToEntityId.get(peerId);
    if (eid !== undefined) SeatedEntities.add(eid);
  }
}
