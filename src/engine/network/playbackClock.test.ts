import { describe, expect, it } from "vitest";

import {
  addClockSample,
  advancePlaybackClock,
  createPlaybackClock,
  findSamples,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
} from "./playbackClock";

/** A small seeded random number generator, so the simulations are repeatable. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

interface Simulation {
  /** Sender frame interval (ms). */
  sendEvery: number;
  /** Network delay for a packet (ms), given a random number. */
  delay: (random: number) => number;
  /** Sender clock minus our clock (ms). */
  skew?: number;
  /** Receiver frame interval (ms). */
  frame?: number;
  durationMs?: number;
  /** A period (ms of sender time) when nothing is sent. */
  pause?: [number, number];
  /** Packets are held and delivered together this often (ms). */
  burstEvery?: number;
}

/** Runs a sender and a receiver; returns, per receiver frame after warm-up, the delay behind the newest sample. */
function simulate({
  sendEvery,
  delay,
  skew = 0,
  frame = 1000 / 60,
  durationMs = 20000,
  pause,
  burstEvery,
}: Simulation) {
  const random = rng(42);
  const packets: { sent: number; arrives: number }[] = [];
  for (let t = 0; t < durationMs; t += sendEvery) {
    if (pause && t >= pause[0] && t < pause[1]) continue;
    // Reliable ordered delivery: a packet can't overtake the one before (head-of-line blocking).
    let arrives = Math.max(t + delay(random()), packets.length ? packets[packets.length - 1].arrives : 0);
    if (burstEvery) arrives = Math.ceil(arrives / burstEvery) * burstEvery;
    packets.push({ sent: t + skew, arrives });
  }
  const clock = createPlaybackClock();
  const received: number[] = []; // sender times, newest first
  const frames: { playback: number; behind: number; starved: boolean; local: number }[] = [];
  let next = 0;
  for (let local = 0; local < durationMs + 1000; local += frame) {
    while (next < packets.length && packets[next].arrives <= local) {
      addClockSample(clock, packets[next].sent, packets[next].arrives);
      received.unshift(packets[next].sent);
      next++;
    }
    const playback = advancePlaybackClock(clock, local);
    if (playback === undefined || local < 3000 || local > durationMs) continue;
    frames.push({ playback, behind: received[0] - playback, starved: playback > received[0], local });
  }
  return { frames, clock };
}

const starvedShare = (frames: { starved: boolean }[]) => frames.filter((f) => f.starved).length / frames.length;

describe("playback clock (Third Room #237)", () => {
  it("keeps a short delay on a steady network", () => {
    const { frames, clock } = simulate({ sendEvery: 1000 / 60, delay: () => 30 });
    expect(clock.targetDelay).toBeLessThanOrEqual(MIN_DELAY_MS + 1);
    expect(starvedShare(frames)).toBe(0);
  });

  it("grows the delay with jitter, so there's almost always a sample ahead", () => {
    const { frames, clock } = simulate({ sendEvery: 1000 / 60, delay: (r) => 30 + r * 80 });
    expect(clock.targetDelay).toBeGreaterThan(60);
    expect(clock.targetDelay).toBeLessThan(MAX_DELAY_MS);
    expect(starvedShare(frames)).toBeLessThan(0.03);
  });

  it("copes with bursty delivery (an occasional packet held up, the next ones arriving together)", () => {
    const { frames } = simulate({ sendEvery: 1000 / 60, delay: (r) => (r < 0.03 ? 30 + r * 4000 : 30) });
    expect(starvedShare(frames)).toBeLessThan(0.05);
  });

  it("bridges a peer whose packets arrive in bursts about a second apart (a stuttering machine)", () => {
    // Sent every frame, but delivered once a second, all together.
    const { frames, clock } = simulate({ sendEvery: 1000 / 60, delay: (r) => 30 + r * 5, burstEvery: 1000 });
    expect(clock.targetDelay).toBeGreaterThan(950);
    expect(starvedShare(frames)).toBeLessThan(0.05);
  });

  it("allows for a slow sender", () => {
    const { frames, clock } = simulate({ sendEvery: 100, delay: () => 30 });
    expect(clock.targetDelay).toBeGreaterThanOrEqual(140);
    expect(starvedShare(frames)).toBeLessThan(0.02);
  });

  it("doesn't need the clocks to agree", () => {
    const { frames } = simulate({ sendEvery: 1000 / 60, delay: (r) => 30 + r * 40, skew: 123456 });
    expect(starvedShare(frames)).toBeLessThan(0.03);
    // Playback is on the sender's clock.
    expect(frames[frames.length - 1].playback).toBeGreaterThan(123456);
  });

  it("runs smoothly: playback always moves forward, at close to real speed", () => {
    const frame = 1000 / 60;
    const { frames } = simulate({ sendEvery: 1000 / 60, delay: (r) => 30 + r * 60, frame });
    for (let i = 1; i < frames.length; i++) {
      const step = frames[i].playback - frames[i - 1].playback;
      expect(step).toBeGreaterThan(frame * 0.85);
      expect(step).toBeLessThan(frame * 1.15);
    }
  });

  it("jumps ahead after the sender pauses, instead of replaying slowly", () => {
    const { frames } = simulate({ sendEvery: 1000 / 60, delay: () => 30, pause: [8000, 12000] });
    const late = frames.filter((f) => f.local > 13000);
    expect(Math.max(...late.map((f) => f.behind))).toBeLessThan(200);
  });
});

describe("findSamples", () => {
  const times = [300, 200, 100];
  it("finds the two samples around a time", () => {
    expect(findSamples(times, 250)).toEqual({ from: 1, to: 0, fraction: 0.5 });
    expect(findSamples(times, 100)).toEqual({ from: 2, to: 1, fraction: 0 });
  });
  it("holds the newest sample past the end and the oldest before the start", () => {
    expect(findSamples(times, 400)).toEqual({ from: 0, to: 0, fraction: 1 });
    expect(findSamples(times, 50)).toEqual({ from: 2, to: 2, fraction: 0 });
    expect(findSamples([], 50)).toBeUndefined();
  });
});
