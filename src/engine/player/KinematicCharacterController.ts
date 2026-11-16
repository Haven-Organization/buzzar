import { addComponent, defineComponent, defineQuery, enterQuery } from "bitecs";
import RAPIER from "@dimforge/rapier3d-compat";
import { RawCharacterCollision } from "@dimforge/rapier3d-compat/raw";
import { Quaternion, Vector3 } from "three";

import { localPosture, Posture, POSTURE_SPEED } from "./posture.common";
import { SeatedEntities } from "../animation/animation.game";
import { GameContext } from "../GameTypes";
import { enableActionMap } from "../input/ActionMappingSystem";
import { ActionMap, ActionState, ActionType, BindingType, ButtonActionState } from "../input/ActionMap";
import { InputModule } from "../input/input.game";
import { defineModule, getModule, registerMessageHandler, Thread } from "../module/module.common";
import { PhysicsModule, PhysicsModuleState } from "../physics/physics.game";
import { tryGetRemoteResource } from "../resource/resource.game";
import { RemoteNode } from "../resource/RemoteResources";
import { playOneShotAudio } from "../audio/audio.game";
import randomRange from "../utils/randomRange";

function kinematicCharacterControllerAction(key: string) {
  return "KinematicCharacterController/" + key;
}

export const KinematicCharacterControllerActions = {
  Move: kinematicCharacterControllerAction("Move"),
  Jump: kinematicCharacterControllerAction("Jump"),
  Sprint: kinematicCharacterControllerAction("Sprint"),
  Crouch: kinematicCharacterControllerAction("Crouch"),
  Prone: kinematicCharacterControllerAction("Prone"),
};

export const KinematicCharacterControllerActionMap: ActionMap = {
  id: "kinematic-character-controller",
  actionDefs: [
    {
      id: "move",
      path: KinematicCharacterControllerActions.Move,
      type: ActionType.Vector2,
      bindings: [
        {
          type: BindingType.DirectionalButtons,
          up: "Keyboard/KeyW",
          down: "Keyboard/KeyS",
          left: "Keyboard/KeyA",
          right: "Keyboard/KeyD",
        },
        {
          type: BindingType.Axes,
          x: "XRInputSource/secondary/xr-standard-thumbstick/x-axis",
          y: "XRInputSource/secondary/xr-standard-thumbstick/y-axis",
        },
      ],
    },
    {
      id: "jump",
      path: KinematicCharacterControllerActions.Jump,
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/Space",
        },
        {
          type: BindingType.Button,
          path: "XRInputSource/primary/xr-standard-thumbstick/button",
        },
      ],
    },
    {
      id: "crouch",
      path: KinematicCharacterControllerActions.Crouch,
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/KeyC",
        },
      ],
    },
    {
      id: "prone",
      path: KinematicCharacterControllerActions.Prone,
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/KeyZ",
        },
      ],
    },
    {
      id: "sprint",
      path: KinematicCharacterControllerActions.Sprint,
      type: ActionType.Button,
      bindings: [
        {
          type: BindingType.Button,
          path: "Keyboard/ShiftLeft",
        },
        {
          type: BindingType.Button,
          path: "XRInputSource/secondary/xr-standard-thumbstick/button",
        },
      ],
    },
  ],
};

type KinematicCharacterControllerModuleState = {};

export const KinematicCharacterControllerModule = defineModule<GameContext, KinematicCharacterControllerModuleState>({
  name: "kinematic-character-controller",
  create() {
    return {};
  },
  init(ctx) {
    const input = getModule(ctx, InputModule);
    enableActionMap(input, KinematicCharacterControllerActionMap);
    // Buzzar debug: `thirdroom.playerDebug()` in the console logs the local player's movement state.
    return registerMessageHandler(ctx, PlayerDebugMessage, () => logPlayerDebug(ctx));
  },
});

export const KinematicControls = defineComponent();
export const kinematicControlsQuery = defineQuery([KinematicControls]);
export const enteredKinematicControlsQuery = enterQuery(kinematicControlsQuery);

export const _q = new Quaternion();

