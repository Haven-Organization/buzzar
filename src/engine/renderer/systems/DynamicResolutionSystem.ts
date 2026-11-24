/**
 * Buzzar (Third Room #211): dynamic resolution scaling. While frames take noticeably longer than the display's
 * refresh interval, the renderer draws at a lower resolution (down to half), and goes back up once they're quick
 * again. Each second's average frame time is compared with the refresh interval, estimated from the quickest recent
 * frames. Off in XR and when you chose a render quality yourself (it's on with Auto).
 */
import { getModule } from "../../module/module.common";
import { RenderStats } from "../renderer.common";
import { RenderContext, RendererModule } from "../renderer.render";

const MIN_SCALE = 0.5;
const STEP = 0.1;
/** Slower than this × the refresh interval on average counts as a slow second. */
const SLOW = 1.25;
/** Faster than this × the refresh interval counts as a smooth second. */
const SMOOTH = 1.1;
const SLOW_SECONDS_TO_DROP = 2;
const SMOOTH_SECONDS_TO_RAISE = 4;

let windowStart = 0;
let windowFrames = 0;
let windowTime = 0;
let windowMin = Infinity;
let refreshInterval = 1 / 60;
let slowSeconds = 0;
let smoothSeconds = 0;

/** Decides the next scale from one second of frames. Exported for tests. */
export function nextResolutionScale(
  scale: number,
  averageDt: number,
  refresh: number,
  counters: { slow: number; smooth: number }
): number {
  if (averageDt > refresh * SLOW) {
    counters.slow++;
    counters.smooth = 0;
  } else if (averageDt < refresh * SMOOTH) {
    counters.smooth++;
    counters.slow = 0;
  } else {
    counters.slow = 0;
    counters.smooth = 0;
  }
  if (counters.slow >= SLOW_SECONDS_TO_DROP && scale > MIN_SCALE) {
    counters.slow = 0;
    return Math.max(MIN_SCALE, Math.round((scale - STEP) * 100) / 100);
  }
  if (counters.smooth >= SMOOTH_SECONDS_TO_RAISE && scale < 1) {
    counters.smooth = 0;
    return Math.min(1, Math.round((scale + STEP) * 100) / 100);
  }
  return scale;
}

export function DynamicResolutionSystem(ctx: RenderContext) {
  const rendererModule = getModule(ctx, RendererModule);
  const pipeline = rendererModule.renderPipeline;
  rendererModule.statsBuffer.f32[RenderStats.resolutionScale] = pipeline.resolutionScale;

  if (!rendererModule.dynamicResolution || rendererModule.renderer.xr.isPresenting) {
    pipeline.setResolutionScale(1);
    return;
  }

  // Ignore stalls (a tab in the background, a world loading): they say nothing about drawing.
  if (ctx.dt <= 0 || ctx.dt > 0.25) return;

  windowFrames++;
  windowTime += ctx.dt;
  windowMin = Math.min(windowMin, ctx.dt);
  const now = performance.now();
  if (!windowStart) windowStart = now;
  if (now - windowStart < 1000 || windowFrames < 10) return;

  // The display's refresh interval: the quickest frames of the last few seconds, kept from drifting.
  refreshInterval = Math.max(1 / 240, Math.min(windowMin, refreshInterval * 1.05));
  const counters = { slow: slowSeconds, smooth: smoothSeconds };
  pipeline.setResolutionScale(
    nextResolutionScale(pipeline.resolutionScale, windowTime / windowFrames, refreshInterval, counters)
  );
  slowSeconds = counters.slow;
  smoothSeconds = counters.smooth;

  windowStart = now;
  windowFrames = 0;
  windowTime = 0;
  windowMin = Infinity;
}
