import { Texture, DoubleSide, FrontSide, MeshPhysicalMaterial } from "three";

import { RenderContext } from "../renderer.render";
import { getLocalResources, RenderMaterial, RenderTexture } from "../RenderResources";
import { MaterialAlphaMode } from "../../resource/schema";
import { PrimitiveMaterial } from "../materials";

type TextureKeys<Mat extends PrimitiveMaterial> = {
  [Key in keyof Mat]: Mat[Key] extends Texture | null ? Key : never;
}[keyof Mat];

function updateMaterialTexture<Mat extends PrimitiveMaterial>(
  material: Mat,
  key: TextureKeys<Mat>,
  value: RenderTexture | undefined,
  offset: Float32Array,
  rotation: number,
  scale: Float32Array
) {
  if (!!material[key] !== !!value) {
    material.needsUpdate = true;
  }

  const texture = ((material[key] as Texture | null) = value?.texture || null);

  if (texture) {
    texture.offset.fromArray(offset);
    texture.rotation = rotation;
    texture.repeat.fromArray(scale);
  }
}

/** Sets a map without touching the texture's transform (it may be shared with a map that has one). */
function setMaterialMap(material: MeshPhysicalMaterial, key: TextureKeys<MeshPhysicalMaterial>, texture?: Texture) {
  if (!!material[key] !== !!texture) material.needsUpdate = true;
  (material[key] as Texture | null) = texture ?? null;
}

