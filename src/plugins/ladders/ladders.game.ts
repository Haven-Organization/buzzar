/**
 * Buzzar: "Climb Down" at the top of every ladder (Third Room #367 follow-up).
 *
 * Getting onto a ladder from above otherwise means stepping off the edge and catching it as you fall. Each ladder
 * gets an invisible box over its top end that you can aim at and press (E / click / trigger) while standing up
 * there: it puts you on the ladder just below the top, on the side away from where you stood, facing it and holding
 * on, ready to climb down.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { mat4, quat, vec3 } from "gl-matrix";

import { addChild } from "../../engine/component/transform";
import { GameContext } from "../../engine/GameTypes";
import { getModule } from "../../engine/module/module.common";
import { addPhysicsBody, addPhysicsCollider, PhysicsModule } from "../../engine/physics/physics.game";
import { ladderGrab, liveClimbables, worldBox } from "../../engine/player/climbing";
import { ourPlayerQuery } from "../../engine/player/Player";
import { RemoteCollider, RemoteNode, RemotePhysicsBody } from "../../engine/resource/RemoteResources";
import { tryGetRemoteResource } from "../../engine/resource/resource.game";
import { ColliderType, InteractableType, PhysicsBodyType } from "../../engine/resource/schema";
import { teleportEntity } from "../../engine/utils/teleportEntity";
import { addInteractableComponent, pressedByOurPlayer } from "../interaction/interaction.game";

export const CLIMB_DOWN_LABEL = "Climb Down";
/** Height of the Climb Down box above the ladder's top (metres), and how far it reaches out on each side. */
const TOP_BOX_HEIGHT = 0.5;
const TOP_BOX_PAD = 0.3;
/** You have to be up at the top to use it: feet within this height of the top, this far from the ladder. */
const TOP_REACH_HEIGHT = 1.0;
const TOP_REACH_DISTANCE = 2.5;
/** Where it puts you: this far from the ladder's face (clear of a ladder collider), feet this far below the top. */
const HANG_GAP = 0.38;
const HANG_BELOW_TOP = 1.0;

const _min = vec3.create();
const _max = vec3.create();
const _scale = vec3.create();

function makeTop(ctx: GameContext, ladder: RemoteNode, min: vec3, max: vec3) {
  // A child of the ladder, so it moves with it; sizes are divided by the ladder's scale to come out in metres.
  mat4.getScaling(_scale, ladder.worldMatrix);
  const sx = Math.abs(_scale[0]) || 1;
  const sy = Math.abs(_scale[1]) || 1;
  const sz = Math.abs(_scale[2]) || 1;
  const top = new RemoteNode(ctx.resourceManager, {
    name: CLIMB_DOWN_LABEL,
    position: [(min[0] + max[0]) / 2, max[1] + TOP_BOX_HEIGHT / 2 / sy, (min[2] + max[2]) / 2],
  });
  addChild(ladder, top);
  addPhysicsCollider(
    ctx.world,
    top,
    new RemoteCollider(ctx.resourceManager, {
      type: ColliderType.Box,
      size: [max[0] - min[0] + (2 * TOP_BOX_PAD) / sx, TOP_BOX_HEIGHT / sy, max[2] - min[2] + (2 * TOP_BOX_PAD) / sz],
      activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
      // Aimable, never in the way.
      isTrigger: true,
    })
  );
  const physics = getModule(ctx, PhysicsModule);
  addPhysicsBody(ctx.world, physics, top, new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Static }));
  addInteractableComponent(ctx, physics, top, InteractableType.Interactable);
  return top;
}

/**
 * Where to hang on a ladder (world box `min`/`max`) for someone standing at `feet` at its top: the far side of the
 * ladder's thin axis from them, facing it. Returns feet position and yaw (radians, 0 = facing -Z).
 */
export function climbDownPlacement(min: ArrayLike<number>, max: ArrayLike<number>, feet: ArrayLike<number>) {
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const alongX = max[0] - min[0] < max[2] - min[2]; // the ladder is thinnest along X: its faces look along X
  const half = alongX ? (max[0] - min[0]) / 2 : (max[2] - min[2]) / 2;
  // Away from where they stand (standing exactly over it: toward -axis).
  const side = (alongX ? feet[0] - cx : feet[2] - cz) > 0 ? -1 : 1;
  const offset = side * (half + HANG_GAP);
  const position: [number, number, number] = [
    alongX ? cx + offset : cx,
    max[1] - HANG_BELOW_TOP,
    alongX ? cz : cz + offset,
  ];
  // Face the ladder: direction (dx, dz) from the hang point to its centre line; forward is (-sin yaw, -cos yaw).
  const dx = alongX ? -side : 0;
  const dz = alongX ? 0 : -side;
  return { position, yaw: Math.atan2(-dx, -dz) };
}

export function LadderSystem(ctx: GameContext) {
  const ladders = liveClimbables(ctx);
  for (const climbable of ladders) {
    if (!climbable.top) climbable.top = makeTop(ctx, climbable.node, climbable.min, climbable.max);
  }
  if (pressedByOurPlayer.size === 0) return;

  for (const climbable of ladders) {
    if (!climbable.top || !pressedByOurPlayer.has(climbable.top)) continue;
    const eid = ourPlayerQuery(ctx.world)[0];
    const rig = eid !== undefined ? tryGetRemoteResource<RemoteNode>(ctx, eid) : undefined;
    if (!rig) return;
    worldBox(climbable.node.worldMatrix, climbable.min, climbable.max, _min, _max);
    // The physics body is where the player really is (the node's position can lag a frame or be relative).
    const t = rig.physicsBody?.body?.translation();
    const feet = t ? [t.x, t.y, t.z] : rig.position;
    const cx = (_min[0] + _max[0]) / 2;
    const cz = (_min[2] + _max[2]) / 2;
    if (Math.abs(feet[1] - _max[1]) > TOP_REACH_HEIGHT || Math.hypot(feet[0] - cx, feet[2] - cz) > TOP_REACH_DISTANCE) {
      continue; // only from up at the top
    }
    const { position, yaw } = climbDownPlacement(_min, _max, feet);
    const rotation = quat.setAxisAngle(quat.create(), [0, 1, 0], yaw);
    teleportEntity(rig, vec3.fromValues(...position), rotation);
    // The character controller already queued this frame's move from up on the top; replace it, or the physics
    // step carries the player back there.
    const body = rig.physicsBody?.body;
    if (body?.isKinematic()) {
      body.setNextKinematicTranslation({ x: position[0], y: position[1], z: position[2] });
      body.setNextKinematicRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] });
    }
    ladderGrab.pending = true;
    return;
  }
}
