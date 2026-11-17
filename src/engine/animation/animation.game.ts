import RAPIER, { Capsule } from "@dimforge/rapier3d-compat";
import { defineQuery, exitQuery } from "bitecs";
import { vec3 } from "gl-matrix";
import { AnimationAction, AnimationMixer, Bone, Object3D, Quaternion, Vector3 } from "three";
import { radToDeg } from "three/src/math/MathUtils";

import { getForwardVector, getPitch, getRightVector, getYaw } from "../common/math";
import { maxEntities } from "../config.common";
import { GameContext } from "../GameTypes";
import { getModule } from "../module/module.common";
import { PhysicsModule, PhysicsModuleState } from "../physics/physics.game";
import { getRemoteResource, removeResourceRef } from "../resource/resource.game";
import { RemoteNode } from "../resource/RemoteResources";
import type { GameAnimation } from "../gltf/gltf.game";
import { playerShapeCastCollisionGroups } from "../physics/CollisionGroups";
import { Posture, PostureEntities } from "../player/posture.common";
import { CLIP_SPEED } from "../avatar/retarget";

export interface IAnimationComponent {
  animations: GameAnimation[];
  mixer: AnimationMixer;
  actionMap: Map<string, AnimationAction>;
  actions: AnimationAction[];
  /** Buzzar: runs after the mixer each frame (avatar spring bones). */
  postUpdate?: (dt: number, rootWorldMatrix: ArrayLike<number>, node: RemoteNode) => void;
}

export enum AnimationClipType {
  Fall2 = "Fall2",
  Fall1 = "Fall1",
  TurnLeft = "TurnLeft",
  TurnRight = "TurnRight",
  Idle = "Idle",
  StrafeLeft = "StrafeLeft",
  StrafeRight = "StrafeRight",
  Walk = "Walk",
  WalkBack = "WalkBack",
  StrafeLeftRun = "StrafeLeftRun",
  StrafeRightRun = "StrafeRightRun",
  Run = "Run",
  RunBack = "RunBack",
  /** Buzzar: procedural seated pose (avatar.game buildSitClip), played while on a seat. */
  Sit = "Sit",
  /** Buzzar: crouch, an additive pose layered on top of idle/walking (plugins/posture). */
  Crouch = "Crouch",
  /** Buzzar: lying prone (plugins/posture). */
  Prone = "Prone",
  /** Buzzar: moving while prone (army crawl). */
  Crawl = "Crawl",
  /** Buzzar: walking crouched (a generated cycle; the crouch layer twisted the walk's legs). */
  CrouchWalk = "CrouchWalk",
  CrouchStrafe = "CrouchStrafe",
}

/**
 * Buzzar: player containers currently on a seat (local and remote). Maintained by the seats plugin; their
 * avatars play the Sit clip instead of the velocity-driven locomotion clips.
 */
export const SeatedEntities = new Set<number>();

export const AnimationComponent = new Map<number, IAnimationComponent>();
export const BoneComponent = new Map<number, Bone>();

const animationQuery = defineQuery([AnimationComponent]);
const exitAnimationQuery = exitQuery(animationQuery);
const boneQuery = defineQuery([BoneComponent]);
const exitBoneQuery = exitQuery(boneQuery);

export function AnimationSystem(ctx: GameContext) {
  disposeAnimations(ctx);
  disposeBones(ctx);
  processAnimations(ctx);
  syncBones(ctx);
}

const _forward = vec3.create();
const _right = vec3.create();

const idleThreshold = 0.5;
const walkThreshold = 10;

const fadeInAmount = 8;
const fadeOutAmount = fadeInAmount / 2;

const lastYrot = new Float32Array(maxEntities);

const interactionGroup = playerShapeCastCollisionGroups;
const colliderShape = new Capsule(0.1, 0.5);
const shapeTranslationOffset = new Vector3(0, 0, 0);
const shapeRotationOffset = new Quaternion(0, 0, 0, 0);
const shapeCastPosition = new Vector3();
const shapeCastRotation = new Quaternion();
const _obj = new Object3D();

