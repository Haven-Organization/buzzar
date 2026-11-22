import { Texture, WebGLArrayRenderTarget, Event, Vector2 } from "three";

import { getModule } from "../../module/module.common";
import { RendererModule, RenderContext } from "../renderer.render";
import { LoadStatus } from "../../resource/resource.common";
import { getReflectionProbes } from "../ReflectionProbe";

const reflectionProbeMapRenderTargets = new WeakMap<Texture, WebGLArrayRenderTarget>();

export function UpdateReflectionProbesSystem(ctx: RenderContext) {
  const scene = ctx.worldResource.environment?.publicScene;

  if (!scene) {
    return;
  }

  const rendererModule = getModule(ctx, RendererModule);

  const reflectionProbes = getReflectionProbes(ctx);

  let needsUpdate = scene.reflectionProbeNeedsUpdate;

  if (!needsUpdate) {
    for (let i = 0; i < reflectionProbes.length; i++) {
      if (reflectionProbes[i].needsUpdate) {
        needsUpdate = true;
        break;
      }
    }
  }

  // Only update reflection probe texture array if the reflection probes changed
  if (needsUpdate) {
    const reflectionProbeTextures: Texture[] = [];
    // Buzzar (Third Room #396): whether each texture is RGBM. One decode for the whole array decoded plain probes
    // as RGBM too whenever any probe in the world was RGBM.
    const rgbm: boolean[] = [];

    // Add the scene reflection probe to the texture array
    if (
      scene.reflectionProbe?.reflectionProbeTexture?.loadStatus === LoadStatus.Loaded &&
      scene.reflectionProbe.reflectionProbeTexture.texture
    ) {
      scene.reflectionProbe.textureArrayIndex = reflectionProbeTextures.length;
      scene.reflectionProbeNeedsUpdate = false;
      reflectionProbeTextures.push(scene.reflectionProbe.reflectionProbeTexture.texture);
      rgbm.push(!!scene.reflectionProbe.reflectionProbeTexture.rgbm);
    }

    // Add each node reflection probe to the texture array array
    for (const reflectionProbe of reflectionProbes) {
      const reflectionProbeTexture = reflectionProbe.resource.reflectionProbeTexture;

      if (!reflectionProbeTexture) {
        throw new Error("Reflection probe texture not yet loaded");
      }

      if (reflectionProbeTexture.loadStatus === LoadStatus.Loaded && reflectionProbeTexture.texture) {
        reflectionProbe.resource.textureArrayIndex = reflectionProbeTextures.length;
        reflectionProbe.needsUpdate = false;
        reflectionProbeTextures.push(reflectionProbeTexture.texture);
        rgbm.push(!!reflectionProbeTexture.rgbm);
      }
    }

    if (rendererModule.reflectionProbesMap) {
      // Dispose of the previous WebGLArrayRenderTarget
      rendererModule.reflectionProbesMap.dispose();
    }

    if (reflectionProbeTextures.length > 0) {
      const hdrDecodeParams = perTextureDecodeParams(rgbm);

      const renderTarget = (rendererModule.pmremGenerator as any).fromEquirectangularArray(
        reflectionProbeTextures,
        hdrDecodeParams
      );
      reflectionProbeMapRenderTargets.set(renderTarget.texture, renderTarget);
      rendererModule.reflectionProbesMap = renderTarget.texture;

      const onReflectionProbeTextureDisposed = (event: Event) => {
        const texture = event.target as Texture;

        const renderTarget = reflectionProbeMapRenderTargets.get(texture);

        if (renderTarget) {
          reflectionProbeMapRenderTargets.delete(texture);
          // Ensure render target is disposed when the texture is disposed.
          renderTarget.dispose();
        }

        texture.removeEventListener("dispose", onReflectionProbeTextureDisposed);
      };

      renderTarget.texture.addEventListener("dispose", onReflectionProbeTextureDisposed);
      rendererModule.pmremGenerator.dispose(); // Dispose of the extra render target and materials
    } else {
      rendererModule.reflectionProbesMap = null;
    }
  }
}

const RGBM_DECODE = new Vector2(34.49, 2.2);
const NO_DECODE = new Vector2(1, 1);

/**
 * Buzzar (Third Room #396): decode parameters for each texture of a reflection probe array. The PMREM generator takes
 * one Vector2 for the whole array and copies it (`.copy()`, reading x then y) once per texture, so this object steps
 * through the list as it's read. (1, 1) leaves a texture as it is (its alpha is 1).
 */
export function perTextureDecodeParams(rgbm: boolean[]): Vector2 {
  let reads = 0;
  const current = () => (rgbm[Math.floor(reads++ / 2)] ? RGBM_DECODE : NO_DECODE);
  return {
    get x() {
      return current().x;
    },
    get y() {
      return current().y;
    },
  } as unknown as Vector2;
}
