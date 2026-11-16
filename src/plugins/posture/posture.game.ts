/**
 * Buzzar: crouching and lying prone.
 *
 * Controls (desktop, like VRChat): C crouches (press again to stand), Z toggles prone, jumping stands you up. Keep
 * holding C for half a second and you go prone, so one controller button can do it all, like VRChat's thumbstick
 * click (press: crouch / stand up, hold: prone).
 *
 * Your capsule shrinks so you fit under things (and you only stand back up where there's room), the camera eases
 * down to your new eye height, you move slower, and your avatar takes the pose: crouching bends the legs on top of
 * walking/idle; prone lies on the forearms. Posture is broadcast to the other peers (NetworkAction.HavenPosture)
 * and repeated every few seconds for people who join later.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";

import { SeatedEntities } from "../../engine/animation/animation.game";
import { createCursorView, readUint32, sliceCursorView, writeUint32 } from "../../engine/allocator/CursorView";
import { GameContext } from "../../engine/GameTypes";
import { ButtonActionState } from "../../engine/input/ActionMap";
import { InputModule } from "../../engine/input/input.game";
import { defineModule, getModule } from "../../engine/module/module.common";
import { NetworkAction } from "../../engine/network/NetworkAction";
import { NetworkModule } from "../../engine/network/network.game";
import { registerInboundMessageHandler } from "../../engine/network/inbound.game";
import { broadcastReliable } from "../../engine/network/outbound.game";
import { writeMetadata } from "../../engine/network/serialization.game";
import { PhysicsModule } from "../../engine/physics/physics.game";
import { getCamera } from "../../engine/player/getCamera";
import { isSolid, KinematicCharacterControllerActions } from "../../engine/player/KinematicCharacterController";
import { ourPlayerQuery } from "../../engine/player/Player";
import { localPosture, Posture, PostureEntities } from "../../engine/player/posture.common";
import { RemoteNode } from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";

/** Holding crouch this long goes prone. */
const HOLD_FOR_PRONE = 0.5;
const REBROADCAST_SECONDS = 3;

/**
 * Capsule per posture (body space; the body's origin is at the feet, forward is -Z). Standing matches the player
 * rig (PlayerRig.ts). Prone is a capsule lying along the body, centred a little behind the hips.
 */
interface CapsuleShape {
  halfHeight: number;
  radius: number;
  center: [number, number, number];
  lying: boolean;
}
const CAPSULES: Record<Posture, CapsuleShape> = {
  [Posture.Standing]: { halfHeight: 0.575, radius: 0.35, center: [0, 0.85, 0], lying: false },
  [Posture.Crouching]: { halfHeight: 0.25, radius: 0.35, center: [0, 0.525, 0], lying: false },
  [Posture.Prone]: { halfHeight: 0.5, radius: 0.25, center: [0, 0.175, 0.15], lying: true },
};

/** Eye height as a fraction of standing, and how far forward (m) the eyes are when lying down. */
const EYE: Record<Posture, { height: number; forward: number }> = {
  [Posture.Standing]: { height: 1, forward: 0 },
  [Posture.Crouching]: { height: 0.6, forward: 0.05 },
  [Posture.Prone]: { height: 0.2, forward: 0.5 },
};
/** Fallback eye height for the standing camera (PlayerRig's default). */
const DEFAULT_EYE = 1.64;

interface PostureState {
  remote: Map<string, Posture>;
  /** Container the local posture applies to (resets when the player rig is recreated). */
  container?: RemoteNode;
  /** When crouch was pressed from standing (holding it on goes prone). */
  heldSince?: number;
  lastBroadcast: number;
  shape: Posture;
}

export const PostureModule = defineModule<GameContext, PostureState>({
  name: "posture",
  create() {
    return { remote: new Map(), lastBroadcast: 0, shape: Posture.Standing };
  },
  init(ctx) {
    const network = getModule(ctx, NetworkModule);
    registerInboundMessageHandler(network, NetworkAction.HavenPosture, (ctx, v, peerId) => {
      const value = readUint32(v) as Posture;
      const module = getModule(ctx, PostureModule);
      if (value === Posture.Crouching || value === Posture.Prone) module.remote.set(peerId, value);
      else module.remote.delete(peerId);
    });
  },
});

// Buzzar: header (1 type + 8 time + 4 reserved = 13 bytes) + payload; 16 overflowed and crashed the game on C.
const messageView = createCursorView(new ArrayBuffer(64));
function createPostureMessage(posture: Posture) {
  writeMetadata(messageView, NetworkAction.HavenPosture);
  writeUint32(messageView, posture);
  return sliceCursorView(messageView);
}

const _q = new Quaternion();
const _v = new Vector3();
const LYING = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