export const walkAccel = 100;
export const drag = 10;
export const maxWalkSpeed = 20;
export const maxSprintSpeed = 50;
export const sprintModifier = 2.5;
export const jumpForce = 7;
export const inAirModifier = 0.5;
export const inAirDrag = 6;
export const crouchModifier = 0.7;
export const crouchJumpModifier = 1.5;
export const minSlideSpeed = 3;
export const slideModifier = 50;
export const slideDrag = 150;
export const slideCooldown = 1;

export const _acceleration = new Vector3();
export const _dragForce = new Vector3();
export const _linearVelocity = new Vector3();
export let isSliding = false;
export const _slideForce = new Vector3();
export let lastSlideTime = 0;

let lastFootstepFrame = 0;

export function addKinematicControls(ctx: GameContext, eid: number) {
  addComponent(ctx.world, KinematicControls, eid);
}

function cameraHeadBob(ctx: GameContext, rig: RemoteNode, speed: number, isGrounded: boolean, isSprinting: boolean) {
  if (speed > 0.1 && isGrounded) {
    const amplitude = 0.04;
    const time = ctx.elapsed;
    const frequency = isSprinting ? 0.003 : 0.0015; // radians per second
    const phase = 0;
    const delta = amplitude * Math.sin(2 * Math.PI * time * frequency + phase);

    if (delta > 0.039 && ctx.tick > lastFootstepFrame + 10) {
      // footstep
      const audioSources = rig.audioEmitter!.sources.filter((s) => s.audio?.uri.includes("footstep"));
      if (audioSources.length) {
        const i = Math.floor(randomRange(0, audioSources.length));
        playOneShotAudio(ctx, audioSources[i], 0.2, randomRange(0.6, 0.9));
      }
      lastFootstepFrame = ctx.tick;
    }
  }
}

