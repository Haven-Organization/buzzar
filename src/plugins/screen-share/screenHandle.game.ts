/**
 * Buzzar (Third Room #398): the handle under your own floating shared screen (engine/screenshare). Grab it to carry
 * the screen around and turn it (hold R and move the mouse: it only turns around and tilts up or down); it can't be thrown, stays where you let go, and Delete on it
 * stops sharing. Only the sharer has one: everyone else's screen follows the moves the sharer sends.
 */
import { vec3, quat } from "gl-matrix";

import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule, registerMessageHandler, Thread } from "../../engine/module/module.common";
import { addPhysicsBody, addPhysicsCollider, PhysicsModule } from "../../engine/physics/physics.game";
import {
  addObjectToWorld,
  removeObjectFromWorld,
  RemoteCollider,
  RemoteNode,
  RemotePhysicsBody,
} from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import { ColliderType, InteractableType, PhysicsBodyType } from "../../engine/resource/schema";
import { ScreenHandleMessage, ScreenShareMessageType } from "../../engine/screenshare/screenShare.common";
import { createDisposables } from "../../engine/utils/createDisposables";
import { addInteractableComponent, grabBehaviours, isHeldByUs } from "../interaction/interaction.game";

/** The handle's grab box (metres): a bar under the picture. */
const HANDLE_SIZE: [number, number, number] = [0.5, 0.14, 0.14];
/** Report a move once it's this far (metres) or this much turned (quaternion dot below this). */
const MOVE_EPSILON = 0.002;
const TURN_EPSILON = 0.99999;

interface HandleState {
  node?: RemoteNode;
  /** Where it rests when not held. */
  position: vec3;
  rotation: quat;
  /** Last reported to the main thread. */
  reportedPosition: vec3;
  reportedRotation: quat;
}

export const ScreenHandleModule = defineModule<GameContext, HandleState>({
  name: "screen-handle",
  create() {
    return {
      position: vec3.create(),
      rotation: quat.create(),
      reportedPosition: vec3.create(),
      reportedRotation: quat.create(),
    };
  },
  init(ctx) {
    return createDisposables([
      registerMessageHandler(ctx, ScreenShareMessageType.SetHandle, (ctx, message) => {
        const { position, rotation } = message as unknown as ScreenHandleMessage;
        setHandle(ctx, position, rotation);
      }),
      registerMessageHandler(ctx, ScreenShareMessageType.RemoveHandle, (ctx) => removeHandle(ctx)),
    ]);
  },
});

function liveHandle(ctx: GameContext): RemoteNode | undefined {
  const state = getModule(ctx, ScreenHandleModule);
  const node = state.node;
  if (!node) return undefined;
  // Gone with its world.
  if (getRemoteResource(ctx, node.eid) !== node) {
    state.node = undefined;
    return undefined;
  }
  return node;
}

function setHandle(ctx: GameContext, position: number[], rotation: number[]) {
  const state = getModule(ctx, ScreenHandleModule);
  vec3.set(state.position, position[0], position[1], position[2]);
  quat.set(state.rotation, rotation[0], rotation[1], rotation[2], rotation[3]);
  vec3.copy(state.reportedPosition, state.position);
  quat.copy(state.reportedRotation, state.rotation);

  const existing = liveHandle(ctx);
  if (existing) {
    pin(existing, state);
    return;
  }

  const physics = getModule(ctx, PhysicsModule);
  const node = new RemoteNode(ctx.resourceManager, {
    name: "Your Shared Screen",
    position: Array.from(state.position),
    quaternion: Array.from(state.rotation),
  });
  // A sensor: grabbable and focusable, but nobody bumps into it or stands on it.
  addPhysicsCollider(
    ctx.world,
    node,
    new RemoteCollider(ctx.resourceManager, { type: ColliderType.Box, size: HANDLE_SIZE, isTrigger: true })
  );
  addPhysicsBody(ctx.world, physics, node, new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Rigid }));
  node.physicsBody?.body?.setGravityScale(0, true);
  addObjectToWorld(ctx, node);
  addInteractableComponent(ctx, physics, node, InteractableType.Grabbable);
  grabBehaviours.set(node.eid, {
    noThrow: true,
    stayPut: true,
    // Turn it around or tilt it up/down, never crooked.
    rotation: "yaw-pitch",
    deleteLabel: "Stop Sharing",
    onDelete: (ctx) => ctx.sendMessage(Thread.Main, { type: ScreenShareMessageType.HandleDeleted }),
  });
  state.node = node;
}

function removeHandle(ctx: GameContext) {
  const state = getModule(ctx, ScreenHandleModule);
  const node = liveHandle(ctx);
  state.node = undefined;
  if (!node) return;
  grabBehaviours.delete(node.eid);
  removeObjectFromWorld(ctx, node);
}

const _v = { x: 0, y: 0, z: 0 };
const _q = { x: 0, y: 0, z: 0, w: 1 };
const zero = { x: 0, y: 0, z: 0 };

/** Hold the handle where it rests (nothing else moves it: it has no gravity, but carried things could nudge it). */
function pin(node: RemoteNode, state: HandleState) {
  const body = node.physicsBody?.body;
  if (!body) return;
  _v.x = state.position[0];
  _v.y = state.position[1];
  _v.z = state.position[2];
  _q.x = state.rotation[0];
  _q.y = state.rotation[1];
  _q.z = state.rotation[2];
  _q.w = state.rotation[3];
  body.setTranslation(_v, true);
  body.setRotation(_q, true);
  body.setLinvel(zero, true);
  body.setAngvel(zero, true);
}

/** While carried, the screen follows the handle: report each move to the main thread (which tells everyone). */
export function ScreenHandleSystem(ctx: GameContext) {
  const node = liveHandle(ctx);
  if (!node) return;
  const state = getModule(ctx, ScreenHandleModule);
  const body = node.physicsBody?.body;
  if (!body) return;

  if (!isHeldByUs(ctx, node.eid)) {
    pin(node, state);
    return;
  }

  const t = body.translation();
  const r = body.rotation();
  vec3.set(state.position, t.x, t.y, t.z);
  quat.set(state.rotation, r.x, r.y, r.z, r.w);
  const moved = vec3.distance(state.position, state.reportedPosition) > MOVE_EPSILON;
  const turned = Math.abs(quat.dot(state.rotation, state.reportedRotation)) < TURN_EPSILON;
  if (!moved && !turned) return;
  vec3.copy(state.reportedPosition, state.position);
  quat.copy(state.reportedRotation, state.rotation);
  ctx.sendMessage<ScreenHandleMessage>(Thread.Main, {
    type: ScreenShareMessageType.HandleMoved,
    position: [state.position[0], state.position[1], state.position[2]],
    rotation: [state.rotation[0], state.rotation[1], state.rotation[2], state.rotation[3]],
  });
}
