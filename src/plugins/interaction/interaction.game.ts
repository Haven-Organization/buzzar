import RAPIER, { QueryFilterFlags } from "@dimforge/rapier3d-compat";
import { defineComponent, Types, removeComponent, addComponent, hasComponent, defineQuery } from "bitecs";
import { vec3, mat4, quat, vec2 } from "gl-matrix";
import { Quaternion, Vector3, Vector4 } from "three";

import { playOneShotAudio } from "../../engine/audio/audio.game";
import { unproject } from "../../engine/camera/camera.game";
import { OurPlayer, ourPlayerQuery } from "../../engine/player/Player";
import { maxEntities, NOOP } from "../../engine/config.common";
import { GameContext } from "../../engine/GameTypes";
import { enableActionMap } from "../../engine/input/ActionMappingSystem";
import { GameInputModule, InputModule } from "../../engine/input/input.game";
import { defineModule, getModule, Thread } from "../../engine/module/module.common";
import {
  GameNetworkState,
  getPeerIndexFromNetworkId,
  NetworkModule,
  ownedNetworkedQuery,
} from "../../engine/network/network.game";
import { Networked, Owned } from "../../engine/network/NetworkComponents";
import { takeOwnership } from "../../engine/network/ownership.game";
import {
  addCollisionGroupMembership,
  FocusCollisionGroup,
  focusShapeCastCollisionGroups,
  GrabCollisionGroup,
  grabShapeCastCollisionGroups,
  removeCollisionGroupMembership,
} from "../../engine/physics/CollisionGroups";
import { PhysicsModule, PhysicsModuleState } from "../../engine/physics/physics.game";
import { Prefab } from "../../engine/prefab/prefab.game";
import { addResourceRef, getRemoteResource, tryGetRemoteResource } from "../../engine/resource/resource.game";
import {
  RemoteAudioData,
  RemoteAudioEmitter,
  RemoteAudioSource,
  RemoteInteractable,
  RemoteNode,
  RemoteUIButton,
  removeObjectFromWorld,
} from "../../engine/resource/RemoteResources";
import { AudioEmitterType, InteractableType } from "../../engine/resource/schema";
import { PortalComponent } from "../portals/portals.game";
import { InteractableAction, InteractionMessage, InteractionMessageType } from "./interaction.common";
import { ActionMap, ActionType, BindingType, ButtonActionState } from "../../engine/input/ActionMap";
import { XRAvatarRig } from "../../engine/input/WebXRAvatarRigSystem";
import { getRotationNoAlloc } from "../../engine/utils/getRotationNoAlloc";
import { jitterDirection } from "../../engine/utils/jitterDirection";
import { PlayerModule } from "../../engine/player/Player.game";
import { ZoomComponent, orbitAnchorQuery, OrbitAnchor } from "../../engine/player/CameraRig";
import {
  GameRendererModuleState,
  notifyUICanvasFocus,
  notifyUICanvasPressed,
  RendererModule,
} from "../../engine/renderer/renderer.game";
import { getCamera } from "../../engine/player/getCamera";
import { ThirdRoomMessageType } from "../thirdroom/thirdroom.common";
import { ThirdRoomModule, ThirdRoomModuleState } from "../thirdroom/thirdroom.game";
import { clamp } from "../../engine/common/math";
import { forgetUpright, isUpright, levelRotation, tiltOf, uprightEntities } from "../../engine/physics/upright";
import { padButton, PadButton } from "../../engine/input/gamepad.common";

// TODO: importing from spawnables.game in this file induces a runtime error
// import { SpawnablesModule } from "../spawnables/spawnables.game";

type InteractionModuleState = {
  clickEmitter?: RemoteAudioEmitter;
};

export const InteractionModule = defineModule<GameContext, InteractionModuleState>({
  name: "interaction",
  create() {
    return {};
  },
  async init(ctx) {
    const module = getModule(ctx, InteractionModule);
    const input = getModule(ctx, InputModule);

    const clickAudio1 = new RemoteAudioData(ctx.resourceManager, {
      name: "Click1 Audio Data",
      uri: "/audio/click1.wav",
    });
    addResourceRef(ctx, clickAudio1.eid);

    const clickAudio2 = new RemoteAudioData(ctx.resourceManager, {
      name: "Click2 Audio Data",
      uri: "/audio/click2.wav",
    });
    addResourceRef(ctx, clickAudio2.eid);

    const clickAudioSource1 = new RemoteAudioSource(ctx.resourceManager, {
      audio: clickAudio1,
      loop: false,
      autoPlay: false,
      gain: 0.2,
    });
    addResourceRef(ctx, clickAudioSource1.eid);

    const clickAudioSource2 = new RemoteAudioSource(ctx.resourceManager, {
      audio: clickAudio2,
      loop: false,
      autoPlay: false,
      gain: 0.2,
    });
    addResourceRef(ctx, clickAudioSource2.eid);

    module.clickEmitter = new RemoteAudioEmitter(ctx.resourceManager, {
      type: AudioEmitterType.Global,
      sources: [clickAudioSource1, clickAudioSource2],
    });

    addResourceRef(ctx, module.clickEmitter.eid);

    enableActionMap(input, InteractionActionMap);

    ctx.worldResource.persistentScene.audioEmitters = [
      ...ctx.worldResource.persistentScene.audioEmitters,
      module.clickEmitter,
    ];
  },
});

