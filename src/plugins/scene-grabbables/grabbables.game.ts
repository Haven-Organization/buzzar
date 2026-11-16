/**
 * Buzzar scene grabbables (glTF extension HAVEN_grabbable): objects placed in a world that anyone can pick up,
 * like the spawnable props but authored into the scene.
 *
 * Networking follows the existing ownership model (network/ownership.game.ts), where an object is owned by
 * whoever created it and taking ownership means replacing it with your own copy:
 *
 * - Every client loads the scene copy: a kinematic, clickable mesh that sits still until someone grabs it.
 * - Each grabbable registers a prefab named after its glTF node index, so every client can build copies.
 * - The first grab replaces the scene copy with a networked copy owned by the grabber. Creating any copy
 *   (locally, or when a peer's copy arrives over the network, including for people who join later) hides the
 *   scene copy, so there is only ever one cup.
 * - Later grabs use the normal ownership hand-over between networked copies.
 * - If no networked copy is left (its owner left the world), the scene copy comes back at its original spot.
 *
 * glTF: put "HAVEN_grabbable": {} on a node with a mesh. Its collider is the mesh's convex hull.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { addComponent, defineComponent, hasComponent } from "bitecs";
import { mat4 } from "gl-matrix";

import { addChild, getChildren, updateMatrixWorld } from "../../engine/component/transform";
import { GameContext } from "../../engine/GameTypes";
import { defineModule, getModule } from "../../engine/module/module.common";
import { Networked, Owned } from "../../engine/network/NetworkComponents";
import { dynamicObjectCollisionGroups } from "../../engine/physics/CollisionGroups";
import {
  addPhysicsBody,
  addPhysicsCollider,
  applyTransformToRigidBody,
  PhysicsModule,
} from "../../engine/physics/physics.game";
import { createPrefabEntity, Prefab, PrefabType, registerPrefab } from "../../engine/prefab/prefab.game";
import { addObjectToWorld, RemoteCollider, RemoteNode, RemotePhysicsBody } from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import { ColliderType, InteractableType, PhysicsBodyType } from "../../engine/resource/schema";
import { getRotationNoAlloc } from "../../engine/utils/getRotationNoAlloc";
import { addInteractableComponent } from "../interaction/interaction.game";

export type GLTFGrabbableExtension = Record<string, never>;

interface SceneGrabbable {
  prefabName: string;
  sceneNode: RemoteNode;
  hidden: boolean;
  /** ctx.elapsed (ms) when the last networked copy disappeared; the scene copy returns after a grace period. */
  missingSince?: number;
}

interface SceneGrabbableModuleState {
  byPrefab: Map<string, SceneGrabbable>;
  bySceneEid: Map<number, SceneGrabbable>;
}

/** Marks the scene copy of a grabbable (see takeSceneGrabbable). */
export const SceneGrabbableComponent = defineComponent();

/** Ownership hand-overs remove one copy and create the next; don't restore the scene copy in between. */
const RESTORE_GRACE_MS = 1500;

export const SceneGrabbableModule = defineModule<GameContext, SceneGrabbableModuleState>({
  name: "scene-grabbables",
  create() {
    return { byPrefab: new Map(), bySceneEid: new Map() };
  },
  init() {},
});

function setSceneCopyHidden(entry: SceneGrabbable, hidden: boolean) {
  entry.hidden = hidden;
  entry.sceneNode.visible = !hidden;
  entry.sceneNode.physicsBody?.body?.setEnabled(!hidden);
}

/** Recreates `from`'s descendants that draw something (meshes) under `to`, keeping their local transforms. */
function copyChildMeshes(ctx: GameContext, from: RemoteNode, to: RemoteNode) {
  for (const child of getChildren(from)) {
    if (child.nametag || child.audioEmitter) continue;
    const part = new RemoteNode(ctx.resourceManager, { name: child.name, mesh: child.mesh });
    part.position.set(child.position);
    part.quaternion.set(child.quaternion);
    part.scale.set(child.scale);
    copyChildMeshes(ctx, child, part);
    // Skip empty branches (no mesh anywhere below).
    if (part.mesh || part.firstChild) addChild(to, part);
  }
}

