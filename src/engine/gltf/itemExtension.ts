/**
 * Buzzar: an Item file's own extension. Items were called Things until 2026-11, and their files used HAVEN_thing:
 * those still load, read as HAVEN_item.
 */
export const ITEM_EXTENSION = "HAVEN_item";
export const LEGACY_ITEM_EXTENSION = "HAVEN_thing";

/** The file's HAVEN_item, or its older HAVEN_thing. */
export function itemExtension(gltf: { extensions?: Record<string, unknown> } | undefined | null): unknown {
  const extensions = gltf?.extensions;
  return extensions?.[ITEM_EXTENSION] ?? extensions?.[LEGACY_ITEM_EXTENSION];
}

/** Moves a file's HAVEN_thing to HAVEN_item (before writing to it), keeping what it says. */
export function upgradeItemExtension(gltf: { extensions?: Record<string, unknown>; extensionsUsed?: string[] }) {
  const extensions = gltf.extensions;
  if (!extensions || !(LEGACY_ITEM_EXTENSION in extensions)) return;
  if (!(ITEM_EXTENSION in extensions)) extensions[ITEM_EXTENSION] = extensions[LEGACY_ITEM_EXTENSION];
  delete extensions[LEGACY_ITEM_EXTENSION];
  if (gltf.extensionsUsed) {
    gltf.extensionsUsed = gltf.extensionsUsed.filter((e) => e !== LEGACY_ITEM_EXTENSION);
    if (!gltf.extensionsUsed.includes(ITEM_EXTENSION)) gltf.extensionsUsed.push(ITEM_EXTENSION);
  }
}