const InteractionActionMap: ActionMap = {
  id: "interaction",
  actionDefs: [
    {
      id: "grab",
      path: "Grab",
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Mouse/Left",
        },
        {
          type: BindingType.Button,
          path: "Keyboard/KeyE",
        },
        // Buzzar: gamepad R1 (or R2) grabs, uses and lets go, like E.
        { type: BindingType.Button, path: padButton(PadButton.RB) },
        { type: BindingType.Button, path: padButton(PadButton.RT) },
      ],
    },
    {
      id: "primaryTrigger",
      path: "primaryTrigger",
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "XRInputSource/primary/xr-standard-trigger",
        },
      ],
    },
    {
      id: "secondaryTrigger",
      path: "secondaryTrigger",
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "XRInputSource/secondary/xr-standard-trigger",
        },
      ],
    },
    {
      id: "primarySqueeze",
      path: "primarySqueeze",
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "XRInputSource/primary/xr-standard-squeeze",
        },
      ],
    },
    {
      id: "secondarySqueeze",
      path: "secondarySqueeze",
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "XRInputSource/secondary/xr-standard-squeeze",
        },
      ],
    },
    {
      id: "throw",
      path: "Throw",
      type: ActionType.Button,
      // Buzzar: right click only. Left click (like E) now just lets go of what you're holding; it used to throw too.
      bindings: [
        {
          type: BindingType.Button,
          path: "Mouse/Right",
        },
        { type: BindingType.Button, path: padButton(PadButton.X) },
      ],
    },
    {
      // Buzzar: turns what you're holding back to how it faces when it's spawned (straight ahead, upright).
      id: "recenter",
      path: "RecenterHeld",
      type: ActionType.Button,
      bindings: [
        { type: BindingType.Button, path: "Keyboard/KeyR" },
        { type: BindingType.Button, path: padButton(PadButton.B) },
      ],
    },
    {
      id: "delete",
      path: "Delete",
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/KeyX",
        },
        // Buzzar: D-pad left on a controller, and Delete in the touch controls' More panel.
        { type: BindingType.Button, path: padButton(PadButton.DpadLeft) },
      ],
    },
    {
      id: "scroll",
      path: "Scroll",
      type: ActionType.Vector2,
      bindings: [
        {
          type: BindingType.Axes,
          y: "Mouse/Scroll",
        },
      ],
    },
    {
      id: "screen-position",
      path: "ScreenPosition",
      type: ActionType.Vector2,
      bindings: [
        {
          type: BindingType.Axes,
          x: "Mouse/screenX",
          y: "Mouse/screenY",
        },
      ],
    },
  ],
};

export const Interactable = defineComponent(
  {
    type: Types.ui8,
    interactionDistance: Types.f32,
  },
  maxEntities
);

const FocusComponent = defineComponent(
  {
    focusedEntity: Types.eid,
    lastFocused: Types.eid,
  },
  maxEntities
);

export const GrabComponent = defineComponent(
  {
    grabbedEntity: Types.eid,
    heldOffset: Types.f32,
    joint: [Types.f32, 3],
  },
  maxEntities
);

const MAX_FOCUS_DISTANCE = 3.3;
const MIN_HELD_DISTANCE = 1.5;
const MAX_HELD_DISTANCE = 8;
export const GRAB_DISTANCE = 3.3;
/** Buzzar: how close (metres) you must be to focus/press an interactable (~arm's length plus a step). */
export const INTERACTION_DISTANCE = 3;
const HELD_MOVE_SPEED = 10;
const THROW_FORCE = 10;
/** Buzzar: throws tilt randomly by up to this much (3°). */
const THROW_JITTER = (3 * Math.PI) / 180;

const _direction = vec3.create();
const _source = vec3.create();
const _target = vec3.create();

const _impulse = new Vector3();

const _worldQuat = quat.create();

const shapeCastPosition = new Vector3();
const shapeCastRotation = new Quaternion();

const colliderShape = new RAPIER.Ball(0.01);

const _s = new Vector3();
const _t = new Vector3();

const _r = new Vector4();

const zero = new Vector3();

/**
 * Buzzar: the held object's rotation relative to the hand/camera, captured when it's grabbed. Third Room set the
 * object to the camera's rotation every frame, so it snapped to face you the moment you picked it up (#269).
 */
const heldRelativeRotation = new Map<number, { eid: number; rel: quat; tick: number }>();
const _bodyQuat = quat.create();
const _heldQuat = quat.create();

