import { GameContext } from "../GameTypes";
import { defineModule, getModule, Thread } from "../module/module.common";
import { InitializeStatsBufferMessage, Stats, StatsBuffer, StatsMessageType } from "./stats.common";

interface StatsModuleState {
  statsBuffer: StatsBuffer;
}

export const StatsModule = defineModule<GameContext, StatsModuleState>({
  name: "stats",
  async create(ctx, { waitForMessage }) {
    const { statsBuffer } = await waitForMessage<InitializeStatsBufferMessage>(
      Thread.Main,
      StatsMessageType.InitializeStatsBuffer
    );

    return {
      statsBuffer,
    };
  },
  init() {},
});

// Ticks counted over a one-second window (Third Room #365: a per-frame rate hides stutter).
let windowStart = 0;
let windowTicks = 0;
let windowWorst = 0;

export function GameWorkerStatsSystem(ctx: GameContext) {
  const stats = getModule(ctx, StatsModule);
  const now = performance.now();
  const frameDuration = now - ctx.elapsed;
  stats.statsBuffer.f32[Stats.gameTime] = ctx.dt;
  stats.statsBuffer.f32[Stats.gameDuration] = frameDuration;

  windowTicks++;
  windowWorst = Math.max(windowWorst, ctx.dt * 1000);
  if (now - windowStart >= 1000) {
    const seconds = windowStart ? (now - windowStart) / 1000 : 1;
    stats.statsBuffer.f32[Stats.gameFps] = windowTicks / seconds;
    stats.statsBuffer.f32[Stats.gameWorstFrame] = windowWorst;
    windowStart = now;
    windowTicks = 0;
    windowWorst = 0;
  }
}
