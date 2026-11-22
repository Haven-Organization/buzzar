import { Color, Texture, Vector2, WebGLRenderTarget } from "three";

import { getModule } from "../../module/module.common";
import { RendererModule, RendererModuleState, RenderContext } from "../renderer.render";
import { LoadStatus } from "../../resource/resource.common";
import { RenderScene } from "../RenderResources";

const blackBackground = new Color(0x000000);

/**
 * Buzzar (Third Room #396): an RGBM skybox (MX_texture_rgbm) drawn as it is looks wrong (its brightness is in the
 * alpha channel). It's decoded once through the PMREM generator, which three.js can draw as a background.
 */
const RGBM_DECODE = new Vector2(34.49, 2.2);
let decodedBackground: { source: Texture; target: WebGLRenderTarget } | undefined;

function backgroundFor(rendererModule: RendererModuleState, texture: Texture, rgbm: boolean) {
  if (!rgbm) return texture;
  if (decodedBackground?.source !== texture) {
    decodedBackground?.target.dispose();
    // The fork's PMREMGenerator takes decode parameters as a third argument (its typings leave it out).
    const pmrem = rendererModule.pmremGenerator as unknown as {
      fromEquirectangular(texture: Texture, target: null, decode: Vector2): WebGLRenderTarget;
    };
    const target = pmrem.fromEquirectangular(texture, null, RGBM_DECODE);
    decodedBackground = { source: texture, target };
  }
  return decodedBackground.target.texture;
}

export function UpdateActiveSceneResourceSystem(ctx: RenderContext) {
  const rendererModule = getModule(ctx, RendererModule);

  const activeScene = ctx.worldResource.environment?.publicScene;

  if (activeScene) {
    rendererModule.scene.visible = true;

    const currentBackgroundTextureResourceId = activeScene.currentBackgroundTextureResourceId;
    const nextBackgroundTextureResourceId = activeScene.backgroundTexture?.eid || 0;

    if (
      nextBackgroundTextureResourceId !== currentBackgroundTextureResourceId &&
      activeScene.backgroundTexture?.loadStatus === LoadStatus.Loaded
    ) {
      activeScene.currentBackgroundTextureResourceId = nextBackgroundTextureResourceId;
    }

    rendererModule.renderPipeline.bloomPass.strength = activeScene.bloomStrength;
    rendererModule.renderPipeline.bloomPass.threshold = activeScene.bloomThreshold;
    rendererModule.renderPipeline.bloomPass.radius = activeScene.bloomRadius;

    updateSceneReflectionProbe(ctx, activeScene);

    if (rendererModule.enableMatrixMaterial || performance.now() < rendererModule.revealUntil) {
      rendererModule.scene.overrideMaterial = rendererModule.matrixMaterial;
      rendererModule.scene.background = blackBackground;
    } else {
      rendererModule.scene.overrideMaterial = null;

      const xrSession = rendererModule.renderer.xr.getSession();

      let showBackground = true;

      if (xrSession && activeScene.supportsAR) {
        showBackground = xrSession.environmentBlendMode === "opaque";
      }

      const background = activeScene.backgroundTexture;
      if (background?.loadStatus === LoadStatus.Loaded && background.texture && showBackground) {
        rendererModule.scene.background = backgroundFor(rendererModule, background.texture, !!background.rgbm);
      } else {
        rendererModule.scene.background = null;
      }
    }
  } else {
    rendererModule.scene.visible = false;
  }
}

function updateSceneReflectionProbe(ctx: RenderContext, scene: RenderScene) {
  const currentReflectionProbeResourceId = scene.currentReflectionProbeResourceId;
  const nextReflectionProbeResourceId = scene.reflectionProbe?.eid || 0;

  if (nextReflectionProbeResourceId !== currentReflectionProbeResourceId) {
    scene.reflectionProbeNeedsUpdate = true;
  }

  scene.currentReflectionProbeResourceId = nextReflectionProbeResourceId;
}