function holdRotation(
  tick: number,
  grabberEid: number,
  heldNode: RemoteNode,
  body: { rotation(): { x: number; y: number; z: number; w: number } }
) {
  const heldEid = heldNode.eid;
  let entry = heldRelativeRotation.get(grabberEid);
  // A new grab (another object, or not held on the previous frame) captures the rotation afresh.
  if (!entry || entry.eid !== heldEid || tick - entry.tick > 1) {
    const r = body.rotation();
    quat.set(_bodyQuat, r.x, r.y, r.z, r.w);
    const rel = quat.create();
    quat.multiply(rel, quat.invert(quat.create(), _worldQuat), _bodyQuat);
    entry = { eid: heldEid, rel, tick };
    heldRelativeRotation.set(grabberEid, entry);
  }
  entry.tick = tick;
  quat.multiply(_heldQuat, _worldQuat, entry.rel);
  // Buzzar: objects that stand upright (the trampoline) only take the hand's heading, never its tilt.
  return isUpright(heldNode) ? levelRotation(_heldQuat, _heldQuat) : _heldQuat;
}

/** Buzzar: makes what `grabberEid` holds face the way it does when spawned: lined up with the hand/view. */
function recenterHold(grabberEid: number) {
  const entry = heldRelativeRotation.get(grabberEid);
  if (entry) quat.identity(entry.rel);
}

/** Radians per second an upright object that's been left tilted turns back to level. */
const RIGHTING_SPEED = 4;
const _uprightQuat = quat.create();
const _levelQuat = quat.create();

/**
 * Buzzar: upright objects (engine/physics/upright.ts) left tilted settle back level, keeping their heading. Only
 * bodies this client simulates (dynamic, i.e. its own); other clients' copies follow the network.
 */
function settleUprightObjects(ctx: GameContext) {
  for (const [eid, marked] of uprightEntities()) {
    // Gone (e.g. its world was left): forget it. Never tryGetRemoteResource here: it throws, and an exception in a
    // system stops the game loop for good.
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    if (!node || node !== marked) {
      forgetUpright(eid);
      continue;
    }
    const body = node.physicsBody?.body;
    if (!body) continue;
    if (!body.isDynamic()) continue;
    const r = body.rotation();
    quat.set(_uprightQuat, r.x, r.y, r.z, r.w);
    const tilt = tiltOf(_uprightQuat);
    if (tilt < 0.002) continue;
    levelRotation(_levelQuat, _uprightQuat);
    const step = Math.min(1, (RIGHTING_SPEED * Math.max(ctx.dt, 0.001)) / tilt);
    quat.slerp(_uprightQuat, _uprightQuat, _levelQuat, step);
    body.setRotation(_r.set(_uprightQuat[0], _uprightQuat[1], _uprightQuat[2], _uprightQuat[3]), true);
  }
}

/** Most speed a dropped (not thrown) object keeps from being carried (m/s), so letting go doesn't fling it (#323). */
const MAX_DROP_SPEED = 2;

function settleDroppedBody(body: {
  linvel(): { x: number; y: number; z: number };
  setLinvel(v: Vector3, wake: boolean): void;
}) {
  const v = body.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed > MAX_DROP_SPEED) {
    const k = MAX_DROP_SPEED / speed;
    body.setLinvel(new Vector3(v.x * k, v.y * k, v.z * k), true);
  }
}

const interactableQuery = defineQuery([Interactable]);

/**
 * Buzzar: interactables pressed by this client's own player this frame. `interactable.pressed` is also set when
 * another player's press arrives, so anything that acts on the local player (e.g. a ladder's Climb Down) checks
 * this instead.
 */
export const pressedByOurPlayer = new Set<RemoteNode>();
/**
 * Buzzar: interactables our player can't use right now (e.g. a ladder's Climb Down while already on it). They aren't
 * focused (no prompt) or pressed by our player; plugins keep this up to date.
 */
export const unavailableToOurPlayer = new Set<RemoteNode>();

export function ResetInteractablesSystem(ctx: GameContext) {
  const interactableEntities = interactableQuery(ctx.world);
  pressedByOurPlayer.clear();

  for (let i = 0; i < interactableEntities.length; i++) {
    const eid = interactableEntities[i];

    if (Interactable.type[eid] !== InteractableType.Interactable && Interactable.type[eid] !== InteractableType.UI) {
      continue;
    }

    const remoteNode = getRemoteResource<RemoteNode | RemoteUIButton>(ctx, eid);
    const interactable = remoteNode?.interactable;

    if (interactable) {
      interactable.pressed = false;
      interactable.released = false;
    }
  }
}

