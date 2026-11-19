/**
 * Buzzar mirrors (glTF `HAVEN_mirror`, plus Hubs `MOZ_hubs_components.mirror`).
 *
 * Mirror state (Off / Low = avatars only / High = everything) is local to each user, like VRChat:
 * toggling a mirror never changes it for anyone else. Pressing the mirror surface or one of its toggle
 * nodes cycles Off → High → Low → Off; pressing one of its state buttons sets that state. A per-client cap (`setMaxMirrorState`) limits quality, e.g. for
 * low-end devices.
 */
import { GameContext } from "../../engine/GameTypes";
import { getModule } from "../../engine/module/module.common";
import { addPhysicsBody, addPhysicsCollider, PhysicsModule } from "../../engine/physics/physics.game";
import {
  RemoteCollider,
  RemoteMaterial,
  RemoteMirror,
  RemoteNode,
  RemotePhysicsBody,
} from "../../engine/resource/RemoteResources";
import { getAccessorFloat32Array } from "../../engine/common/accessor";
import { getRemoteResource } from "../../engine/resource/resource.game";
import {
  ColliderType,
  InteractableType,
  MeshPrimitiveAttributeIndex,
  MirrorState,
  PhysicsBodyType,
} from "../../engine/resource/schema";
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
  /** Indices of nodes that set this mirror to one state when pressed (each needs a collider). */
  buttons?: { off?: number[]; low?: number[]; high?: number[] };
}

/** What pressing a control does to a mirror: cycle its state, or set one. */
export type MirrorControlAction = "cycle" | MirrorState;

const MIRROR_STATE_NAMES: Record<string, MirrorState> = {
  off: MirrorState.Off,
  low: MirrorState.Low,
  high: MirrorState.High,
};

const COLLIDER_DEPTH = 0.02;

// Keyed by node object (not eid): eids are recycled, so a node is only considered alive while the
// resource map still returns this exact object for its eid.
/** Control node (the surface, a toggle or a state button) → the mirror nodes it controls, and how. */
const mirrorControls = new Map<RemoteNode, { mirror: RemoteNode; action: MirrorControlAction }[]>();
/** Mirror node → the state the world/user asked for, before the client cap is applied. */
const requestedStates = new Map<RemoteNode, MirrorState>();

function isAlive(ctx: GameContext, node: RemoteNode): boolean {
  return getRemoteResource<RemoteNode>(ctx, node.eid) === node;
}

let maxMirrorState: MirrorState = MirrorState.High;

/** "off" / "low" / "high" (any case) → the state, else undefined. */
export function mirrorStateFromName(name: unknown): MirrorState | undefined {
  return typeof name === "string" ? MIRROR_STATE_NAMES[name.toLowerCase()] : undefined;
}

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
    makeControl(ctx, node, node, "cycle", [width, height, COLLIDER_DEPTH]);
  }

  return mirror;
}

/** Called after all nodes of a glTF are loaded, so toggle indices can be resolved. */
export function addMirrorToggleNode(ctx: GameContext, toggleNode: RemoteNode, mirrorNode: RemoteNode) {
  makeControl(ctx, toggleNode, mirrorNode, "cycle");
}

/** A node that sets the mirror to `state` when pressed (resolved after load, like toggles). */
export function addMirrorButtonNode(
  ctx: GameContext,
  buttonNode: RemoteNode,
  mirrorNode: RemoteNode,
  state: MirrorState
) {
  makeControl(ctx, buttonNode, mirrorNode, state);
}

/** The state a control moves a mirror to, within the client's cap. */
export function applyMirrorControl(current: MirrorState, action: MirrorControlAction, max: MirrorState): MirrorState {
  return action === "cycle" ? nextMirrorState(current, max) : clampMirrorState(action, max);
}

