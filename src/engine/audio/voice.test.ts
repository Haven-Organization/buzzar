import { describe, expect, it } from "vitest";

import { clampVoiceRange, DEFAULT_VOICE_RANGE, VOICE_NEAR, voiceRangeGain } from "./voice.common";

describe("voiceRangeGain", () => {
  it("is full volume up close, falls off fast, and is silent at the range", () => {
    expect(voiceRangeGain(0, 25)).toBe(1);
    expect(voiceRangeGain(VOICE_NEAR, 25)).toBe(1);
    expect(voiceRangeGain(10, 25)).toBeCloseTo(0.42, 2);
    expect(voiceRangeGain(15, 25)).toBeCloseTo(0.19, 2);
    expect(voiceRangeGain(20, 25)).toBeCloseTo(0.06, 2);
    expect(voiceRangeGain(25, 25)).toBe(0);
    expect(voiceRangeGain(100, 25)).toBe(0);
  });
});

describe("clampVoiceRange", () => {
  it("uses the default for missing or bad values and keeps ranges sensible", () => {
    expect(clampVoiceRange(undefined)).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange("far")).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange(-3)).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange(1)).toBe(VOICE_NEAR + 3);
    expect(clampVoiceRange(50)).toBe(50);
    expect(clampVoiceRange(1e9)).toBe(10000);
  });
});
