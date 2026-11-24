/**
 * Buzzar: compiles shaders before they're needed. three.js compiles a material's shader the first time something
 * using it is drawn, which blocked the render thread for up to a second and a half while a world loaded: looking
 * around in a new world stuttered, every time a new part of it came into view. A mirror doubled it: its reflection
 * is drawn with other settings (no tone mapping), so each material needs a second shader.
 *
 * Once a second this counts the scene's meshes; when the count changes (a world appeared, avatars or Things
 * loaded), it compiles everything at once, for the main view and, when a mirror is on, for reflections too. Already
 * compiled shaders come out of three.js's cache, so it costs nothing when nothing is new.
 */
import { Mesh, NoToneMapping, Object3D, Scene } from "three";

import { getModule } from "../../module/module.common";
import { RenderQuality } from "../renderer.common";
import { RenderContext, RendererModule } from "../renderer.render";
import { Mirror } from "../Mirror";
import { MirrorState } from "../../resource/schema";

const CHECK_MS = 1000;
let lastCheck = 0;
let lastSceneEid = 0;
let lastMeshCount = -1;

function countMeshes(scene: Scene) {
  let meshes = 0;
  let mirror: Mirror | undefined;
  scene.traverse((object: Object3D) => {
    if ((object as Mesh).isMesh) meshes++;
    if (object instanceof Mirror && object.state !== MirrorState.Off) mirror ??= object;
  });
  return { meshes, mirror };
}

export function ShaderWarmupSystem(ctx: RenderContext) {
  const now = performance.now();
  if (now - lastCheck < CHECK_MS) return;
  lastCheck = now;

  const rendererModule = getModule(ctx, RendererModule);
  const activeScene = ctx.worldResource.environment?.publicScene;
  const camera = ctx.worldResource.activeCameraNode?.cameraObject;
  if (!activeScene || !camera) return;
  const { renderer, renderPipeline, scene } = rendererModule;
  if (renderer.xr.isPresenting) return;

  const { meshes, mirror } = countMeshes(scene);
  if (activeScene.eid === lastSceneEid && meshes === lastMeshCount) return;
  lastSceneEid = activeScene.eid;
  lastMeshCount = meshes;

  const previousTarget = renderer.getRenderTarget();
  const started = performance.now();
  const programsBefore = renderer.info.programs?.length ?? 0;
  try {
    // The main view: High and Ultra draw it into the post-processing target, Low straight to the screen.
    renderer.setRenderTarget(
      rendererModule.quality === RenderQuality.Low ? null : renderPipeline.effectComposer.renderTarget1
    );
    renderer.compile(scene, camera);
    if (mirror) {
      // As Mirror.renderReflection draws it.
      const toneMapping = renderer.toneMapping;
      renderer.toneMapping = NoToneMapping;
      renderer.setRenderTarget(mirror.renderTarget);
      renderer.compile(scene, camera);
      renderer.toneMapping = toneMapping;
    }
  } finally {
    renderer.setRenderTarget(previousTarget);
    const ms = performance.now() - started;
    const added = (renderer.info.programs?.length ?? 0) - programsBefore;
    if (ms > 50) {
      console.info(`[shaders] compiled ${added} new shaders for ${meshes} meshes in ${Math.round(ms)} ms`);
    }
  }
}