function makeControl(
  ctx: GameContext,
  node: RemoteNode,
  mirrorNode: RemoteNode,
  action: MirrorControlAction,
  colliderSize?: [number, number, number]
) {
  const controlled = mirrorControls.get(node);

  if (controlled) {
    if (!controlled.some((c) => c.mirror === mirrorNode && c.action === action))
      controlled.push({ mirror: mirrorNode, action });
    return;
  }

  mirrorControls.set(node, [{ mirror: mirrorNode, action }]);

  const physics = getModule(ctx, PhysicsModule);

  if (!node.physicsBody) {
    if (!node.collider) {
      // Buzzar: no collider of its own: a box around its mesh (a file that declares OMI_collider anywhere loses
      // the generated collision for the rest of the scene, so buttons shouldn't need one).
      colliderSize ??= meshBoxSize(node);
      if (!colliderSize) {
        console.warn(`Mirror control node "${node.name}" has no collider or mesh; it can't be pressed.`);
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

/** A box centred on the node's origin that holds its whole mesh (undefined without a mesh). */
function meshBoxSize(node: RemoteNode): [number, number, number] | undefined {
  const half = [0, 0, 0];
  let found = false;
  for (const primitive of node.mesh?.primitives ?? []) {
    const accessor = primitive.attributes[MeshPrimitiveAttributeIndex.POSITION];
    if (!accessor) continue;
    const positions = getAccessorFloat32Array(accessor);
    for (let i = 0; i + 2 < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) half[axis] = Math.max(half[axis], Math.abs(positions[i + axis]));
    }
    found = true;
  }
  if (!found) return undefined;
  const scale = node.scale;
  return [0, 1, 2].map((axis) => Math.max(half[axis] * 2 * Math.abs(scale[axis]), 0.01)) as [number, number, number];
}

// Buzzar: the button for the mirror's current state is lit; the others are dimmed. Each button's materials are
// remembered as authored, so give every button its own materials.
const authoredLook = new Map<RemoteMaterial, { base: number[]; emissive: number[] }>();
const buttonLit = new Map<RemoteNode, boolean>();

function highlightButton(node: RemoteNode, lit: boolean) {
  if (buttonLit.get(node) === lit) return;
  buttonLit.set(node, lit);
  for (const primitive of node.mesh?.primitives ?? []) {
    const material = primitive.material;
    if (!material) continue;
    let look = authoredLook.get(material);
    if (!look) {
      look = { base: Array.from(material.baseColorFactor), emissive: Array.from(material.emissiveFactor) };
      authoredLook.set(material, look);
    }
    const [r, g, b, a] = look.base;
    const dim = lit ? 1 : 0.4;
    material.baseColorFactor.set([r * dim, g * dim, b * dim, a]);
    material.emissiveFactor.set(lit ? [r * 0.8, g * 0.8, b * 0.8] : look.emissive);
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
  for (const [controlNode, controls] of mirrorControls) {
    if (!isAlive(ctx, controlNode)) {
      mirrorControls.delete(controlNode);
      continue;
    }

    if (!controlNode.interactable?.pressed) continue;

    for (const { mirror: mirrorNode, action } of controls) {
      if (!mirrorNode.mirror || !isAlive(ctx, mirrorNode)) continue;
      const next = applyMirrorControl(mirrorNode.mirror.state, action, maxMirrorState);
      requestedStates.set(mirrorNode, action === "cycle" ? next : action);
      mirrorNode.mirror.state = next;
    }
  }

  for (const [controlNode, controls] of mirrorControls) {
    const button = controls.find((c) => c.action !== "cycle");
    if (!button || !button.mirror.mirror) continue;
    highlightButton(controlNode, button.mirror.mirror.state === button.action);
  }

  for (const node of buttonLit.keys()) {
    if (!mirrorControls.has(node)) buttonLit.delete(node);
  }

  for (const mirrorNode of requestedStates.keys()) {
    if (!isAlive(ctx, mirrorNode)) requestedStates.delete(mirrorNode);
  }
}