export function InteractionSystem(ctx: GameContext) {
  const thirdroom = getModule(ctx, ThirdRoomModule);
  const network = getModule(ctx, NetworkModule);
  const physics = getModule(ctx, PhysicsModule);
  const input = getModule(ctx, InputModule);
  const interaction = getModule(ctx, InteractionModule);
  const camRigModule = getModule(ctx, PlayerModule);
  const renderer = getModule(ctx, RendererModule);

  settleUprightObjects(ctx);

  // TODO: refactor & make orbit handle multiple controllers
  if (camRigModule.orbiting) {
    updateOrbitInteraction(ctx, input, renderer, physics, interaction, camRigModule);
    return;
  }

  const eid = ourPlayerQuery(ctx.world)[0];

  if (eid) {
    const rig = tryGetRemoteResource<RemoteNode>(ctx, eid);
    const xr = XRAvatarRig.get(eid);

    if (xr && xr.leftRayEid && xr.rightRayEid) {
      const leftRay = tryGetRemoteResource<RemoteNode>(ctx, xr.leftRayEid);
      const rightRay = tryGetRemoteResource<RemoteNode>(ctx, xr.rightRayEid);

      // TODO: deletion
      // updateDeletion(ctx, interaction, input, eid);
      updateGrabThrowXR(ctx, physics, network, input, thirdroom, rig, leftRay, "left");
      updateGrabThrowXR(ctx, physics, network, input, thirdroom, rig, rightRay, "right");
    } else {
      const grabbingNode = getCamera(ctx, rig).parent!;

      updateFocus(ctx, physics, rig, grabbingNode);
      updateDeletion(ctx, interaction, input, eid);
      updateGrabThrow(ctx, interaction, physics, network, input, thirdroom, rig, grabbingNode);
    }
  }
}

function updateOrbitInteraction(
  ctx: GameContext,
  input: GameInputModule,
  renderer: GameRendererModuleState,
  physics: PhysicsModuleState,
  interaction: InteractionModuleState,
  camRigModule: { orbiting: boolean }
) {
  /**
   * Obtain relevant objects
   */

  const orbitAnchorEid = orbitAnchorQuery(ctx.world)[0];
  const orbitAnchor = OrbitAnchor.get(orbitAnchorEid);

  // TODO: CameraRef
  const zoom = ZoomComponent.get(orbitAnchorEid)!;
  const cameraEid = zoom.target;
  const camera = tryGetRemoteResource<RemoteNode>(ctx, cameraEid);

  /**
   * Raycast
   */

  // set source at focusing node's position
  mat4.getTranslation(_source, camera.worldMatrix);

  // set target at mouse screenspace, unproject, subtract source, then normalize
  const screenPosition = input.actionStates.get("ScreenPosition") as vec2;
  const x = (screenPosition[0] / renderer.canvasWidth) * 2 - 1;
  const y = -(screenPosition[1] / renderer.canvasHeight) * 2 + 1;
  vec3.set(_target, x, y, 0.5);
  vec3.copy(_target, unproject(renderer, camera, _target));
  vec3.sub(_target, _target, _source);
  vec3.normalize(_target, _target);

  vec3.scale(_target, _target, MAX_FOCUS_DISTANCE * 100);

  const s = _s.fromArray(_source);
  const t = _t.fromArray(_target);

  shapeCastPosition.copy(s);

  const hit = physics.physicsWorld.castShape(
    shapeCastPosition,
    shapeCastRotation,
    t,
    colliderShape,
    10.0,
    true,
    0 as QueryFilterFlags,
    focusShapeCastCollisionGroups
  );

  if (!hit) {
    return;
  }

  const focusedEid = physics.handleToEid.get(hit.collider.handle);
  if (!focusedEid) {
    console.warn(`Could not find entity for physics handle ${hit.collider.handle}`);
    return;
  }

  // ignore the object we are orbiting
  if (camRigModule.orbiting && orbitAnchor?.target === focusedEid) {
    return;
  }

  const focusedNode = tryGetRemoteResource<RemoteNode>(ctx, focusedEid);

  /**
   * Interaction
   */

  const grabBtn = input.actionStates.get("Grab") as ButtonActionState;

  if (!grabBtn.pressed) {
    return;
  }

  const interactable = focusedNode.interactable;

  if (interactable) {
    interactable.pressed = true;
    interactable.released = false;
    interactable.held = true;
    // Orbiting (this client's camera) is only ever our own player.
    pressedByOurPlayer.add(focusedNode);
  }

  if (Interactable.type[focusedNode.eid] === InteractableType.Interactable) {
    playOneShotAudio(ctx, interaction.clickEmitter?.sources[0] as RemoteAudioSource);
  } else if (Interactable.type[focusedNode.eid] === InteractableType.UI) {
    const projectedHit = projectHitOntoCanvas(ctx, hit, focusedNode);
    notifyUICanvasPressed(ctx, projectedHit, focusedNode);
  }
}

function hitscan(physics: PhysicsModuleState, node: RemoteNode, collisionGroup: number, distance: number) {
  const worldMatrix = node.worldMatrix;
  getRotationNoAlloc(_worldQuat, worldMatrix);

  // Buzzar: cast with a unit direction and maxToi = distance so `hit.toi` is in metres. Upstream scaled the
  // direction by `distance` and used maxToi 10, so the cast reached 10× too far and every
  // `toi <= interactionDistance` check compared a time factor rather than metres.
  const target = vec3.set(_target, 0, 0, -1);
  vec3.transformQuat(target, target, _worldQuat);

  const source = mat4.getTranslation(_source, worldMatrix);

  const s = _s.fromArray(source);
  const t = _t.fromArray(target);

  shapeCastPosition.copy(s);

  const hit = physics.physicsWorld.castShape(
    shapeCastPosition,
    shapeCastRotation,
    t,
    colliderShape,
    distance,
    true,
    0 as never,
    collisionGroup
  );
  return hit;
}

