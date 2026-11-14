/**
 * Buzzar mirrors (glTF `HAVEN_mirror`, plus Hubs `MOZ_hubs_components.mirror`).
 *
 * Mirror state (Off / Low = avatars only / High = everything) is local to each user, like VRChat:
 * toggling a mirror never changes it for anyone else. Pressing the mirror surface or one of its toggle
 * nodes cycles Off → High → Low → Off. A per-client cap (`setMaxMirrorState`) limits quality, e.g. for
 * low-end devices.
 */
import { GameContext } from "../../engine/GameTypes";
import { getModule } from "../../engine/module/module.common";
import { addPhysicsBody, addPhysicsCollider, PhysicsModule } from "../../engine/physics/physics.game";
import { RemoteCollider, RemoteMirror, RemoteNode, RemotePhysicsBody } from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import { ColliderType, InteractableType, MirrorState, PhysicsBodyType } from "../../engine/resource/schema";
import { addInteractableComponent } from "../interaction/interaction.game";

/** glTF node extension `HAVEN_mirror`. */
export interface GLTFMirrorExtension {
  /** [width, height] of the reflective plane in the node's local XY plane; faces local +Z. Default [1, 1]. */
  size?: [number, number];
  /** State when the world loads. Default "off" (VRChat convention). */
  defaultState?: "off" | "low" | "high";
  /** Multiplier on viewport resolution for the reflection. Default 1. */
  resolutionScale?: number;
  /** Don't render the reflection beyond this many metres. Default 30. */
  maxDistance?: number;
  /** Linear RGB background for "low" (avatars-only) mode. */
  backgroundColor?: [number, number, number];
  /** Indices of nodes that act as toggle buttons for this mirror (each needs a collider). */
  toggles?: number[];
  /** Whether pressing the mirror surface itself toggles it. Default true. */
  clickToToggle?: boolean;
}

const MIRROR_STATE_NAMES: Record<string, MirrorState> = {
  off: MirrorState.Off,
  low: MirrorState.Low,
  high: MirrorState.High,
};

const COLLIDER_DEPTH = 0.02;

// Keyed by node object (not eid): eids are recycled, so a node is only considered alive while the
// resource map still returns this exact object for its eid.
/** Toggle node → mirror nodes it controls. */
const mirrorToggles = new Map<RemoteNode, RemoteNode[]>();
/** Mirror node → the state the world/user asked for, before the client cap is applied. */
const requestedStates = new Map<RemoteNode, MirrorState>();

function isAlive(ctx: GameContext, node: RemoteNode): boolean {
  return getRemoteResource<RemoteNode>(ctx, node.eid) === node;
}

let maxMirrorState: MirrorState = MirrorState.High;

export function parseMirrorState(value: unknown, fallback: MirrorState): MirrorState {
  if (typeof value !== "string") return fallback;
  return MIRROR_STATE_NAMES[value.toLowerCase()] ?? fallback;
}

/** Off → High → Low → Off, skipping states above `max`. */
export function nextMirrorState(current: MirrorState, max: MirrorState = MirrorState.High): MirrorState {
  const cycle = [MirrorState.Off, MirrorState.High, MirrorState.Low].filter((s) => s <= max);
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length];
}

export function clampMirrorState(state: MirrorState, max: MirrorState): MirrorState {
  return state > max ? max : state;
}

export function addMirror(ctx: GameContext, node: RemoteNode, extension: GLTFMirrorExtension = {}): RemoteMirror {
  const [width, height] = extension.size ?? [1, 1];

  const mirror = new RemoteMirror(ctx.resourceManager, {
    width,
    height,
    resolutionScale: extension.resolutionScale ?? 1,
    maxDistance: extension.maxDistance ?? 30,
    backgroundColor: extension.backgroundColor ?? [0.1, 0.1, 0.12],
  });

  node.mirror = mirror;

  const requested = parseMirrorState(extension.defaultState, MirrorState.Off);
  requestedStates.set(node, requested);
  mirror.state = clampMirrorState(requested, maxMirrorState);

  if (extension.clickToToggle !== false) {
    makeToggle(ctx, node, node, [width, height, COLLIDER_DEPTH]);
  }

  return mirror;
}

/** Called after all nodes of a glTF are loaded, so toggle indices can be resolved. */
export function addMirrorToggleNode(ctx: GameContext, toggleNode: RemoteNode, mirrorNode: RemoteNode) {
  makeToggle(ctx, toggleNode, mirrorNode);
}

function makeToggle(
  ctx: GameContext,
  node: RemoteNode,
  mirrorNode: RemoteNode,
  colliderSize?: [number, number, number]
) {
  const controlled = mirrorToggles.get(node);

  if (controlled) {
    if (!controlled.includes(mirrorNode)) controlled.push(mirrorNode);
    return;
  }

  mirrorToggles.set(node, [mirrorNode]);

  const physics = getModule(ctx, PhysicsModule);

  if (!node.physicsBody) {
    if (!node.collider) {
      if (!colliderSize) {
        console.warn(`Mirror toggle node "${node.name}" has no collider; it can't be pressed.`);
        return;
      }

      addPhysicsCollider(
        ctx.world,
        node,
        new RemoteCollider(ctx.resourceManager, { type: ColliderType.Box, size: colliderSize })
      );
    }

    addPhysicsBody(
      ctx.world,
      physics,
      node,
      new RemotePhysicsBody(ctx.resourceManager, { type: PhysicsBodyType.Static })
    );
  }

  if (!node.interactable) {
    addInteractableComponent(ctx, physics, node, InteractableType.Interactable);
  }
}

/** Client-wide quality cap (settings / low-end devices). Re-applies to every mirror. */
export function setMaxMirrorState(ctx: GameContext, max: MirrorState) {
  maxMirrorState = max;

  for (const [node, requested] of requestedStates) {
    if (node.mirror && isAlive(ctx, node)) node.mirror.state = clampMirrorState(requested, max);
  }
}

export function MirrorSystem(ctx: GameContext) {
  for (const [toggleNode, mirrorNodes] of mirrorToggles) {
    if (!isAlive(ctx, toggleNode)) {
      mirrorToggles.delete(toggleNode);
      continue;
    }

    if (!toggleNode.interactable?.pressed) continue;

    for (const mirrorNode of mirrorNodes) {
      if (!mirrorNode.mirror || !isAlive(ctx, mirrorNode)) continue;
      const next = nextMirrorState(mirrorNode.mirror.state, maxMirrorState);
      requestedStates.set(mirrorNode, next);
      mirrorNode.mirror.state = next;
    }
  }

  for (const mirrorNode of requestedStates.keys()) {
    if (!isAlive(ctx, mirrorNode)) requestedStates.delete(mirrorNode);
  }
}
