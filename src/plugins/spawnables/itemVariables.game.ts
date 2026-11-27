/**
 * Buzzar: applying Item variables (itemVariables.common.ts) to the objects the stock Items are built from.
 */
import { GameContext } from "../../engine/GameTypes";
import { RemoteMaterial, RemoteMesh, RemoteMeshPrimitive, RemoteNode } from "../../engine/resource/RemoteResources";
import { decodeItemVariables, sanitizeItemVariables, ItemVariables } from "./itemVariables.common";

/** The options a stock Item's prefab is created with. */
export interface ItemPrefabOptions {
  kinematic?: boolean;
  /** Spawned here: already validated. */
  variables?: ItemVariables;
  /** From a peer's create message: untrusted bytes. */
  createData?: ArrayBuffer;
}

/** The variables an Item is created with, validated for it. */
export function itemVariablesFor(itemId: string, options: ItemPrefabOptions | undefined): ItemVariables {
  if (options?.variables) return sanitizeItemVariables(itemId, options.variables);
  return sanitizeItemVariables(itemId, decodeItemVariables(options?.createData));
}

/** A copy of a material with its colour (and glow colour) multiplied by `tint`, and its glow strength set. */
export function variantMaterial(
  ctx: GameContext,
  m: RemoteMaterial,
  tint: [number, number, number] | undefined,
  glow: number | undefined
): RemoteMaterial {
  const t = tint ?? [1, 1, 1];
  const base = m.baseColorFactor;
  const emissive = m.emissiveFactor;
  return new RemoteMaterial(ctx.resourceManager, {
    name: m.name,
    type: m.type,
    doubleSided: m.doubleSided,
    alphaMode: m.alphaMode,
    alphaCutoff: m.alphaCutoff,
    baseColorFactor: [base[0] * t[0], base[1] * t[1], base[2] * t[2], base[3]],
    baseColorTexture: m.baseColorTexture,
    metallicFactor: m.metallicFactor,
    roughnessFactor: m.roughnessFactor,
    metallicRoughnessTexture: m.metallicRoughnessTexture,
    normalTexture: m.normalTexture,
    normalScale: m.normalScale,
    occlusionTexture: m.occlusionTexture,
    occlusionTextureStrength: m.occlusionTextureStrength,
    emissiveFactor: [emissive[0] * t[0], emissive[1] * t[1], emissive[2] * t[2]],
    emissiveTexture: m.emissiveTexture,
    emissiveStrength: glow ?? m.emissiveStrength,
  });
}

/**
 * Tints every mesh under `root` (an Item loaded from a file). Meshes and materials from a file are shared by every
 * copy of it, so this object gets its own copies; the geometry itself stays shared.
 */
export function tintNodeTree(ctx: GameContext, root: RemoteNode, tint: [number, number, number]) {
  const materials = new Map<RemoteMaterial, RemoteMaterial>();
  const visit = (node: RemoteNode) => {
    const mesh = node.mesh;
    if (mesh) {
      node.mesh = new RemoteMesh(ctx.resourceManager, {
        name: mesh.name,
        primitives: mesh.primitives.map((p) => {
          let material = p.material;
          if (material) {
            const tinted = materials.get(material) ?? variantMaterial(ctx, material, tint, undefined);
            materials.set(material, tinted);
            material = tinted;
          }
          const attributes: { [index: number]: (typeof p.attributes)[number] } = {};
          p.attributes.forEach((accessor, index) => {
            if (accessor) attributes[index] = accessor;
          });
          return new RemoteMeshPrimitive(ctx.resourceManager, {
            attributes,
            indices: p.indices,
            material,
            mode: p.mode,
            targetPositions: p.targetPositions,
            targetNormals: p.targetNormals,
          });
        }),
      });
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(root);
}
