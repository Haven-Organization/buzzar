export enum Layer {
  Default,
  EditorSelection,
  /**
   * Buzzar: every node of every player avatar (including your own). Low-quality mirrors render only
   * this layer. Your own avatar is on this layer *without* Default, so the first-person camera
   * doesn't see it but mirrors do.
   */
  Avatar,
  /** Buzzar: all light objects, so cameras that skip world geometry (avatars-only mirrors) are still lit. */
  Lights,
  /** Buzzar: outlined because the local player is pointing at it (interactable hover highlight). */
  InteractableHighlight,
}

export function addLayer(layers: number, layer: Layer): number {
  return layers | (1 << layer);
}

export function removeLayer(layers: number, layer: Layer): number {
  return layers & ~(1 << layer);
}

export function isInLayer(layers: number, layer: Layer): boolean {
  return (layers & (1 << layer)) !== 0;
}