function shapePose(body: RAPIER.RigidBody, shape: CapsuleShape) {
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _v.set(...shape.center).applyQuaternion(_q);
  const rotation = shape.lying ? _q.clone().multiply(LYING) : _q.clone();
  return {
    position: { x: t.x + _v.x, y: t.y + _v.y, z: t.z + _v.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
}

/** Whether the capsule for `posture` fits where the player is (nothing solid in the way). */
function fits(ctx: GameContext, body: RAPIER.RigidBody, collider: RAPIER.Collider, posture: Posture): boolean {
  const { physicsWorld } = getModule(ctx, PhysicsModule);
  const shape = CAPSULES[posture];
  // A hair smaller, so resting on the floor doesn't count as being blocked.
  const capsule = new RAPIER.Capsule(shape.halfHeight, shape.radius - 0.02);
  const { position, rotation } = shapePose(body, {
    ...shape,
    center: [shape.center[0], shape.center[1] + 0.03, shape.center[2]],
  });
  let blocked = false;
  physicsWorld.intersectionsWithShape(
    position,
    rotation,
    capsule,
    (other) => {
      if (other.handle === collider.handle || other.parent()?.handle === body.handle) return true;
      blocked = true;
      return false;
    },
    undefined, // not EXCLUDE_SENSORS: in this Rapier build it also drops dynamic bodies (see isSolid)
    collider.collisionGroups(),
    collider,
    body,
    isSolid
  );
  return !blocked;
}

function applyCapsule(collider: RAPIER.Collider, posture: Posture) {
  const shape = CAPSULES[posture];
  collider.setHalfHeight(shape.halfHeight);
  collider.setRadius(shape.radius);
  collider.setTranslationWrtParent({ x: shape.center[0], y: shape.center[1], z: shape.center[2] });
  const r = shape.lying ? LYING : new Quaternion();
  collider.setRotationWrtParent({ x: r.x, y: r.y, z: r.z, w: r.w });
}

function setLocalPosture(ctx: GameContext, module: PostureState, posture: Posture) {
  if (localPosture.value === posture) return;
  localPosture.value = posture;
  module.lastBroadcast = ctx.elapsed;
  broadcastReliable(ctx, getModule(ctx, NetworkModule), createPostureMessage(posture));
}

export function PostureSystem(ctx: GameContext) {
  const module = getModule(ctx, PostureModule);
  const network = getModule(ctx, NetworkModule);

  const eid = ourPlayerQuery(ctx.world)[0];
  const container = eid ? getRemoteResource<RemoteNode>(ctx, eid) : undefined;
  if (container !== module.container) {
    // New player rig (world load / respawn): start standing.
    module.container = container;
    module.shape = Posture.Standing;
    module.heldSince = undefined;
    localPosture.value = Posture.Standing;
  }

  const body = container?.physicsBody?.body;
  const collider = body?.collider(0);

  if (container && body && collider) {
    const input = getModule(ctx, InputModule);
    const crouch = input.actionStates.get(KinematicCharacterControllerActions.Crouch) as ButtonActionState | undefined;
    const prone = input.actionStates.get(KinematicCharacterControllerActions.Prone) as ButtonActionState | undefined;
    const jump = input.actionStates.get(KinematicCharacterControllerActions.Jump) as ButtonActionState | undefined;
    const now = ctx.elapsed / 1000;
    let wanted = localPosture.value;

    if (SeatedEntities.has(container.eid)) {
      wanted = Posture.Standing; // seats pose the avatar themselves
    } else {
      if (crouch?.pressed) {
        // Standing: crouch now (keep holding to go prone). Crouching or prone: stand up.
        if (localPosture.value === Posture.Standing) {
          wanted = Posture.Crouching;
          module.heldSince = now;
        } else {
          wanted = Posture.Standing;
          module.heldSince = undefined;
        }
      }
      if (!crouch?.held) module.heldSince = undefined;
      if (crouch?.held && module.heldSince !== undefined && now - module.heldSince >= HOLD_FOR_PRONE) {
        wanted = Posture.Prone;
        module.heldSince = undefined;
      }
      if (prone?.pressed) wanted = localPosture.value === Posture.Prone ? Posture.Standing : Posture.Prone;
      if (jump?.pressed && localPosture.value !== Posture.Standing) wanted = Posture.Standing;
    }

    // Only change when the new capsule fits (e.g. you can't stand up under a table). Prone→standing via crouching
    // if only that fits.
    if (wanted !== localPosture.value) {
      if (fits(ctx, body, collider, wanted)) setLocalPosture(ctx, module, wanted);
      else if (wanted === Posture.Standing && fits(ctx, body, collider, Posture.Crouching)) {
        setLocalPosture(ctx, module, Posture.Crouching);
      }
    }

    if (module.shape !== localPosture.value) {
      applyCapsule(collider, localPosture.value);
      module.shape = localPosture.value;
    }

    // Camera: ease to the posture's eye height (and forward, lying down).
    try {
      const anchor = getCamera(ctx, container).parent;
      if (anchor) {
        if (localPosture.value === Posture.Standing && localPosture.standingEye === undefined) {
          localPosture.standingEye = anchor.position[1] || DEFAULT_EYE;
        }
        const standing = localPosture.standingEye ?? DEFAULT_EYE;
        const eye = EYE[localPosture.value];
        const k = 1 - Math.exp(-ctx.dt * 10);
        anchor.position[1] += (standing * eye.height - anchor.position[1]) * k;
        anchor.position[2] += (-eye.forward - anchor.position[2]) * k;
      }
    } catch {
      // no camera (shouldn't happen for our own player)
    }

    if (localPosture.value !== Posture.Standing && ctx.elapsed - module.lastBroadcast > REBROADCAST_SECONDS * 1000) {
      module.lastBroadcast = ctx.elapsed;
      broadcastReliable(ctx, network, createPostureMessage(localPosture.value));
    }
  }

  // Peers that left.
  for (const peerId of module.remote.keys()) {
    if (!network.peers.includes(peerId)) module.remote.delete(peerId);
  }

  // Everyone not standing, for the animation system.
  PostureEntities.clear();
  if (container && localPosture.value !== Posture.Standing) PostureEntities.set(container.eid, localPosture.value);
  for (const [peerId, posture] of module.remote) {
    const peerEid = network.peerIdToEntityId.get(peerId);
    if (peerEid !== undefined) PostureEntities.set(peerEid, posture);
  }
}