const isGrounded = (ctx: GameContext, physicsWorld: RAPIER.World, body: RAPIER.RigidBody) => {
  shapeCastPosition.copy(body.translation() as Vector3).add(shapeTranslationOffset);
  shapeCastRotation.copy(_obj.quaternion).multiply(shapeRotationOffset);

  const shapeCastResult = physicsWorld.castShape(
    shapeCastPosition,
    shapeCastRotation,
    physicsWorld.gravity,
    colliderShape,
    ctx.dt,
    true,
    0,
    interactionGroup
  );

  const isGrounded = !!shapeCastResult;

  return isGrounded;
};

function processAnimations(ctx: GameContext) {
  const physics = getModule(ctx, PhysicsModule);
  const ents = animationQuery(ctx.world);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    // animation component exists on the inner avatar entity
    const animation = AnimationComponent.get(eid);
    const node = getRemoteResource<RemoteNode>(ctx, eid)!;

    // avatars exist within a parent container which has all other components for this entity
    const parent = node.parent;
    if (!parent) {
      console.warn("cannot find parent container for avatar:", eid);
      continue;
    }

    const body = parent.physicsBody?.body;

    if (animation && body) {
      // select actions to play based on velocity
      const sitAction = SeatedEntities.has(parent.eid) ? animation.actionMap.get(AnimationClipType.Sit) : undefined;
      // Buzzar: crouching layers a pose on top of the locomotion clips; prone replaces them.
      const posture = PostureEntities.get(parent.eid);
      // Buzzar: moving while prone crawls; lying still keeps the static pose.
      const proneVelocity = parent.physicsBody?.velocity;
      const proneMoving = !!proneVelocity && proneVelocity[0] ** 2 + proneVelocity[2] ** 2 > 0.05 ** 2;
      const proneAction =
        !sitAction && posture === Posture.Prone
          ? (proneMoving && animation.actionMap.get(AnimationClipType.Crawl)) ||
            animation.actionMap.get(AnimationClipType.Prone)
          : undefined;
      // Buzzar: walking crouched plays its own cycle, at the player's speed (backwards when backing up).
      // Buzzar: moving mostly sideways (50°–130° off facing) steps sideways: the clip steps left, reversed for right.
      let crouchWalkAction: AnimationAction | undefined;
      if (!sitAction && !proneAction && posture === Posture.Crouching && proneMoving && proneVelocity) {
        const speed = Math.hypot(proneVelocity[0], proneVelocity[2]);
        // Same forward test as the locomotion clips (WalkBack is played from 120° on).
        const forward = getForwardVector(_forward, getPitch(parent.quaternion), getYaw(parent.quaternion));
        const angle = radToDeg(vec3.angle(proneVelocity, forward));
        const strafeAction = animation.actionMap.get(AnimationClipType.CrouchStrafe);
        if (strafeAction && angle > 50 && angle < 130) {
          // Forward × velocity points up when moving to the left.
          const left = forward[2] * proneVelocity[0] - forward[0] * proneVelocity[2] > 0;
          crouchWalkAction = strafeAction;
          crouchWalkAction.timeScale =
            (left ? 1 : -1) * (speed / (CLIP_SPEED.get(AnimationClipType.CrouchStrafe) ?? 0.3));
        } else {
          crouchWalkAction = animation.actionMap.get(AnimationClipType.CrouchWalk);
          if (crouchWalkAction) {
            crouchWalkAction.timeScale =
              (angle > 120 ? -1 : 1) * (speed / (CLIP_SPEED.get(AnimationClipType.CrouchWalk) ?? 0.8));
          }
        }
      }
      let actionsToPlay = sitAction
        ? [sitAction]
        : proneAction
        ? [proneAction]
        : crouchWalkAction
        ? [crouchWalkAction]
        : getClipActionsUsingVelocity(ctx, physics, parent, body, animation);
      // synchronize selected clip action times
      synchronizeClipActions(actionsToPlay);
      const crouchAction =
        !sitAction && !proneAction && !crouchWalkAction && posture === Posture.Crouching
          ? animation.actionMap.get(AnimationClipType.Crouch)
          : undefined;
      if (crouchAction) actionsToPlay = [...actionsToPlay, crouchAction];
      // Buzzar: a still crouch stays still. The crouch pose is layered on idle, whose breathing/sway made the
      // crouched body drift; hold idle on its first frame (the one the crouch pose was built against) meanwhile.
      const idleAction = animation.actionMap.get(AnimationClipType.Idle);
      if (idleAction) {
        const holdIdle = !!crouchAction && actionsToPlay.includes(idleAction);
        if (holdIdle) {
          idleAction.time = 0;
          idleAction.timeScale = 0;
        } else if (idleAction.timeScale === 0) {
          idleAction.timeScale = 1;
        }
      }
      // Buzzar: move each action's weight towards its target (1 if selected, 0 otherwise) and stop there. Fading
      // everything out and the selection back in every frame left weights bouncing around 1 (and past it); fine
      // for walk/idle, but it made the additive crouch pose shake visibly.
      settleClipActionWeights(animation.actions, actionsToPlay, fadeInAmount * ctx.dt, fadeOutAmount * ctx.dt);

      animation.mixer.update(ctx.dt);
    }

    // Buzzar: spring bones and faces run for every avatar, including ones without a body (avatar pedestals).
    animation?.postUpdate?.(ctx.dt, node.worldMatrix, node);
  }
  return ctx;
}

