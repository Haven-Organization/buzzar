import { defineModule, registerMessageHandler, Thread } from "../module/module.common";
import { MainContext } from "../MainThread";
import {
  InitializeRendererMessage,
  LOCAL_STORAGE_RENDER_QUALITY,
  LOCAL_STORAGE_WORLD_REVEAL,
  LOCAL_STORAGE_SHADOW_QUALITY,
  ShadowQualitySetting,
  SetWorldShadowsMessage,
  WorldShadowSettings,
  parseWorldShadows,
  PrintRenderThreadStateMessage,
  RendererMessageType,
  rendererModuleName,
  RenderStatNames,
  RenderStatsBuffer,
  RenderQualitySetting,
  TogglePhysicsDebugMessage,
  AwaitShadersSettledMessage,
  ShadersSettledMessage,
} from "./renderer.common";
import { createDisposables } from "../utils/createDisposables";
import { registerThirdroomGlobalFn } from "../utils/registerThirdroomGlobal";
import { generateWorldMap } from "../../plugins/world-map/worldMap.main";

export interface MainRendererModuleState {
  statsBuffer: RenderStatsBuffer;
}

export const RendererModule = defineModule<MainContext, MainRendererModuleState>({
  name: rendererModuleName,
  async create({ canvas, inputRingBuffer, useOffscreenCanvas, supportedXRSessionModes, quality }, { sendMessage }) {
    const canvasTarget = useOffscreenCanvas ? canvas.transferControlToOffscreen() : canvas;

    const statsBuffer = createRenderStatsBuffer();

    sendMessage<InitializeRendererMessage>(
      Thread.Render,
      RendererMessageType.InitializeRenderer,
      {
        canvasTarget: useOffscreenCanvas ? (canvasTarget as OffscreenCanvas) : undefined,
        initialCanvasWidth: canvas.clientWidth,
        initialCanvasHeight: canvas.clientHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        supportedXRSessionModes,
        quality,
        dynamicResolution: dynamicResolutionEnabled(),
        worldReveal: worldRevealEnabled(),
        shadowQuality: shadowQualitySetting(),
        statsBuffer,
        inputRingBuffer,
      },
      useOffscreenCanvas ? [canvasTarget as OffscreenCanvas] : undefined
    );

    return {
      statsBuffer,
    };
  },
  init(ctx) {
    ctx.sendMessage(Thread.Render, {
      type: RendererMessageType.CanvasResize,
      canvasWidth: ctx.canvas.clientWidth,
      canvasHeight: ctx.canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    ctx.sendMessage(Thread.Game, {
      type: RendererMessageType.CanvasResize,
      canvasWidth: ctx.canvas.clientWidth,
      canvasHeight: ctx.canvas.clientHeight,
    });
    return createDisposables([
      registerResizeEventHandler(ctx),
      // Buzzar dev convenience (Third Room #204): try a world's shadow settings live, e.g.
      // thirdroom.setWorldShadows({ baked_sun: { enabled: true, azimuth: 135, elevation: 60, strength: 0.6 } }).
      registerThirdroomGlobalFn("setWorldShadows", (shadows: unknown) =>
        setWorldShadows(ctx, parseWorldShadows(shadows))
      ),
      // Buzzar (Third Room #461): thirdroom.generateWorldMap(2.5) draws the map; the result has a URL for the picture.
      registerThirdroomGlobalFn("generateWorldMap", async (cutHeight?: number) => {
        const { blob, area } = await generateWorldMap(ctx, cutHeight);
        const url = URL.createObjectURL(blob);
        return { area, type: blob.type, size: blob.size, url };
      }),
    ]);
  },
});

const registerResizeEventHandler = (ctx: MainContext) => {
  function onResize() {
    ctx.sendMessage(Thread.Render, {
      type: RendererMessageType.CanvasResize,
      canvasWidth: ctx.canvas.clientWidth,
      canvasHeight: ctx.canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    ctx.sendMessage(Thread.Game, {
      type: RendererMessageType.CanvasResize,
      canvasWidth: ctx.canvas.clientWidth,
      canvasHeight: ctx.canvas.clientHeight,
    });
  }

  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
  };
};

export function togglePhysicsDebug(ctx: MainContext) {
  ctx.sendMessage<TogglePhysicsDebugMessage>(Thread.Game, {
    type: RendererMessageType.TogglePhysicsDebug,
  });
}

export function printRenderThreadState(ctx: MainContext) {
  ctx.sendMessage<PrintRenderThreadStateMessage>(Thread.Render, {
    type: RendererMessageType.PrintRenderThreadState,
  });
}

function createRenderStatsBuffer(): RenderStatsBuffer {
  const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * RenderStatNames.length);

  return {
    buffer,
    f32: new Float32Array(buffer),
    u32: new Uint32Array(buffer),
  };
}

/** Buzzar: dynamic resolution is on with the Auto render quality; a quality you chose stays at a fixed resolution. */
function dynamicResolutionEnabled(): boolean {
  try {
    const setting = localStorage.getItem(LOCAL_STORAGE_RENDER_QUALITY);
    return !setting || JSON.parse(setting) === RenderQualitySetting.Auto;
  } catch {
    return true;
  }
}

/** Buzzar (Third Room #267): the world reveal, when turned on in Settings (off by default, and with reduced motion). */
function worldRevealEnabled(): boolean {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    const setting = localStorage.getItem(LOCAL_STORAGE_WORLD_REVEAL);
    return setting !== null && JSON.parse(setting) === true;
  } catch {
    return true;
  }
}

/** Buzzar (Third Room #204): your shadow setting (Settings → Graphics). */
function shadowQualitySetting(): ShadowQualitySetting {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_STORAGE_SHADOW_QUALITY) ?? '"auto"');
    return Object.values(ShadowQualitySetting).includes(value) ? value : ShadowQualitySetting.Auto;
  } catch {
    return ShadowQualitySetting.Auto;
  }
}

/** Buzzar (Third Room #204): tells the renderer the current world's shadow settings. */
let nextSettleId = 1;

/**
 * Buzzar: resolves once the render thread has compiled the scene's shaders and nothing new has needed compiling for
 * a few frames (or after `timeoutMs`, whichever is first). The loading card waits for this, so the compiling happens
 * behind it rather than as a freeze just after you enter.
 */
export function waitForShadersSettled(ctx: MainContext, timeoutMs = 8000): Promise<void> {
  const id = nextSettleId++;
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      dispose();
      resolve();
    };
    const timeout = setTimeout(done, timeoutMs);
    const dispose = registerMessageHandler(
      ctx,
      RendererMessageType.ShadersSettled,
      (_ctx, m: ShadersSettledMessage) => {
        if (m.id === id) done();
      }
    );
    ctx.sendMessage<AwaitShadersSettledMessage>(Thread.Render, { type: RendererMessageType.AwaitShadersSettled, id });
  });
}

export function setWorldShadows(ctx: MainContext, shadows: WorldShadowSettings) {
  ctx.sendMessage<SetWorldShadowsMessage>(Thread.Render, {
    type: RendererMessageType.SetWorldShadows,
    shadows,
  });
}