export function updateKinematicControls(
  ctx: GameContext,
  { physicsWorld, collisionHandlers, handleToEid, characterCollision, eidTocharacterController }: PhysicsModuleState,
  actionStates: Map<string, ActionState>,
  rig: RemoteNode,
  body: RAPIER.RigidBody
) {
  _q.fromArray(rig.quaternion);
  body.setNextKinematicRotation(_q);

  const characterController = eidTocharacterController.get(rig.eid)!;

  // Handle Input
  const moveVec = actionStates.get(KinematicCharacterControllerActions.Move) as Float32Array;
  const jump = actionStates.get(KinematicCharacterControllerActions.Jump) as ButtonActionState;
  const crouch = actionStates.get(KinematicCharacterControllerActions.Crouch) as ButtonActionState;
  const sprint = actionStates.get(KinematicCharacterControllerActions.Sprint) as ButtonActionState;

  _linearVelocity.copy(body.linvel() as Vector3);

  const isGrounded = characterController.computedGrounded();
  const isSprinting = isGrounded && sprint.held && !isSliding && localPosture.value === Posture.Standing;

  const speed = Math.sqrt(_linearVelocity.x * _linearVelocity.x + _linearVelocity.z * _linearVelocity.z);

  _acceleration.set(moveVec[0], 0, -moveVec[1]).normalize().applyQuaternion(_q).multiplyScalar(walkAccel);

  // Buzzar: crouching and prone (plugins/posture) are slower; only standing players sprint.
  const standing = localPosture.value === Posture.Standing;
  if (!isGrounded) {
    _acceleration.multiplyScalar(inAirModifier);
  } else if (!isSliding) {
    if (!standing) {
      _acceleration.multiplyScalar(POSTURE_SPEED[localPosture.value]);
    } else if (sprint.held) {
      _acceleration.multiplyScalar(sprintModifier);
    }
  }

  if (isSprinting) {
    _acceleration.clampLength(0, maxSprintSpeed);
  } else {
    _acceleration.clampLength(0, maxWalkSpeed);
  }

  _acceleration.y = physicsWorld.gravity.y * 1.5;

  // TODO: Check to see if velocity matches orientation before sliding
  // Buzzar: upstream compared ctx.dt (seconds per frame) with a timestamp (ms), so sliding could only start on a
  // >1 s frame hitch (e.g. while a world/avatar loads) and then never time out, only ending on releasing crouch.
  const nowSeconds = ctx.elapsed / 1000;
  if (
    crouch.pressed &&
    speed > minSlideSpeed &&
    isGrounded &&
    !isSliding &&
    nowSeconds > lastSlideTime + slideCooldown
  ) {
    _slideForce.set(0, 0, (speed + 1) * -slideModifier).applyQuaternion(_q);
    _acceleration.add(_slideForce);
    isSliding = true;
    lastSlideTime = nowSeconds;
  } else if (crouch.released || nowSeconds > lastSlideTime + slideCooldown) {
    isSliding = false;
  }

  // Jumping while crouched or prone stands you up instead (plugins/posture).
  if (jump.pressed && isGrounded && standing) {
    _linearVelocity.y += jumpForce;
  }

  if (speed !== 0) {
    let dragMultiplier = drag;

    if (isSliding) {
      dragMultiplier = slideDrag;
    } else if (!isGrounded) {
      dragMultiplier = sprint.held ? inAirDrag / 1.5 : inAirDrag;
    }

    _dragForce.copy(_linearVelocity).negate().multiplyScalar(dragMultiplier);

    _dragForce.y = 0;

    _acceleration.add(_dragForce);
  }

  cameraHeadBob(ctx, rig, speed, isGrounded, isSprinting);

  _acceleration.multiplyScalar(ctx.dt);

  _linearVelocity.add(_acceleration).multiplyScalar(ctx.dt);

  const translation = body.nextTranslation();

  const collider = body.collider(0);

  // Buzzar: sensors (seat and other click areas) are for interaction only; without this filter Rapier treats
  // them as solid, so invisible boxes blocked walking. Not QueryFilterFlags.EXCLUDE_SENSORS: in this Rapier build
  // that flag also drops colliders on dynamic bodies, so the character walked through crates and balls.
  characterController.computeColliderMovement(collider, _linearVelocity, undefined, undefined, isSolid);

  const corrected = characterController.computedMovement();

  translation.x += corrected.x;
  translation.y += corrected.y;
  translation.z += corrected.z;

  body.setNextKinematicTranslation(translation);

  pushDynamicBodies(characterController, _linearVelocity, ctx.dt);

  for (let i = 0; i < characterController.numComputedCollisions(); i++) {
    if (characterController.computedCollision(i, characterCollision) !== null) {
      // TODO: Rapier v0.10.0 doesn't expose collider on characterCollision so manually grab it
      const rawCollision = (characterController as any).rawCharacterCollision as RawCharacterCollision;
      const collisionColliderHandle = rawCollision.handle();
      const collisionCollider = physicsWorld.getCollider(collisionColliderHandle);

      if (!collisionCollider) {
        return;
      }

      const collisionColliderEid = handleToEid.get(collisionColliderHandle);

      if (!collisionColliderEid) {
        continue;
      }

      for (const collisionHandler of collisionHandlers) {
        collisionHandler(rig.eid, collisionColliderEid, collider.handle, collisionColliderHandle, true);
      }
    }
  }
}

/** Scene-query predicate: everything but sensors (see computeColliderMovement above). */
export const isSolid = (collider: RAPIER.Collider) => !collider.isSensor();

/** Mass the character pushes with (kg); light crates move at walking speed, heavy ones barely. */
const PUSH_MASS = 80;
/** A contact whose surface faces up more than this is something you're standing on, not pushing. */
const STANDING_NORMAL_Y = 0.5;
// Created on first use: Rapier's WASM isn't initialised when this module is imported.
let _pushCollision: RAPIER.CharacterCollision | undefined;
const _pushDir = new Vector3();

/**
 * Buzzar: push dynamic bodies (crates, balls) the character walks into, along the ground only. Bodies under the
 * character (contact normal facing up) are never pushed, so you can jump onto a crate and stand on it.
 */
