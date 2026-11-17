/**
 * Buzzar: outline whatever interactable thing the local player is pointing at (like VRChat's hover highlight),
 * in addition to the "E / Interact" prompt. While holding something, the held object stays outlined instead, so it's
 * clear what you've picked up (Third Room #376).
 *
 * Works by putting the focused object's meshes on `Layer.InteractableHighlight`, which the render pipeline's
 * outline pass draws. Not shown in XR or on Low quality (no post-processing there yet).
 */
import { hasComponent } from "bitecs";

import { addLayer, Layer, removeLayer } from "../../engine/common/Layers";
import { traverse } from "../../engine/component/transform";
import { GameContext } from "../../engine/GameTypes";
import { RemoteNode } from "../../engine/resource/RemoteResources";
import { getRemoteResource } from "../../engine/resource/resource.game";
import { InteractableType } from "../../engine/resource/schema";
import { ourPlayerQuery } from "../../engine/player/Player";
import { GrabComponent, Interactable, getOurFocusedEntity } from "./interaction.game";

const HIGHLIGHTED_TYPES = new Set([InteractableType.Interactable, InteractableType.Grabbable, InteractableType.Portal]);

let highlightedEid = 0;
let highlightedNodes: RemoteNode[] = [];

/** The nodes to outline: the focused node's subtree, or its parent's if it has no visible geometry (e.g. a portal trigger). */
export function collectHighlightNodes(focused: RemoteNode): RemoteNode[] {
  const collect = (root: RemoteNode) => {
    const nodes: RemoteNode[] = [];
    traverse(root, (node) => {
      nodes.push(node);
    });
    return nodes;
  };
  const hasGeometry = (nodes: RemoteNode[]) => nodes.some((n) => n.mesh || n.mirror || n.instancedMesh);

  let nodes = collect(focused);
  if (!hasGeometry(nodes) && focused.parent) nodes = collect(focused.parent);
  return nodes;
}

export function InteractableHighlightSystem(ctx: GameContext) {
  const player = ourPlayerQuery(ctx.world)[0];
  const heldEid = player && hasComponent(ctx.world, GrabComponent, player) ? GrabComponent.grabbedEntity[player] : 0;
  let focusedEid = heldEid || getOurFocusedEntity(ctx);
  if (!heldEid && focusedEid && !HIGHLIGHTED_TYPES.has(Interactable.type[focusedEid])) focusedEid = 0;
  if (focusedEid === highlightedEid) return;

  for (const node of highlightedNodes) {
    if (getRemoteResource(ctx, node.eid) === node) node.layers = removeLayer(node.layers, Layer.InteractableHighlight);
  }
  highlightedNodes = [];
  highlightedEid = focusedEid;

  const focused = focusedEid ? getRemoteResource<RemoteNode>(ctx, focusedEid) : undefined;
  if (!focused) return;

  highlightedNodes = collectHighlightNodes(focused);
  for (const node of highlightedNodes) node.layers = addLayer(node.layers, Layer.InteractableHighlight);
}
