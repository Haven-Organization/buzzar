/**
 * Buzzar (Third Room #237): a playback clock per peer for interpolating their objects, with a delay that adapts to how
 * jittery their packets are.
 *
 * Every packet carries the sender's clock (Date.now() when it was sent). Remote state is shown a little in the past,
 * at a "playback" time on the sender's clock, so there is usually a received sample on each side of it to
 * interpolate between. The delay behind the newest data is:
 *
 * - at least about one and a half send intervals (a sample must have arrived after the playback time);
 * - plus the recent jitter: how much later than the fastest recent packet nearly all recent packets arrived (the 95th
 *   percentile over a few seconds, so one odd late packet doesn't count). Steady networks get a short delay, bursty
 *   ones (Wi-Fi, a busy peer) a longer one;
 * - kept between MIN_DELAY_MS and MAX_DELAY_MS.
 *
 * The two machines' clocks needn't agree: only the difference (sender clock − our clock) is used, taking the largest
 * recent value as the least-delayed packet. The playback clock runs at our speed, nudged slightly faster or slower
 * (at most SPEED_RANGE) to follow changes in delay or offset, so motion never jumps, except after a long gap.
 */

export const MIN_DELAY_MS = 40;
/**
 * Most a peer is shown behind. Only approached by peers whose packets come in bursts (a machine that stutters: about
 * one burst a second was seen in a two-client test), which would otherwise freeze between bursts.
 */
export const MAX_DELAY_MS = 1500;
/** How far back packets are remembered for the fastest packet and the jitter (ms of our clock). */
const OFFSET_WINDOW_MS = 3000;
/** The share of recent packets the delay should cover. */
const JITTER_PERCENTILE = 0.95;
/** Most the playback clock speeds up or slows down to catch its target (0.1 = ±10%). */
const SPEED_RANGE = 0.1;
/** Fraction of the distance to the target closed per second. */
const CATCH_UP_PER_SECOND = 2;
/** Further off than this (ms), the playback clock jumps (after a pause, a stall or a first packet). */
const SNAP_MS = 2500;

export interface PlaybackClock {
  /** Recent (our clock, sender clock − our clock) pairs, oldest first. */
  offsets: { local: number; offset: number }[];
  /** The largest recent offset: the least-delayed packet. */
  bestOffset: number;
  /** How much later than the fastest recent packet nearly all recent packets arrived (ms). */
  jitter: number;
  offsetsChanged?: boolean;
  /** Estimated time between the sender's packets (ms). */
  interval: number;
  lastRemote?: number;
  /** Where playback is on the sender's clock, and when (our clock) it was last advanced. */
  playback?: number;
  lastLocal?: number;
  /** The delay being aimed for (ms), for debugging. */
  targetDelay: number;
}

export function createPlaybackClock(): PlaybackClock {
  return { offsets: [], bestOffset: -Infinity, jitter: 0, interval: 16, targetDelay: MIN_DELAY_MS };
}

/** A packet sent at `remote` (sender's clock) arrived at `local` (our clock). */
export function addClockSample(clock: PlaybackClock, remote: number, local: number) {
  if (clock.lastRemote !== undefined) {
    const gap = remote - clock.lastRemote;
    if (gap <= 0) return; // out of order or repeated: nothing new
    // Long gaps (a pause, a hidden tab) aren't the send rate.
    if (gap < 500) clock.interval += (gap - clock.interval) * 0.1;
  }
  clock.lastRemote = remote;

  const offset = remote - local;
  clock.offsets.push({ local, offset });
  while (clock.offsets.length > 1 && local - clock.offsets[0].local > OFFSET_WINDOW_MS) clock.offsets.shift();
  clock.offsetsChanged = true;
}

/** The fastest recent packet, and how much later than it nearly all recent packets were. */
function updateJitter(clock: PlaybackClock) {
  if (!clock.offsetsChanged) return;
  clock.offsetsChanged = false;
  let best = -Infinity;
  for (const sample of clock.offsets) best = Math.max(best, sample.offset);
  clock.bestOffset = best;
  const lateness = clock.offsets.map((sample) => best - sample.offset).sort((a, b) => a - b);
  clock.jitter = lateness[Math.min(lateness.length - 1, Math.floor(lateness.length * JITTER_PERCENTILE))] ?? 0;
}

export function targetDelay(clock: PlaybackClock) {
  // A little headroom: the estimate moves as packets come and go, and playback follows it only gradually.
  const delay = clock.interval * 1.5 + clock.jitter * 1.25 + 10;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delay));
}

/** Advances to our time `local` and returns the playback time on the sender's clock, or undefined before any packet. */
export function advancePlaybackClock(clock: PlaybackClock, local: number): number | undefined {
  if (clock.offsets.length === 0) return undefined;
  updateJitter(clock);
  clock.targetDelay = targetDelay(clock);
  const target = local + clock.bestOffset - clock.targetDelay;
  if (clock.playback === undefined || clock.lastLocal === undefined || Math.abs(target - clock.playback) > SNAP_MS) {
    clock.playback = target;
  } else {
    const dt = Math.max(0, local - clock.lastLocal);
    const error = target - clock.playback;
    const speed = 1 + Math.max(-SPEED_RANGE, Math.min(SPEED_RANGE, (error / 1000) * CATCH_UP_PER_SECOND));
    clock.playback += dt * speed;
  }
  clock.lastLocal = local;
  return clock.playback;
}

/**
 * Finds the two samples around `time` in timestamps sorted newest first. Returns the older one's index, the newer
 * one's index and how far between them `time` is (0 = older, 1 = newer). Past the newest sample it holds the newest;
 * before the oldest it holds the oldest.
 */
export function findSamples(
  timestamps: number[],
  time: number
): { from: number; to: number; fraction: number } | undefined {
  if (timestamps.length === 0) return undefined;
  if (time >= timestamps[0]) return { from: 0, to: 0, fraction: 1 };
  for (let i = 1; i < timestamps.length; i++) {
    const older = timestamps[i];
    if (older <= time) {
      const newer = timestamps[i - 1];
      const span = newer - older;
      return { from: i, to: i - 1, fraction: span > 0 ? (time - older) / span : 1 };
    }
  }
  const last = timestamps.length - 1;
  return { from: last, to: last, fraction: 0 };
}