function updateFocus(ctx: GameContext, physics: PhysicsModuleState, rig: RemoteNode, focusingNode: RemoteNode) {
  const hit = hitscan(physics, focusingNode, focusShapeCastCollisionGroups, MAX_FOCUS_DISTANCE);

  // if there's no hit, clear focus
  if (!hit) {
    if (hasComponent(ctx.world, FocusComponent, rig.eid)) {
      removeComponent(ctx.world, FocusComponent, rig.eid, true);
      sendInteractionMessage(ctx, InteractableAction.Unfocus);
    }
    return;
  }

  const eid = physics.handleToEid.get(hit.collider.handle);
  if (!eid) {
    console.warn(`Could not find entity for physics handle ${hit.collider.handle}`);
    return;
  }

  const unavailable =
    unavailableToOurPlayer.size > 0 &&
    hasComponent(ctx.world, OurPlayer, rig.eid) &&
    unavailableToOurPlayer.has(tryGetRemoteResource<RemoteNode>(ctx, eid));

  // if within interaction distance, deem entity as focused
  if (!unavailable && hit.toi <= Interactable.interactionDistance[eid]) {
    addComponent(ctx.world, FocusComponent, rig.eid);
    FocusComponent.focusedEntity[rig.eid] = eid;

    // if it's render UI, don't sendInteractionMessage, render thread will report back with button focus
    if (Interactable.type[eid] === InteractableType.UI) {
      const node = tryGetRemoteResource<RemoteNode>(ctx, eid);
      const projectedHit = projectHitOntoCanvas(ctx, hit, node);
      notifyUICanvasFocus(ctx, projectedHit, node);
    } else {
      // only update react UI if it's our player or it's our orbit
      const ourPlayer = hasComponent(ctx.world, OurPlayer, rig.eid);
      if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Focus, eid);
    }
  } else {
    // if not within interaction distance, remove any existing focus
    removeComponent(ctx.world, FocusComponent, rig.eid, true);
    sendInteractionMessage(ctx, InteractableAction.Unfocus);
  }
}

function updateDeletion(ctx: GameContext, interaction: InteractionModuleState, input: GameInputModule, rig: number) {
  const deleteBtn = input.actionStates.get("Delete") as ButtonActionState;
  if (deleteBtn.pressed) {
    const focusedEid = FocusComponent.focusedEntity[rig];
    const focused = getRemoteResource<RemoteNode>(ctx, focusedEid);
    // TODO: For now we only delete owned objects
    if (
      focused &&
      hasComponent(ctx.world, Owned, focused.eid) &&
      Interactable.type[focused.eid] === InteractableType.Grabbable
    ) {
      removeObjectFromWorld(ctx, focused);
      playOneShotAudio(ctx, interaction.clickEmitter?.sources[1] as RemoteAudioSource, 0.4);
    }
  }
}

function projectHitOntoCanvas(ctx: GameContext, shapecastHit: RAPIER.ShapeColliderTOI, node: RemoteNode) {
  const { x, y, z } = shapecastHit.witness1;

  // convert to local space
  const hitPoint = vec3.clone([x, y, z]);
  vec3.sub(hitPoint, hitPoint, node.position);
  vec3.transformQuat(hitPoint, hitPoint, node.quaternion);

  return hitPoint;
}

