/**
 * Buzzar (Third Room #128): automatic instancing. Many copies of the same small mesh (a pile of crates, a row of
 * balls, repeated props) were one draw call each. Each frame, plain meshes that share a geometry, a material, shadow
 * settings and layers are drawn together as one InstancedMesh once there are at least MIN_INSTANCES of them; the
 * individual meshes are hidden for that frame. Anything unusual draws on its own as before: skinned, morphing,
 * light-mapped, hologram or already-instanced meshes, big meshes, and an object whose layers differ (e.g. one that's
 * highlighted, so its outline still works).
 */
import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";

import { getModule } from "../../module/module.common";
import { getLocalResources, RenderNode } from "../RenderResources";
import { RenderContext, RendererModule } from "../renderer.render";
import { MatrixMaterial } from "../materials/MatrixMaterial";

const MIN_INSTANCES = 4;
/** Bigger meshes gain little from instancing and lose per-object frustum culling. */
const MAX_VERTICES = 20000;
/** Unused groups are removed after this many frames. */
const UNUSED_FRAMES = 120;

interface Group {
  geometry: BufferGeometry;
  material: Material;
  flags: number;
  instanced?: InstancedMesh;
  probeParams?: InstancedBufferAttribute;
  members: Mesh[];
  unusedFrames: number;
}

const groups = new Map<BufferGeometry, Map<Material, Map<number, Group>>>();
let hidden: { object: Object3D; node: RenderNode }[] = [];
const tempMatrix = new Matrix4();

function isEligible(object: Object3D): object is Mesh {
  const mesh = object as Mesh;
  if (!mesh.isMesh || !mesh.visible) return false;
  if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
  if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return false;
  if (Array.isArray(mesh.material) || mesh.userData.lightMap) return false;
  if ((mesh.material as unknown as { isHologramMaterial?: boolean }).isHologramMaterial) return false;
  const geometry = mesh.geometry;
  if (Object.keys(geometry.morphAttributes).length > 0 || mesh.morphTargetInfluences?.length) return false;
  const position = geometry.getAttribute("position");
  return !!position && position.count <= MAX_VERTICES;
}

function groupFor(geometry: BufferGeometry, material: Material, flags: number): Group {
  let byMaterial = groups.get(geometry);
  if (!byMaterial) groups.set(geometry, (byMaterial = new Map()));
  let byFlags = byMaterial.get(material);
  if (!byFlags) byMaterial.set(material, (byFlags = new Map()));
  let group = byFlags.get(flags);
  if (!group) byFlags.set(flags, (group = { geometry, material, flags, members: [], unusedFrames: 0 }));
  return group;
}

/** An InstancedMesh drawing `group`'s geometry, sized for at least `count` instances. */
function ensureInstanced(ctx: RenderContext, group: Group, count: number, layersMask: number) {
  const rendererModule = getModule(ctx, RendererModule);
  if (group.instanced && group.instanced.instanceMatrix.count >= count) return group.instanced;

  if (group.instanced) disposeInstanced(ctx, group);
  const capacity = Math.max(MIN_INSTANCES * 2, 2 ** Math.ceil(Math.log2(count)));

  // Shares the original's vertex data; only the per-instance attributes are new.
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(group.geometry.getIndex());
  for (const name in group.geometry.attributes) geometry.setAttribute(name, group.geometry.getAttribute(name));
  const probeParams = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3, false, 1);
  probeParams.setUsage(DynamicDrawUsage);
  geometry.setAttribute("instanceReflectionProbeParams", probeParams);

  const instanced = new InstancedMesh(geometry, group.material, capacity);
  instanced.instanceMatrix.setUsage(DynamicDrawUsage);
  instanced.frustumCulled = false;
  instanced.matrixAutoUpdate = false;
  instanced.castShadow = (group.flags & 1) !== 0;
  instanced.receiveShadow = (group.flags & 2) !== 0;
  instanced.layers.mask = layersMask;
  instanced.name = "AutoInstanced";

  // The per-object uniforms individual meshes set before drawing (see UpdateNodeResourcesSystem).
  instanced.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
    const matrixMaterial = material as unknown as MatrixMaterial;
    if (matrixMaterial.isMatrixMaterial) matrixMaterial.update(ctx.elapsed / 1000, instanced);
    const standard = material as MeshStandardMaterial;
    if (!standard.isMeshStandardMaterial || !standard.userData.reflectionProbesMap) return;
    standard.userData.reflectionProbesMap.value = rendererModule.reflectionProbesMap;
    const envMapHeight = rendererModule.reflectionProbesMap?.image.height || 256;
    const maxMip = Math.log2(envMapHeight) - 2;
    (standard.userData.reflectionProbeSampleParams.value as Vector3).set(
      maxMip,
      1.0 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)),
      1 / envMapHeight
    );
    (standard as unknown as { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
  };

  rendererModule.scene.add(instanced);
  group.instanced = instanced;
  group.probeParams = probeParams;
  return instanced;
}