export function addSceneGrabbable(
  ctx: GameContext,
  node: RemoteNode,
  _extension: GLTFGrabbableExtension,
  index: number
) {
  const module = getModule(ctx, SceneGrabbableModule);
  const physics = getModule(ctx, PhysicsModule);
  const mesh = node.mesh;

  if (!mesh) {
    console.warn(`HAVEN_grabbable on "${node.name}" ignored: the node has no mesh`);
    return;
  }

  const prefabName = `haven-grabbable:${index}`;
  const entry: SceneGrabbable = { prefabName, sceneNode: node, hidden: false };

  // Scene copy: stays put (kinematic) until grabbed.
  updateMatrixWorld(node);
  addPhysicsCollider(
    ctx.world,
    node,
    new RemoteCollider(ctx.resourceManager, {
      type: ColliderType.Hull,
      mesh,
      activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
      collisionGroups: dynamicObjectCollisionGroups,
    })
  );
  addPhysicsBody(
    ctx.world,
    physics,
    node,
    new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Kinematic })
  );
  addInteractableComponent(ctx, physics, node, InteractableType.Grabbable);
  addComponent(ctx.world, SceneGrabbableComponent, node.eid);

  const worldScale = mat4.getScaling([1, 1, 1], node.worldMatrix);

  registerPrefab(ctx, {
    name: prefabName,
    type: PrefabType.Object,
    create: (ctx: GameContext) => {
      // Whoever's copy this is, the scene copy is now superseded.
      setSceneCopyHidden(entry, true);
      entry.missingSince = undefined;

      const copy = new RemoteNode(ctx.resourceManager, { name: node.name, mesh });
      copy.scale.set(worldScale);
      // Buzzar: bring the node's child parts (lid, handle, label, ...) along; the copy used to be the top mesh only.
      copyChildMeshes(ctx, node, copy);
      updateMatrixWorld(copy);

      addPhysicsCollider(
        ctx.world,
        copy,
        new RemoteCollider(ctx.resourceManager, {
          type: ColliderType.Hull,
          mesh,
          activeEvents: RAPIER.ActiveEvents.COLLISION_EVENTS,
          collisionGroups: dynamicObjectCollisionGroups,
        })
      );
      addPhysicsBody(
        ctx.world,
        physics,
        copy,
        new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Rigid })
      );
      addInteractableComponent(ctx, physics, copy, InteractableType.Grabbable);

      return copy;
    },
  });

  module.byPrefab.set(prefabName, entry);
  module.bySceneEid.set(node.eid, entry);
}

/**
 * Grabbing a scene copy: replace it with a networked copy we own, in the same place. Returns the new entity, or
 * undefined if `node` isn't a scene grabbable (callers then fall back to normal ownership).
 */
export function takeSceneGrabbable(ctx: GameContext, node: RemoteNode): number | undefined {
  if (!hasComponent(ctx.world, SceneGrabbableComponent, node.eid)) return undefined;
  const entry = getModule(ctx, SceneGrabbableModule).bySceneEid.get(node.eid);
  if (!entry || entry.hidden) return undefined;

  const copy = createPrefabEntity(ctx, entry.prefabName);
  addComponent(ctx.world, Owned, copy.eid);
  addComponent(ctx.world, Networked, copy.eid);

  updateMatrixWorld(node);
  mat4.getTranslation(copy.position, node.worldMatrix);
  getRotationNoAlloc(copy.quaternion, node.worldMatrix);
  copy.skipLerp = 10;

  const body = copy.physicsBody?.body;
  if (body) applyTransformToRigidBody(body, copy);

  addObjectToWorld(ctx, copy);
  return copy.eid;
}

export function SceneGrabbableSystem(ctx: GameContext) {
  const module = getModule(ctx, SceneGrabbableModule);
  if (module.byPrefab.size === 0) return;

  // Forget grabbables from a previous world.
  for (const [eid, entry] of module.bySceneEid) {
    if (getRemoteResource(ctx, eid) !== entry.sceneNode) {
      module.bySceneEid.delete(eid);
      module.byPrefab.delete(entry.prefabName);
    }
  }

  const present = new Set<string>();
  for (const name of Prefab.values()) present.add(name);

  for (const entry of module.byPrefab.values()) {
    if (!entry.hidden) continue;
    if (present.has(entry.prefabName)) {
      entry.missingSince = undefined;
      continue;
    }
    entry.missingSince ??= ctx.elapsed;
    if (ctx.elapsed - entry.missingSince > RESTORE_GRACE_MS) {
      // Its holder left: put it back where the world author placed it.
      entry.missingSince = undefined;
      setSceneCopyHidden(entry, false);
    }
  }
}
