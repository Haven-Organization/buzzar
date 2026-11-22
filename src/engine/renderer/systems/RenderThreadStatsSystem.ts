import { getModule } from "../../module/module.common";
import { RenderStats } from "../renderer.common";
import { RenderContext, RendererModule } from "../renderer.render";

// Frames counted over a one-second window: the rate you see, including how many brought new game state (a frame
// redrawn from stale game state looks frozen even at 60 fps), and the longest frame (Third Room #365).
let windowStart = 0;
let windowFrames = 0;
let windowFresh = 0;
let windowWorst = 0;

export function RenderThreadStatsSystem(ctx: RenderContext) {
  const renderModule = getModule(ctx, RendererModule);

  const {
    render: { frame, calls, triangles, points, lines },
    memory: { geometries, textures },
    programs,
  } = renderModule.renderer.info;

  if (ctx.isStaleFrame) {
    renderModule.staleTripleBufferCounter++;
  } else {
    if (renderModule.staleTripleBufferCounter > 1) {
      renderModule.staleFrameCounter++;
    }

    renderModule.staleTripleBufferCounter = 0;
  }

  const end = performance.now();

  const frameDuration = (end - ctx.elapsed) / 1000;

  const statsBuffer = renderModule.statsBuffer;
  windowFrames++;
  if (!ctx.isStaleFrame) windowFresh++;
  windowWorst = Math.max(windowWorst, ctx.dt * 1000);
  if (end - windowStart >= 1000) {
    const seconds = windowStart ? (end - windowStart) / 1000 : 1;
    statsBuffer.f32[RenderStats.fps] = windowFrames / seconds;
    statsBuffer.f32[RenderStats.freshFps] = windowFresh / seconds;
    statsBuffer.f32[RenderStats.worstFrame] = windowWorst;
    windowStart = end;
    windowFrames = 0;
    windowFresh = 0;
    windowWorst = 0;
  }
  statsBuffer.f32[RenderStats.frameTime] = ctx.dt * 1000;
  statsBuffer.f32[RenderStats.frameDuration] = frameDuration;
  statsBuffer.u32[RenderStats.frame] = frame;
  statsBuffer.u32[RenderStats.staleFrames] = renderModule.staleFrameCounter;
  statsBuffer.u32[RenderStats.drawCalls] = calls;
  statsBuffer.u32[RenderStats.programs] = programs ? programs.length : 0;
  statsBuffer.u32[RenderStats.geometries] = geometries;
  statsBuffer.u32[RenderStats.textures] = textures;
  statsBuffer.u32[RenderStats.triangles] = triangles;
  statsBuffer.u32[RenderStats.points] = points;
  statsBuffer.u32[RenderStats.lines] = lines;

  renderModule.renderer.info.reset();
}
