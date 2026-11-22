import { MainContext } from "../MainThread";
import { defineModule, getModule, Thread } from "../module/module.common";
import { RenderStats } from "../renderer/renderer.common";
import { RendererModule } from "../renderer/renderer.main";
import { InitializeStatsBufferMessage, StatNames, Stats, StatsBuffer, StatsMessageType } from "./stats.common";

/*********
 * Types *
 ********/

export interface StatsModuleState {
  buffer: StatsBuffer;
  stats: StatsObject;
  /** Buzzar (Third Room #476): the last two minutes, once a second, for bug reports. */
  history: PerfSample[];
}

export interface PerfSample {
  /** Seconds since the page loaded. */
  t: number;
  fps: number;
  freshFps: number;
  worstFrame: number;
  gameFps: number;
  gameWorstFrame: number;
}

const HISTORY_SECONDS = 120;

export type StatsObject = { [Property in Exclude<keyof (typeof Stats & typeof RenderStats), number>]: number | string };

/******************
 * Initialization *
 *****************/

export const StatsModule = defineModule<MainContext, StatsModuleState>({
  name: "stats",
  create(ctx, { sendMessage }) {
    const statsBuffer = createStatsBuffer();

    sendMessage<InitializeStatsBufferMessage>(Thread.Game, StatsMessageType.InitializeStatsBuffer, { statsBuffer });

    return {
      buffer: statsBuffer,
      stats: Object.fromEntries(StatNames.map((key) => [key, 0])) as StatsObject,
      history: [],
    };
  },
  init(context) {
    const stats = getModule(context, StatsModule);
    context.initialGameWorkerState.statsBuffer = stats.buffer;
    context.initialRenderWorkerState.statsBuffer = stats.buffer;

    // Buzzar: keep a short history of frame rates for bug reports (cheap: a few reads a second).
    const timer = setInterval(() => {
      const render = getModule(context, RendererModule).statsBuffer.f32;
      stats.history.push({
        t: Math.round(performance.now() / 1000),
        fps: render[RenderStats.fps],
        freshFps: render[RenderStats.freshFps],
        worstFrame: render[RenderStats.worstFrame],
        gameFps: stats.buffer.f32[Stats.gameFps],
        gameWorstFrame: stats.buffer.f32[Stats.gameWorstFrame],
      });
      if (stats.history.length > HISTORY_SECONDS) stats.history.shift();
    }, 1000);
    return () => clearInterval(timer);
  },
});

function createStatsBuffer(): StatsBuffer {
  const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * StatNames.length);

  return {
    buffer,
    f32: new Float32Array(buffer),
    u32: new Uint32Array(buffer),
  };
}

/*******
 * API *
 ******/

export function getStats(ctx: MainContext): StatsObject {
  const { stats, buffer } = getModule(ctx, StatsModule);
  const { statsBuffer: renderStatsBuffer } = getModule(ctx, RendererModule);
  stats.fps = renderStatsBuffer.f32[RenderStats.fps].toFixed(1);
  stats.freshFps = renderStatsBuffer.f32[RenderStats.freshFps].toFixed(1);
  stats.worstFrame = renderStatsBuffer.f32[RenderStats.worstFrame].toFixed(1);
  stats.resolutionScale = renderStatsBuffer.f32[RenderStats.resolutionScale].toFixed(2);
  stats.gameFps = buffer.f32[Stats.gameFps].toFixed(1);
  stats.gameWorstFrame = buffer.f32[Stats.gameWorstFrame].toFixed(1);
  stats.frameTime = renderStatsBuffer.f32[RenderStats.frameTime].toFixed(2);
  stats.frameDuration = (renderStatsBuffer.f32[RenderStats.frameDuration] * 1000).toFixed(2);
  stats.gameTime = (buffer.f32[Stats.gameTime] * 1000).toFixed(2);
  stats.gameDuration = buffer.f32[Stats.gameDuration].toFixed(2);
  stats.frame = renderStatsBuffer.u32[RenderStats.frame];
  stats.staleFrames = renderStatsBuffer.u32[RenderStats.staleFrames];
  stats.drawCalls = renderStatsBuffer.u32[RenderStats.drawCalls];
  stats.programs = renderStatsBuffer.u32[RenderStats.programs];
  stats.geometries = renderStatsBuffer.u32[RenderStats.geometries];
  stats.textures = renderStatsBuffer.u32[RenderStats.textures];
  stats.triangles = renderStatsBuffer.u32[RenderStats.triangles];
  stats.points = renderStatsBuffer.u32[RenderStats.points];
  stats.lines = renderStatsBuffer.u32[RenderStats.lines];
  return stats;
}

/** The WebGL renderer the browser reports (e.g. "ANGLE (NVIDIA, GeForce …)"), where it allows. */
function gpuName(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "no WebGL2";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return String(name);
  } catch {
    return "unknown";
  }
}

/**
 * Buzzar (Third Room #476): a plain-text performance report for bug reports: the GPU, render quality and current
 * render counts, then frame rates once a second for the last two minutes.
 */
export function getPerfReport(ctx: MainContext): string {
  const { history } = getModule(ctx, StatsModule);
  const now = getStats(ctx);
  const lines = [
    `GPU: ${gpuName()}`,
    `Render quality: ${ctx.quality}`,
    `Cores: ${navigator.hardwareConcurrency ?? "?"}, screen ${screen.width}x${screen.height} @${devicePixelRatio}x`,
    `Now: drawCalls ${now.drawCalls}, triangles ${now.triangles}, textures ${now.textures}, geometries ${now.geometries}, programs ${now.programs}`,
    "",
    "t(s)\tfps\tfreshFps\tworstFrame(ms)\tgameFps\tgameWorstFrame(ms)",
    ...history.map((s) =>
      [s.t, s.fps.toFixed(1), s.freshFps.toFixed(1), s.worstFrame.toFixed(1), s.gameFps.toFixed(1), s.gameWorstFrame.toFixed(1)].join("\t")
    ),
  ];
  return lines.join("\n");
}