function pushDynamicBodies(controller: RAPIER.KinematicCharacterController, movement: Vector3, dt: number) {
  if (!(dt > 0)) return;
  for (let i = 0; i < controller.numComputedCollisions(); i++) {
    _pushCollision ??= new RAPIER.CharacterCollision();
    const collision = controller.computedCollision(i, _pushCollision);
    const body = collision?.collider?.parent();
    if (!collision || !body || !body.isDynamic()) continue;
    const n = collision.normal1;
    if (n.y > STANDING_NORMAL_Y) continue; // standing or landing on it
    // Horizontal direction into the body, and how fast we're moving that way.
    _pushDir.set(-n.x, 0, -n.z);
    if (_pushDir.lengthSq() < 1e-6) continue;
    _pushDir.normalize();
    const into = (movement.x * _pushDir.x + movement.z * _pushDir.z) / dt;
    if (into <= 0) continue;
    const v = body.linvel();
    const already = v.x * _pushDir.x + v.z * _pushDir.z;
    const dv = into - already;
    if (dv <= 0) continue;
    // Bring it up to our speed, scaled down for bodies heavier than we push with.
    const mass = body.mass();
    const impulse = dv * Math.min(mass, PUSH_MASS) * (mass > PUSH_MASS ? PUSH_MASS / mass : 1);
    body.applyImpulse({ x: _pushDir.x * impulse, y: 0, z: _pushDir.z * impulse }, true);
  }
}

function createCharacterController(physics: PhysicsModuleState, eid: number) {
  // New player rig (world load / respawn): don't inherit slide state from the previous one.
  isSliding = false;
  const characterController = physics.physicsWorld.createCharacterController(0.01);
  // Buzzar: step up to 30 cm (kerbs, stairs) instead of 10 cm, which left players stuck on UK City kerbs.
  characterController.enableAutostep(0.3, 0.05, true);
  characterController.enableSnapToGround(0.1);
  characterController.setCharacterMass(100);
  // Buzzar: Rapier's impulses shove every dynamic body the character touches, including a crate it lands or stands
  // on, so crates shot out from under players. pushDynamicBodies (below) only pushes what you walk into.
  characterController.setApplyImpulsesToDynamicBodies(false);
  characterController.setSlideEnabled(true);

  physics.eidTocharacterController.set(eid, characterController);
  return characterController;
}

export const KinematicCharacterControllerSystem = (ctx: GameContext) => {
  const physics = getModule(ctx, PhysicsModule);
  const input = getModule(ctx, InputModule);

  const entered = enteredKinematicControlsQuery(ctx.world);
  for (let i = 0; i < entered.length; i++) {
    const eid = entered[i];
    createCharacterController(physics, eid);
  }

  const rigs = kinematicControlsQuery(ctx.world);

  for (let i = 0; i < rigs.length; i++) {
    const eid = rigs[i];
    const node = tryGetRemoteResource<RemoteNode>(ctx, eid);
    const body = node.physicsBody?.body;

    if (!body) {
      console.warn("skipping kinematic controller - rigidbody not found on eid " + eid);
      continue;
    }

    // Buzzar: a seated player is positioned by the seats plugin, not by input or gravity.
    if (SeatedEntities.has(eid)) continue;

    updateKinematicControls(ctx, physics, input.actionStates, node, body);
  }
};

/** Buzzar debug: main thread asks the game worker to log the local player's movement state. */
export const PlayerDebugMessage = "software.haven.debug.player";
export const PlayerDebugResultMessage = "software.haven.debug.player.result";

