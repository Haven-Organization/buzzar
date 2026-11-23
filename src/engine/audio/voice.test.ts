import { describe, expect, it } from "vitest";

import {
  clampVoiceRange,
  DEFAULT_VOICE_RANGE,
  isVoiceAudible,
  overrideVoiceSettings,
  voiceGain,
  voiceLowpass,
  worldVoiceSettings,
  zoneVoiceSettings,
} from "./voice.common";

const world = worldVoiceSettings(undefined);

describe("world voice defaults", () => {
  it("follows VRChat's documented defaults: near 0, far 25 m, low-pass on, normal gain", () => {
    expect(world).toEqual({ gainDb: 0, near: 0, far: 25, lowpass: true });
  });

  it("reads a world's HAVEN_voice, ignoring bad values", () => {
    expect(worldVoiceSettings({ range: 40, near: 3, lowpass: false, gain: -6 })).toEqual({
      gainDb: -6,
      near: 3,
      far: 40,
      lowpass: false,
    });
    expect(worldVoiceSettings({ range: "far" as never, near: -1, gain: 999 })).toEqual({
      gainDb: 12,
      near: 0,
      far: DEFAULT_VOICE_RANGE,
      lowpass: true,
    });
  });
});

describe("voiceGain", () => {
  it("falls off fast from near and is silent at far", () => {
    expect(voiceGain(0, world)).toBe(1);
    expect(voiceGain(10, world)).toBeCloseTo(0.36, 5);
    expect(voiceGain(15, world)).toBeCloseTo(0.16, 5);
    expect(voiceGain(20, world)).toBeCloseTo(0.04, 5);
    expect(voiceGain(25, world)).toBe(0);
    expect(voiceGain(100, world)).toBe(0);
  });

  it("applies gain in decibels", () => {
    expect(voiceGain(0, { ...world, gainDb: -6 })).toBeCloseTo(0.501, 3);
  });
});

describe("voiceLowpass", () => {
  it("muffles more with distance, not at all up close or when turned off", () => {
    expect(voiceLowpass(0, world)).toBe(0);
    const mid = voiceLowpass(12.5, world);
    expect(mid).toBeGreaterThan(1200);
    expect(mid).toBeLessThan(20000);
    expect(voiceLowpass(25, world)).toBeCloseTo(1200, 5);
    expect(voiceLowpass(12.5, { ...world, lowpass: false })).toBe(0);
  });
});

describe("zones", () => {
  it("a stage (broadcast, or no settings) is heard everywhere at full volume, unmuffled", () => {
    for (const stage of [zoneVoiceSettings(world, { mode: "broadcast" }), zoneVoiceSettings(world, {})]) {
      expect(voiceGain(500, stage)).toBe(1);
      expect(voiceLowpass(500, stage)).toBe(0);
      expect(isVoiceAudible(500, stage)).toBe(true);
    }
  });

  it("a custom zone overrides only what it sets", () => {
    const quiet = zoneVoiceSettings(world, { far: 8, lowpass: false });
    expect(quiet).toEqual({ gainDb: 0, near: 0, far: 8, lowpass: false });
    expect(isVoiceAudible(20, quiet)).toBe(false);
    expect(isVoiceAudible(20, world)).toBe(true);
  });
});

describe("clampVoiceRange", () => {
  it("uses the default for missing or bad values and keeps ranges sensible", () => {
    expect(clampVoiceRange(undefined)).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange(-3)).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange(1)).toBe(3);
    expect(clampVoiceRange(1e9)).toBe(10000);
  });
});

describe("script overrides (peer.setVoice)", () => {
  it("win over the world's and zones' settings, only for what they set", () => {
    const stage = zoneVoiceSettings(world, { mode: "broadcast" });
    expect(overrideVoiceSettings(stage, { far: 10 })).toEqual({ gainDb: 0, near: 10, far: 10, lowpass: false });
    expect(overrideVoiceSettings(world, { gainDb: 6, lowpass: false })).toEqual({
      gainDb: 6,
      near: 0,
      far: 25,
      lowpass: false,
    });
  });

  it("can make a voice reach everywhere, or mute it", () => {
    expect(isVoiceAudible(1000, overrideVoiceSettings(world, { far: Infinity }))).toBe(true);
    expect(voiceGain(1, overrideVoiceSettings(world, { gainDb: -40 }))).toBeLessThan(0.02);
  });
});
