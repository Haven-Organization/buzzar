import { createInterpolationBuffer, InterpolationBuffer } from "./InterpolationBuffer";
import { createPlaybackClock, PlaybackClock } from "./playbackClock";

/** Samples kept beyond the two being interpolated between (spare, for a playback clock slowing down). */
export const SPARE_SAMPLES = 2;

export interface Historian {
  entities: Map<number, InterpolationBuffer>;
  // latest tick received from the peer
  latestTick: number;
  // latest timestamp value continuously set by packets received from the peer
  latestTime: number;
  // Buzzar (Third Room #237): when to show this peer's state, on their clock (see playbackClock.ts)
  clock: PlaybackClock;
  // the playback time this frame (sender's clock), or undefined before any packet
  playbackTime?: number;
  // the two samples to interpolate between this frame (indexes into timestamps, newest first) and how far between
  fromIndex: number;
  toIndex: number;
  fractionOfTimePassed: number;
  // holds a history of elapsed timestamps (the sender's clock), newest first
  timestamps: number[];
  // flag for indicating that a new packet has arrived and the historian needs updated
  needsUpdate: boolean;
  // how far behind this peer's newest data playback is (ms)
  latency: number;
}

export const createHistorian = (): Historian => ({
  entities: new Map(),
  latestTick: 0,
  latestTime: 0,
  clock: createPlaybackClock(),
  fromIndex: -1,
  toIndex: -1,
  fractionOfTimePassed: 0,
  timestamps: [],
  needsUpdate: false,
  latency: 0,
});

export const addEntityToHistorian = (h: Historian, eid: number) => h.entities.set(eid, createInterpolationBuffer());

export const removeEntityFromHistorian = (h: Historian, eid: number) => h.entities.delete(eid);

export const getEntityHistory = (h: Historian, eid: number): InterpolationBuffer => {
  const interpBuffer = h.entities.get(eid);
  if (!interpBuffer) throw new Error("entity not found in historian: " + eid);
  return interpBuffer;
};