function updateGrabThrow(
  ctx: GameContext,
  interaction: InteractionModuleState,
  physics: PhysicsModuleState,
  network: GameNetworkState,
  input: GameInputModule,
  thirdroom: ThirdRoomModuleState,
  rig: RemoteNode,
  grabbingNode: RemoteNode
) {
  let heldEntity = GrabComponent.grabbedEntity[rig.eid];
  let heldOffset = GrabComponent.heldOffset[rig.eid];

  const grabBtn = input.actionStates.get("Grab") as ButtonActionState;
  const primaryTrigger = input.actionStates.get("primaryTrigger") as ButtonActionState;
  const secondaryTrigger = input.actionStates.get("secondaryTrigger") as ButtonActionState;
  const throwBtn = input.actionStates.get("Throw") as ButtonActionState;

  const grabPressed = grabBtn.pressed || primaryTrigger.held || secondaryTrigger.held;
  const grabReleased = grabBtn.released || primaryTrigger.released || secondaryTrigger.released;
  const throwPressed = throwBtn.pressed;

  const ourPlayer = hasComponent(ctx.world, OurPlayer, rig.eid);

  // if holding and entity and throw is pressed
  if (heldEntity && throwPressed) {
    removeComponent(ctx.world, GrabComponent, rig.eid, true);

    getRotationNoAlloc(_worldQuat, grabbingNode.worldMatrix);
    const direction = vec3.set(_direction, 0, 0, -1);
    vec3.transformQuat(direction, direction, _worldQuat);
    vec3.scale(direction, direction, THROW_FORCE);
    // Buzzar: a little variation, so repeated throws don't all fly the exact same path (Third Room #297).
    jitterDirection(direction, THROW_JITTER);

    // fire!
    _impulse.fromArray(direction);
    const heldNode = getRemoteResource<RemoteNode>(ctx, heldEntity);
    if (!heldNode || !heldNode.physicsBody || !heldNode.physicsBody.body) {
      throw new Error(`No physics body found on entity ${heldEntity}`);
    }

    heldNode.physicsBody.body.applyImpulse(_impulse, true);

    if (ourPlayer) {
      sendInteractionMessage(ctx, InteractableAction.Release, heldEntity);
      sendInteractionMessage(ctx, InteractableAction.Unfocus);
    }

    playOneShotAudio(ctx, interaction.clickEmitter?.sources[0] as RemoteAudioSource, 1, 0.6);

    GrabComponent.heldOffset[rig.eid] = 0;

    // if holding an entity and grab is pressed again
  } else if (grabPressed && heldEntity) {
    // release
    removeComponent(ctx.world, GrabComponent, rig.eid, true);
    const droppedBody = getRemoteResource<RemoteNode>(ctx, heldEntity)?.physicsBody?.body;
    if (droppedBody) settleDroppedBody(droppedBody);

    if (ourPlayer) {
      sendInteractionMessage(ctx, InteractableAction.Release, heldEntity);
      sendInteractionMessage(ctx, InteractableAction.Unfocus);
    }

    playOneShotAudio(ctx, interaction.clickEmitter?.sources[0] as RemoteAudioSource, 1, 0.6);

    GrabComponent.heldOffset[rig.eid] = 0;
  } else {
    const hit = hitscan(physics, grabbingNode, grabShapeCastCollisionGroups, GRAB_DISTANCE);

    if (hit !== null) {
      const eid = physics.handleToEid.get(hit.collider.handle);
      const node = eid ? getRemoteResource<RemoteNode>(ctx, eid) : undefined;

      if (!node || !eid) {
        console.warn(`Could not find entity for physics handle ${hit.collider.handle}`);
      } else if (ourPlayer && unavailableToOurPlayer.has(node)) {
        // Buzzar: not usable right now (no prompt shown either).
      } else if (hit.toi <= Interactable.interactionDistance[node.eid]) {
        if (grabPressed) {
          if (Interactable.type[node.eid] === InteractableType.Grabbable) {
            playOneShotAudio(ctx, interaction.clickEmitter?.sources[0] as RemoteAudioSource);
            const ownedEnts = ownedNetworkedQuery(ctx.world);
            if (ownedEnts.length > thirdroom.maxObjectCap && !hasComponent(ctx.world, Owned, node.eid)) {
              // do nothing if we hit the max obj cap
              ctx.sendMessage(Thread.Main, {
                type: ThirdRoomMessageType.ObjectCapReached,
              });
            } else {
              // otherwise attempt to take ownership
              const newEid = takeOwnership(ctx, network, node);
              if (newEid !== NOOP) {
                addComponent(ctx.world, GrabComponent, rig.eid);
                GrabComponent.grabbedEntity[rig.eid] = newEid;
                heldEntity = newEid;
                if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Grab, newEid);
              } else {
                addComponent(ctx.world, GrabComponent, rig.eid);
                GrabComponent.grabbedEntity[rig.eid] = eid;
                if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Grab, eid);
              }
            }
          } else if (Interactable.type[node.eid] === InteractableType.Interactable) {
            playOneShotAudio(ctx, interaction.clickEmitter?.sources[0] as RemoteAudioSource);

            if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Interact, eid);
            if (ourPlayer) pressedByOurPlayer.add(node);
            const interactable = node.interactable;

            if (interactable) {
              interactable.pressed = true;
              interactable.released = false;
              interactable.held = true;
            }
          } else if (Interactable.type[node.eid] === InteractableType.UI) {
            const interactable = node.interactable;

            if (interactable) {
              interactable.pressed = true;
              interactable.released = false;
              interactable.held = true;
            }

            const projectedHit = projectHitOntoCanvas(ctx, hit, node);
            notifyUICanvasPressed(ctx, projectedHit, node);
          } else {
            if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Grab, eid);
          }
        }
      }
    }
  }

  if (grabReleased) {
    const interactableEntities = interactableQuery(ctx.world);

    for (let i = 0; i < interactableEntities.length; i++) {
      const eid = interactableEntities[i];

      if (Interactable.type[eid] !== InteractableType.Interactable) {
        continue;
      }

      const remoteNode = getRemoteResource<RemoteNode>(ctx, eid);
      const interactable = remoteNode?.interactable;

      if (interactable) {
        interactable.pressed = false;
        interactable.released = true;
        interactable.held = false;
      }
    }
  }

  // if still holding entity, move towards the held point
  heldEntity = GrabComponent.grabbedEntity[rig.eid];

  const heldNode = getRemoteResource<RemoteNode>(ctx, heldEntity);

  if (heldNode) {
    const recenter = input.actionStates.get("RecenterHeld") as ButtonActionState | undefined;
    if (recenter?.pressed) recenterHold(rig.eid);

    // move held point upon scrolling
    const [, scrollY] = input.actionStates.get("Scroll") as vec2;
    if (scrollY !== 0) {
      heldOffset -= scrollY / 1000;
    }
    GrabComponent.heldOffset[rig.eid] = clamp(heldOffset, MIN_HELD_DISTANCE, MAX_HELD_DISTANCE);

    const heldPosition = heldNode.position;

    const target = _target;
    mat4.getTranslation(target, grabbingNode.worldMatrix);

    getRotationNoAlloc(_worldQuat, grabbingNode.worldMatrix);
    const direction = vec3.set(_direction, 0, 0, 1);
    vec3.transformQuat(direction, direction, _worldQuat);

    vec3.scale(direction, direction, MIN_HELD_DISTANCE + heldOffset);

    vec3.sub(target, target, direction);

    vec3.sub(target, target, heldPosition);

    vec3.scale(target, target, HELD_MOVE_SPEED - heldOffset / 2);

    const body = heldNode.physicsBody?.body;
    if (body) {
      body.setLinvel(_impulse.fromArray(target), true);
      body.setAngvel(zero, true);
      body.setRotation(_r.fromArray(holdRotation(ctx.tick, rig.eid, heldNode, body)), true);
    }
  }
}