export function UpdateRendererMaterialSystem(ctx: RenderContext) {
  const localMaterials = getLocalResources(ctx, RenderMaterial);

  for (let i = 0; i < localMaterials.length; i++) {
    const localMaterial = localMaterials[i];
    const materialCache = localMaterial.materialCache;

    for (let j = 0; j < materialCache.length; j++) {
      const { useDerivativeTangents, material } = materialCache[j];

      if (!("isMatrixMaterial" in material)) {
        material.color.fromArray(localMaterial.baseColorFactor);
      }

      material.opacity = localMaterial.baseColorFactor[3];
      material.side = localMaterial.doubleSided ? DoubleSide : FrontSide;
      material.transparent = localMaterial.alphaMode === MaterialAlphaMode.BLEND;
      material.depthWrite = localMaterial.alphaMode !== MaterialAlphaMode.BLEND;
      material.alphaTest = localMaterial.alphaMode === MaterialAlphaMode.MASK ? localMaterial.alphaCutoff : 0;

      if ("map" in material) {
        updateMaterialTexture(
          material,
          "map",
          localMaterial.baseColorTexture,
          localMaterial.baseColorTextureOffset,
          localMaterial.baseColorTextureRotation,
          localMaterial.baseColorTextureScale
        );
      }

      if ("isMeshStandardMaterial" in material) {
        material.metalness = localMaterial.metallicFactor; // 🤘
        updateMaterialTexture(
          material,
          "metalnessMap",
          localMaterial.metallicRoughnessTexture,
          localMaterial.metallicRoughnessTextureOffset,
          localMaterial.metallicRoughnessTextureRotation,
          localMaterial.metallicRoughnessTextureScale
        );
        material.roughness = localMaterial.roughnessFactor;
        updateMaterialTexture(
          material,
          "roughnessMap",
          localMaterial.metallicRoughnessTexture,
          localMaterial.metallicRoughnessTextureOffset,
          localMaterial.metallicRoughnessTextureRotation,
          localMaterial.metallicRoughnessTextureScale
        );
        material.normalScale.set(
          localMaterial.normalScale,
          useDerivativeTangents ? -localMaterial.normalScale : localMaterial.normalScale
        );
        updateMaterialTexture(
          material,
          "normalMap",
          localMaterial.normalTexture,
          localMaterial.normalTextureOffset,
          localMaterial.normalTextureRotation,
          localMaterial.normalTextureScale
        );
        material.aoMapIntensity = localMaterial.occlusionTextureStrength;
        updateMaterialTexture(
          material,
          "aoMap",
          localMaterial.occlusionTexture,
          localMaterial.occlusionTextureOffset,
          localMaterial.occlusionTextureRotation,
          localMaterial.occlusionTextureScale
        );
        material.emissive.fromArray(localMaterial.emissiveFactor);
        material.emissiveIntensity = localMaterial.emissiveStrength;
        updateMaterialTexture(
          material,
          "emissiveMap",
          localMaterial.emissiveTexture,
          localMaterial.emissiveTextureOffset,
          localMaterial.emissiveTextureRotation,
          localMaterial.emissiveTextureScale
        );
      }

      if ("isMeshPhysicalMaterial" in material) {
        // TODO: add isMeshPhysicalMaterial to MeshPhysicalMaterial types
        const physicalMaterial = material as MeshPhysicalMaterial;
        physicalMaterial.ior = localMaterial.ior;
        physicalMaterial.thickness = localMaterial.thicknessFactor;
        physicalMaterial.attenuationDistance = localMaterial.attenuationDistance;
        physicalMaterial.attenuationColor.fromArray(localMaterial.attenuationColor);
        physicalMaterial.transmission = localMaterial.transmissionFactor;
        updateMaterialTexture(
          physicalMaterial,
          "transmissionMap",
          localMaterial.transmissionTexture,
          localMaterial.transmissionTextureOffset,
          localMaterial.transmissionTextureRotation,
          localMaterial.transmissionTextureScale
        );
        updateMaterialTexture(
          physicalMaterial,
          "thicknessMap",
          localMaterial.thicknessTexture,
          localMaterial.thicknessTextureOffset,
          localMaterial.thicknessTextureRotation,
          localMaterial.thicknessTextureScale
        );

        // Buzzar: clearcoat, sheen, specular, iridescence (maps are set as-is: they ignore KHR_texture_transform).
        const m = localMaterial;
        physicalMaterial.clearcoat = m.clearcoatFactor;
        physicalMaterial.clearcoatRoughness = m.clearcoatRoughnessFactor;
        physicalMaterial.clearcoatNormalScale.set(m.clearcoatNormalScale, m.clearcoatNormalScale);
        physicalMaterial.sheen = m.sheenColorFactor[0] + m.sheenColorFactor[1] + m.sheenColorFactor[2] > 0 ? 1 : 0;
        physicalMaterial.sheenColor.fromArray(m.sheenColorFactor);
        physicalMaterial.sheenRoughness = m.sheenRoughnessFactor;
        physicalMaterial.specularIntensity = m.specularFactor;
        physicalMaterial.specularColor.fromArray(m.specularColorFactor);
        physicalMaterial.iridescence = m.iridescenceFactor;
        physicalMaterial.iridescenceIOR = m.iridescenceIor;
        physicalMaterial.iridescenceThicknessRange[0] = m.iridescenceThicknessMinimum;
        physicalMaterial.iridescenceThicknessRange[1] = m.iridescenceThicknessMaximum;
        setMaterialMap(physicalMaterial, "clearcoatMap", m.clearcoatTexture?.texture);
        setMaterialMap(physicalMaterial, "clearcoatRoughnessMap", m.clearcoatRoughnessTexture?.texture);
        setMaterialMap(physicalMaterial, "clearcoatNormalMap", m.clearcoatNormalTexture?.texture);
        setMaterialMap(physicalMaterial, "sheenColorMap", m.sheenColorTexture?.texture);
        setMaterialMap(physicalMaterial, "sheenRoughnessMap", m.sheenRoughnessTexture?.texture);
        setMaterialMap(physicalMaterial, "specularIntensityMap", m.specularTexture?.texture);
        setMaterialMap(physicalMaterial, "specularColorMap", m.specularColorTexture?.texture);
        setMaterialMap(physicalMaterial, "iridescenceMap", m.iridescenceTexture?.texture);
        setMaterialMap(physicalMaterial, "iridescenceThicknessMap", m.iridescenceThicknessTexture?.texture);
      }
    }
  }
}
