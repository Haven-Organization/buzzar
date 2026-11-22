export enum Stats {
  gameTime,
  gameDuration,
  /** Buzzar (Third Room #365): game ticks in the last second, and the longest of them (ms). */
  gameFps,
  gameWorstFrame,
}

export interface StatsBuffer {
  buffer: SharedArrayBuffer;
  f32: Float32Array;
  u32: Uint32Array;
}

export const StatNames = Object.keys(Stats).filter((v) => isNaN(+v));

export enum StatsMessageType {
  InitializeStatsBuffer = "initialize-stats-buffer",
}

export interface InitializeStatsBufferMessage {
  statsBuffer: StatsBuffer;
}