function updateGrabThrowXR(
  ctx: GameContext,
  physics: PhysicsModuleState,
  network: GameNetworkState,
  controller: GameInputModule,
  thirdroom: ThirdRoomModuleState,
  rig: RemoteNode,
  grabbingNode: RemoteNode,
  hand: XRHandedness
) {
  const hit = hitscan(physics, grabbingNode, grabShapeCastCollisionGroups, GRAB_DISTANCE);

  if (hit === null) {
    grabbingNode.visible = true;
    return;
  }

  let focusedEntity = physics.handleToEid.get(hit.collider.handle);

  if (!focusedEntity) {
    grabbingNode.visible = true;
    return;
  }

  const triggerState = controller.actionStates.get(
    hand === "right" ? "primaryTrigger" : "secondaryTrigger"
  ) as ButtonActionState;

  const squeezeState = controller.actionStates.get(
    hand === "right" ? "primarySqueeze" : "secondarySqueeze"
  ) as ButtonActionState;

  if (triggerState.pressed || squeezeState.held) {
    let focusedNode = tryGetRemoteResource<RemoteNode>(ctx, focusedEntity);
    const ourPlayer = hasComponent(ctx.world, OurPlayer, rig.eid);

    if (hit.toi <= Interactable.interactionDistance[focusedNode.eid]) {
      if (squeezeState.held && Interactable.type[focusedNode.eid] === InteractableType.Grabbable) {
        const ownedEnts = ownedNetworkedQuery(ctx.world);
        if (ownedEnts.length > thirdroom.maxObjectCap && !hasComponent(ctx.world, Owned, focusedNode.eid)) {
          // do nothing if we hit the max obj cap
          // TODO: websgui
          // ctx.sendMessage(Thread.Main, {
          //   type: ObjectCapReachedMessageType,
          // });
        } else {
          // otherwise attempt to take ownership
          const newEid = takeOwnership(ctx, network, focusedNode);

          if (newEid !== NOOP) {
            focusedEntity = newEid;
            // TODO: websgui
            // if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Grab, newEid);
          } else {
            // TODO: websgui
            // if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Grab, focusedEntity);
          }
        }
      } else if (triggerState.pressed && Interactable.type[focusedNode.eid] === InteractableType.Interactable) {
        if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Interact, focusedEntity);
        const node = tryGetRemoteResource<RemoteNode>(ctx, focusedNode.eid);
        if (ourPlayer) pressedByOurPlayer.add(node);
        const interactable = node.interactable;

        if (interactable) {
          interactable.pressed = true;
          interactable.released = false;
          interactable.held = true;
        }
      } else if (triggerState.pressed && Interactable.type[focusedNode.eid] === InteractableType.UI) {
        const interactable = focusedNode.interactable;

        if (interactable) {
          interactable.pressed = true;
          interactable.released = false;
          interactable.held = true;
        }

        const projectedHit = projectHitOntoCanvas(ctx, hit, focusedNode);
        notifyUICanvasPressed(ctx, projectedHit, focusedNode);
      } else {
        if (ourPlayer) sendInteractionMessage(ctx, InteractableAction.Grab, focusedEntity);
      }
    }

    if (!squeezeState.held) {
      return;
    }

    grabbingNode.visible = false;

    focusedNode = tryGetRemoteResource<RemoteNode>(ctx, focusedEntity);

    const focusedPosition = focusedNode.position;

    const target = _target;
    mat4.getTranslation(target, grabbingNode.worldMatrix);

    getRotationNoAlloc(_worldQuat, grabbingNode.worldMatrix);
    const direction = vec3.set(_direction, 0, 0, 1);
    vec3.transformQuat(direction, direction, _worldQuat);
    vec3.scale(direction, direction, 0.5);

    vec3.sub(target, target, direction);

    vec3.sub(target, target, focusedPosition);

    vec3.scale(target, target, HELD_MOVE_SPEED * 2);

    const body = focusedNode.physicsBody?.body;
    if (body) {
      body.setLinvel(_impulse.fromArray(target), true);
      body.setAngvel(zero, true);
      body.setRotation(_r.fromArray(holdRotation(ctx.tick, grabbingNode.eid, focusedNode, body)), true);
    }
  } else {
    grabbingNode.visible = true;
  }
}

