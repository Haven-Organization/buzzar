import { addLayer, Layer, removeLayer } from "../common/Layers";
import { traverse } from "../component/transform";
import { RemoteNode } from "../resource/RemoteResources";

/**
 * Buzzar: render layers for avatars.
 *
 * Every node of an avatar is on `Layer.Avatar`, so low-quality mirrors can render only avatars.
 * Your own avatar in first person drops `Layer.Default`: the main camera no longer draws it, but mirrors
 * (which render `Layer.Avatar`) still show your whole body. This replaces hiding it with `visible = false`.
 */
const hiddenFromMainCamera = new WeakMap<RemoteNode, boolean>();

export function computeAvatarNodeLayers(layers: number, hiddenFromMain: boolean): number {
  const withAvatar = addLayer(layers, Layer.Avatar);
  return hiddenFromMain ? removeLayer(withAvatar, Layer.Default) : addLayer(withAvatar, Layer.Default);
}

/** (Re)apply avatar layers to every node under `avatarRoot`. Call again after async glTF loads finish. */
export function applyAvatarLayers(avatarRoot: RemoteNode) {
  const hidden = hiddenFromMainCamera.get(avatarRoot) ?? false;
  traverse(avatarRoot, (node) => {
    node.layers = computeAvatarNodeLayers(node.layers, hidden);
  });
}

export function isAvatarHiddenFromMainCamera(avatarRoot: RemoteNode): boolean {
  return hiddenFromMainCamera.get(avatarRoot) ?? false;
}

/** Hide/show an avatar for the first-person camera while keeping it visible in mirrors. */
export function setAvatarHiddenFromMainCamera(avatarRoot: RemoteNode, hidden: boolean) {
  hiddenFromMainCamera.set(avatarRoot, hidden);
  applyAvatarLayers(avatarRoot);
}