function syncBones(ctx: GameContext) {
  // sync bone positions
  const bones = boneQuery(ctx.world);
  for (let i = 0; i < bones.length; i++) {
    const eid = bones[i];
    const bone = BoneComponent.get(eid);
    const node = getRemoteResource<RemoteNode>(ctx, eid);
    if (bone && node) {
      bone.position.toArray(node.position);
      bone.quaternion.toArray(node.quaternion);
    }
  }
  return ctx;
}

function settleClipActionWeights(
  actions: AnimationAction[],
  selected: AnimationAction[],
  fadeIn: number,
  fadeOut: number
) {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const target = selected.includes(action) ? 1 : 0;
    const delta = target - action.weight;
    action.weight =
      delta > 0
        ? Math.min(1, action.weight + Math.min(delta, fadeIn))
        : Math.max(0, action.weight + Math.max(delta, -fadeOut));
    action.enabled = action.weight > 0 || target > 0;
  }
}

function synchronizeClipActions(actions: AnimationAction[]) {
  for (let i = 0; i < actions.length; i++) {
    const actionA = actions[i];
    const actionB = actions[i + 1];
    if (actionA && actionB) {
      const ratio = actionA.getClip().duration / actionB.getClip().duration;
      if (actionA.timeScale < 0 || actionB.timeScale < 0) {
        actionA.time = 1 - actionB.time * ratio;
      } else {
        actionA.time = actionB.time * ratio;
      }
    }
  }
}