/** Buzzar: whether the local player is holding `eid`. */
export function isHeldByUs(ctx: GameContext, eid: number) {
  const player = ourPlayerQuery(ctx.world)[0];
  return !!player && hasComponent(ctx.world, GrabComponent, player) && GrabComponent.grabbedEntity[player] === eid;
}

export function sendInteractionMessage(ctx: GameContext, action: InteractableAction, eid = NOOP) {
  const network = getModule(ctx, NetworkModule);

  const interactableType = Interactable.type[eid];

  if (!eid || !interactableType) {
    ctx.sendMessage<InteractionMessage>(Thread.Main, {
      type: InteractionMessageType,
      action,
    });
  } else {
    let peerId;

    if (interactableType === InteractableType.Grabbable || interactableType === InteractableType.Player) {
      peerId = network.entityIdToPeerId.get(eid);
    }

    let ownerId;

    if (interactableType === InteractableType.Grabbable) {
      const ownerIdIndex = getPeerIndexFromNetworkId(Networked.networkId[eid]);
      ownerId = network.indexToPeerId.get(ownerIdIndex);
      if (hasComponent(ctx.world, Owned, eid)) {
        ownerId = peerId;
      }
    }

    let uri;

    if (interactableType === InteractableType.Portal) {
      uri = PortalComponent.get(eid)?.uri;
    }

    const name =
      getRemoteResource<RemoteUIButton>(ctx, eid)?.label ||
      Prefab.get(eid) ||
      getRemoteResource<RemoteNode>(ctx, eid)?.name;

    ctx.sendMessage<InteractionMessage>(Thread.Main, {
      type: InteractionMessageType,
      interactableType,
      name,
      // Buzzar: GrabComponent sits on the player doing the grabbing, not on the object, so this was always false
      // and the prompt never switched to Drop / Throw.
      held: isHeldByUs(ctx, eid),
      action,
      peerId,
      ownerId,
      uri,
    });
  }
}

export function addInteractableComponent(
  ctx: GameContext,
  physics: PhysicsModuleState,
  node: RemoteNode | RemoteUIButton,
  interactableType: InteractableType
) {
  const eid = node.eid;
  addComponent(ctx.world, Interactable, eid);
  Interactable.type[eid] = interactableType;
  // Metres. Focus (highlight + key prompt) and presses only happen within this distance.
  Interactable.interactionDistance[eid] = INTERACTION_DISTANCE;

  node.interactable = new RemoteInteractable(ctx.resourceManager, { type: interactableType });

  const body = (node as RemoteNode).physicsBody?.body;
  if (!body) {
    console.warn(
      `Adding interactable component to entity "${eid}" without a RigidBody component. This entity will not be interactable.`
    );
    return;
  }

  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i);

    let collisionGroups = collider.collisionGroups();

    collisionGroups = addCollisionGroupMembership(collisionGroups, FocusCollisionGroup);
    collisionGroups = addCollisionGroupMembership(collisionGroups, GrabCollisionGroup);

    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    collider.setCollisionGroups(collisionGroups);
  }
}

export function removeInteractableComponent(ctx: GameContext, physics: PhysicsModuleState, node: RemoteNode) {
  removeComponent(ctx.world, Interactable, node.eid);

  const body = node.physicsBody?.body;
  if (!body) {
    console.warn(
      `Removing interactable component from entity "${node.name}" without a physics body. This entity will not be interactable.`
    );
    return;
  }

  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i);

    let collisionGroups = collider.collisionGroups();

    collisionGroups = removeCollisionGroupMembership(collisionGroups, FocusCollisionGroup);
    collisionGroups = removeCollisionGroupMembership(collisionGroups, GrabCollisionGroup);

    collider.setCollisionGroups(collisionGroups);
  }
}

/** Buzzar: the entity our own player is currently pointing at (0 = nothing). Used for hover highlights. */
export function getOurFocusedEntity(ctx: GameContext): number {
  const rigEid = ourPlayerQuery(ctx.world)[0];
  if (!rigEid || !hasComponent(ctx.world, FocusComponent, rigEid)) return 0;
  return FocusComponent.focusedEntity[rigEid];
}
