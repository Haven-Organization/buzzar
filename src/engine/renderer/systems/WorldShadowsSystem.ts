/**
 * Buzzar (Third Room #204): shadows.
 *
 * - Sun shadows follow you. A directional light's shadow covers a box; it was a fixed 20 m square at the light
 *   node's position, so shadows only appeared near wherever the light was placed. The box is now re-centred on the
 *   camera every frame (snapped to whole shadow texels so edges don't shimmer as you move).
 * - A world can turn shadows on (World Settings → Scene & Script, rules `shadows`): `sun` makes its directional
 *   lights cast shadows and every mesh cast and receive them; `bakedSun`, for lightmapped worlds, adds a shadow-only
 *   sun so moving things (objects, avatars) cast shadows into the baked light without relighting the world (the
 *   lightmap shader darkens by it, see patchShaderChunks).
 * - Your own setting (Settings → Graphics → Shadows) can turn shadow maps off entirely (RenderPipeline).
 */
import { DirectionalLight, OrthographicCamera, Vector3 } from "three";

import { getModule } from "../../module/module.common";
import { getLocalResources, RenderNode, RenderScene } from "../RenderResources";
import { RenderContext, RendererModule } from "../renderer.render";

/** Half the width of the area around you that gets sun shadows (m), and how far along the light it reaches. */
const SHADOW_HALF_SIZE = 25;
const SHADOW_DEPTH = 150;

const _camera = new Vector3();
const _target = new Vector3();
const _local = new Vector3();

/** Re-centres a directional light's shadow box on `center`, keeping the light's direction. */
export function fitShadowToPoint(light: DirectionalLight, center: Vector3) {
  light.updateMatrixWorld();
  const shadowCamera = light.shadow.camera as OrthographicCamera;
  shadowCamera.position.setFromMatrixPosition(light.matrixWorld);
  _target.setFromMatrixPosition(light.target.matrixWorld);
  shadowCamera.lookAt(_target);
  shadowCamera.updateMatrixWorld();

  _local.copy(center).applyMatrix4(shadowCamera.matrixWorldInverse);
  const texel = (2 * SHADOW_HALF_SIZE) / (light.shadow.mapSize.x || 512);
  const x = Math.round(_local.x / texel) * texel;
  const y = Math.round(_local.y / texel) * texel;
  shadowCamera.left = x - SHADOW_HALF_SIZE;
  shadowCamera.right = x + SHADOW_HALF_SIZE;
  shadowCamera.top = y + SHADOW_HALF_SIZE;
  shadowCamera.bottom = y - SHADOW_HALF_SIZE;
  // The camera looks down -Z: the point is -local.z along the light. (An orthographic near plane may be negative.)
  shadowCamera.near = -_local.z - SHADOW_DEPTH;
  shadowCamera.far = -_local.z + SHADOW_DEPTH;
  shadowCamera.updateProjectionMatrix();
}

/** The direction light comes *from*, given degrees clockwise from north (-Z) and above the horizon. */
export function sunDirection(azimuth: number, elevation: number, out = new Vector3()) {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function collectSceneNodes(scene: RenderScene | undefined, into: Set<RenderNode>) {
  const visit = (node: RenderNode | undefined) => {
    for (let n = node; n; n = n.nextSibling) {
      into.add(n);
      visit(n.firstChild);
    }
  };
  visit(scene?.firstNode);
}

const worldNodes = new Set<RenderNode>();

export function WorldShadowsSystem(ctx: RenderContext) {
  const rendererModule = getModule(ctx, RendererModule);
  const { renderer, renderPipeline, worldShadows, scene } = rendererModule;

  const bakedSun = renderer.shadowMap.enabled ? worldShadows.bakedSun : undefined;
  const sun = renderer.shadowMap.enabled && worldShadows.sun && !bakedSun;

  // The shadow-only sun: there while the world asks for one.
  if (bakedSun && !rendererModule.shadowSun) {
    const light = new DirectionalLight(0xffffff, 0);
    light.name = "Shadow Sun";
    light.castShadow = true;
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.05;
    if (renderPipeline.directionalShadowMapSize) light.shadow.mapSize.copy(renderPipeline.directionalShadowMapSize);
    light.add(light.target);
    scene.add(light);
    rendererModule.shadowSun = light;
  } else if (!bakedSun && rendererModule.shadowSun) {
    rendererModule.shadowSun.parent?.remove(rendererModule.shadowSun);
    rendererModule.shadowSun.dispose();
    rendererModule.shadowSun = undefined;
  }

  const nodes = getLocalResources(ctx, RenderNode);

  if (sun || bakedSun) {
    worldNodes.clear();
    collectSceneNodes(ctx.worldResource.environment?.publicScene, worldNodes);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const objects = node.meshPrimitiveObjects;
      if (objects) {
        // With a baked sun the world's own shadows are already in its lightmaps: only moving things cast.
        const cast = sun || !worldNodes.has(node);
        for (let j = 0; j < objects.length; j++) {
          objects[j].castShadow = cast;
          objects[j].receiveShadow = true;
        }
      }
      // A baked sun is the only directional shadow (the lightmap shader reads shadow 0).
      if (node.lightObject instanceof DirectionalLight) node.lightObject.castShadow = sun;
    }
  }

  const cameraObject = ctx.worldResource.activeCameraNode?.cameraObject;
  if (!cameraObject || !renderer.shadowMap.enabled) return;
  cameraObject.getWorldPosition(_camera);

  const shadowSun = rendererModule.shadowSun;
  if (shadowSun && bakedSun) {
    // Placed at the camera, shining along the world's chosen direction.
    shadowSun.position.copy(_camera);
    sunDirection(bakedSun.azimuth, bakedSun.elevation, shadowSun.target.position).negate();
    fitShadowToPoint(shadowSun, _camera);
  }

  for (let i = 0; i < nodes.length; i++) {
    const light = nodes[i].lightObject;
    if (light instanceof DirectionalLight && light.castShadow) fitShadowToPoint(light, _camera);
  }
}