function logPlayerDebug(ctx: GameContext) {
  const physics = getModule(ctx, PhysicsModule);
  const input = getModule(ctx, InputModule);
  const rigs = kinematicControlsQuery(ctx.world);
  const moveVec = input.actionStates.get(KinematicCharacterControllerActions.Move) as Float32Array | undefined;
  for (let i = 0; i < rigs.length; i++) {
    const node = tryGetRemoteResource<RemoteNode>(ctx, rigs[i]);
    const body = node.physicsBody?.body;
    const controller = physics.eidTocharacterController.get(node.eid);
    const collisions: unknown[] = [];
    if (controller) {
      const r = (v: { x: number; y: number; z: number } | undefined) =>
        v ? [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] : null;
      for (let c = 0; c < controller.numComputedCollisions(); c++) {
        const hit = controller.computedCollision(c);
        const col = hit?.collider;
        const eid = col ? physics.handleToEid.get(col.handle) : undefined;
        const other = eid ? tryGetRemoteResource<RemoteNode>(ctx, eid) : undefined;
        // Buzzar debug: enough to identify an obstacle even when it has no node (scene trimeshes).
        collisions.push({
          name: other?.name ?? null,
          shape: col ? RAPIER.ShapeType[col.shapeType()] : null,
          sensor: col?.isSensor() ?? null,
          body: col?.parent() ? RAPIER.RigidBodyType[col.parent()!.bodyType()] : null,
          at: r(col?.translation()),
          point: r(hit?.witness1),
          normal: r(hit?.normal1),
        });
      }
    }
    const data = {
      eid: node.eid,
      position: Array.from(node.position).map((v) => +v.toFixed(3)),
      bodyTranslation: body ? Object.values(body.translation()).map((v) => +(v as number).toFixed(3)) : null,
      bodyType: body?.bodyType(),
      linvel: body ? Object.values(body.linvel()).map((v) => +(v as number).toFixed(3)) : null,
      moveVec: moveVec ? Array.from(moveVec) : null,
      grounded: controller?.computedGrounded(),
      hasController: !!controller,
      // Buzzar debug: total colliders in the physics world (leaks show up as growth across world switches).
      worldColliders: physics.physicsWorld.colliders.len(),
      // Buzzar: non-fixed bodies within 5 m (crates, balls), to see what moves them.
      nearbyBodies: (() => {
        const out: unknown[] = [];
        const me = body?.translation();
        if (!me) return out;
        physics.physicsWorld.bodies.forEach((b) => {
          if (b === body || b.isFixed()) return;
          const t = b.translation();
          if (Math.hypot(t.x - me.x, t.y - me.y, t.z - me.z) > 5) return;
          const v = b.linvel();
          out.push({
            type: RAPIER.RigidBodyType[b.bodyType()],
            at: [+t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2)],
            v: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)],
            sleeping: b.isSleeping(),
            colliders: Array.from({ length: b.numColliders() }, (_, c) => {
              const col = b.collider(c);
              const he = (col.shape as { halfExtents?: { x: number; y: number; z: number } }).halfExtents;
              return {
                shape: RAPIER.ShapeType[col.shapeType()],
                colliderAt: (() => {
                  const ct = col.translation();
                  return [+ct.x.toFixed(2), +ct.y.toFixed(2), +ct.z.toFixed(2)];
                })(),
                halfExtents: he ? [+he.x.toFixed(2), +he.y.toFixed(2), +he.z.toFixed(2)] : null,
                groups: col.collisionGroups(),
                solver: col.solverGroups(),
                sensor: col.isSensor(),
                enabled: col.isEnabled(),
              };
            }),
          });
        });
        return out;
      })(),
      // Buzzar: player colliders should have no solver contacts (solverGroups 0), see PlayerRig.
      ownColliders: body
        ? Array.from({ length: body.numColliders() }, (_, c) => {
            const col = body.collider(c);
            return { solverGroups: col.solverGroups(), groups: col.collisionGroups(), sensor: col.isSensor() };
          })
        : null,
      isSliding,
      collisions,
      // Keys/buttons the game currently believes are held.
      heldRaw: Object.entries(input.raw)
        .filter(
          ([path, value]) => value && (path.startsWith("Keyboard/") || path === "Mouse/Left" || path === "Mouse/Right")
        )
        .map(([path]) => path),
    };
    console.info("[player-debug] " + JSON.stringify(data));
    ctx.sendMessage(Thread.Main, { type: PlayerDebugResultMessage, data });
  }
  if (rigs.length === 0) {
    console.info("[player-debug] no kinematic player rig (fly mode?)");
    ctx.sendMessage(Thread.Main, { type: PlayerDebugResultMessage, data: { noRig: true } });
  }
}