function disposeInstanced(ctx: RenderContext, group: Group) {
  const instanced = group.instanced;
  if (!instanced) return;
  instanced.parent?.remove(instanced);
  // Only the instance attributes belong to it: detach the shared vertex data before disposing.
  const geometry = instanced.geometry;
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "instanceReflectionProbeParams") geometry.deleteAttribute(name);
  }
  geometry.setIndex(null);
  geometry.dispose();
  instanced.dispose();
  group.instanced = undefined;
  group.probeParams = undefined;
}

export function AutoInstancingSystem(ctx: RenderContext) {
  // Undo last frame's hiding (static nodes aren't refreshed every frame).
  for (const { object, node } of hidden) object.visible = node.object3DVisible;
  hidden = [];

  for (const byMaterial of groups.values())
    for (const byFlags of byMaterial.values()) for (const group of byFlags.values()) group.members.length = 0;

  const layerOf = new Map<Mesh, { node: RenderNode; mask: number }>();
  const nodes = getLocalResources(ctx, RenderNode);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const objects = node.meshPrimitiveObjects;
    if (!objects || node.skin) continue;
    for (let j = 0; j < objects.length; j++) {
      const object = objects[j];
      if (!isEligible(object)) continue;
      // Shadow flags in the low bits, then the layers (arithmetic: a shift would overflow for high layers).
      const flags = (object.castShadow ? 1 : 0) + (object.receiveShadow ? 2 : 0) + object.layers.mask * 4;
      groupFor(object.geometry, object.material as Material, flags).members.push(object);
      layerOf.set(object, { node, mask: object.layers.mask });
    }
  }

  for (const [geometry, byMaterial] of groups) {
    for (const [material, byFlags] of byMaterial) {
      for (const [flags, group] of byFlags) {
        const members = group.members;
        if (members.length < MIN_INSTANCES) {
          if (group.instanced) group.instanced.visible = false;
          if (++group.unusedFrames > UNUSED_FRAMES) {
            disposeInstanced(ctx, group);
            byFlags.delete(flags);
          }
          continue;
        }
        group.unusedFrames = 0;
        const instanced = ensureInstanced(ctx, group, members.length, layerOf.get(members[0])!.mask);
        instanced.visible = true;
        instanced.count = members.length;
        const probeParams = group.probeParams!;
        for (let m = 0; m < members.length; m++) {
          const member = members[m];
          // Meshes sit directly in the scene, so their local transform is their world transform.
          tempMatrix.compose(member.position, member.quaternion, member.scale);
          instanced.setMatrixAt(m, tempMatrix);
          const params = member.userData.reflectionProbeParams as Vector3 | undefined;
          if (params) probeParams.setXYZ(m, params.x, params.y, params.z);
          member.visible = false;
          hidden.push({ object: member, node: layerOf.get(member)!.node });
        }
        instanced.instanceMatrix.needsUpdate = true;
        probeParams.needsUpdate = true;
      }
      if (byFlags.size === 0) byMaterial.delete(material);
    }
    if (byMaterial.size === 0) groups.delete(geometry);
  }
}