function getClipActionsUsingVelocity(
  ctx: GameContext,
  physics: PhysicsModuleState,
  node: RemoteNode,
  body: RAPIER.RigidBody,
  animation: IAnimationComponent
): AnimationAction[] {
  const eid = node.eid;
  const quaternion = node.quaternion;

  if (!node.physicsBody) {
    throw new Error(`Physics body not found on node ${node.eid}`);
  }

  const linvel = node.physicsBody.velocity;

  const totalSpeed = linvel[0] ** 2 + linvel[2] ** 2;

  const pitch = getPitch(quaternion);
  const roll = getYaw(quaternion);
  const forward = getForwardVector(_forward, pitch, roll);
  const right = getRightVector(_right, roll);

  const angle = radToDeg(vec3.angle(linvel, forward));
  const angle2 = radToDeg(vec3.angle(linvel, right));

  const movingForward = angle < 50;
  const movingBackward = angle > 120;
  const strafingLeft = angle2 > 120;
  const strafingRight = angle2 < 50;

  const yRot = roll;
  const yRotLast = lastYrot[eid];
  const turningLeft = yRot - yRotLast > 0.1 * ctx.dt;
  const turningRight = yRot - yRotLast < -0.1 * ctx.dt;
  if (yRotLast !== yRot) {
    lastYrot[eid] = yRot;
  }

  const jumping = !isGrounded(ctx, physics.physicsWorld, body);

  // choose clip based on velocity
  const actions: AnimationAction[] = [];

  if (linvel[1] < -20) {
    actions.push(animation.actionMap.get(AnimationClipType.Fall2)!);
  } else if (jumping) {
    actions.push(animation.actionMap.get(AnimationClipType.Fall1)!);
  } else if (totalSpeed < idleThreshold) {
    if (turningLeft) {
      actions.push(animation.actionMap.get(AnimationClipType.TurnLeft)!);
    } else if (turningRight) {
      actions.push(animation.actionMap.get(AnimationClipType.TurnRight)!);
    } else {
      actions.push(animation.actionMap.get(AnimationClipType.Idle)!);
    }
  } else if (totalSpeed < walkThreshold) {
    if (strafingLeft) {
      actions.push(animation.actionMap.get(AnimationClipType.StrafeLeft)!);
      actions[actions.length - 1].setEffectiveTimeScale(1);
    } else if (strafingRight) {
      actions.push(animation.actionMap.get(AnimationClipType.StrafeRight)!);
      actions[actions.length - 1].setEffectiveTimeScale(1);
    }
    if (movingForward) {
      actions.push(animation.actionMap.get(AnimationClipType.Walk)!);
    } else if (movingBackward) {
      if (strafingLeft) {
        actions[actions.length - 1] = animation.actionMap.get(AnimationClipType.StrafeRight)!;
        actions[actions.length - 1].setEffectiveTimeScale(-1);
      } else if (strafingRight) {
        actions[actions.length - 1] = animation.actionMap.get(AnimationClipType.StrafeLeft)!;
        actions[actions.length - 1].setEffectiveTimeScale(-1);
      }
      actions.push(animation.actionMap.get(AnimationClipType.WalkBack)!);
    }
  } else {
    if (strafingLeft) {
      actions.push(animation.actionMap.get(AnimationClipType.StrafeLeftRun)!);
      actions[actions.length - 1].setEffectiveTimeScale(1);
    } else if (strafingRight) {
      actions.push(animation.actionMap.get(AnimationClipType.StrafeRightRun)!);
      actions[actions.length - 1].setEffectiveTimeScale(1);
    }
    if (movingForward) {
      actions.push(animation.actionMap.get(AnimationClipType.Run)!);
    } else if (movingBackward) {
      if (strafingLeft) {
        actions[actions.length - 1] = animation.actionMap.get(AnimationClipType.StrafeRightRun)!;
        actions[actions.length - 1].setEffectiveTimeScale(-1);
      } else if (strafingRight) {
        actions[actions.length - 1] = animation.actionMap.get(AnimationClipType.StrafeLeftRun)!;
        actions[actions.length - 1].setEffectiveTimeScale(-1);
      }
      actions.push(animation.actionMap.get(AnimationClipType.RunBack)!);
    }
  }

  return actions;
}

function disposeAnimations(ctx: GameContext) {
  const entities = exitAnimationQuery(ctx.world);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];

    const { animations } = AnimationComponent.get(eid)!;

    // Buzzar: animations are plain game-thread objects; release the accessors they hold.
    for (let i = 0; i < animations.length; i++) {
      for (const accessor of animations[i].accessors) removeResourceRef(ctx, accessor.eid);
    }

    AnimationComponent.delete(eid);
  }
}

function disposeBones(ctx: GameContext) {
  const entities = exitBoneQuery(ctx.world);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    BoneComponent.delete(eid);
  }
}
