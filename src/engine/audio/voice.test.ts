import { describe, expect, it } from "vitest";

import { clampVoiceRange, DEFAULT_VOICE_RANGE, VOICE_FADE, voiceRangeGain } from "./voice.common";

describe("voiceRangeGain", () => {
  it("is full volume inside the range, fades over the last few metres, silent past it", () => {
    expect(voiceRangeGain(0, 30)).toBe(1);
    expect(voiceRangeGain(30 - VOICE_FADE, 30)).toBe(1);
    expect(voiceRangeGain(30 - VOICE_FADE / 2, 30)).toBeCloseTo(0.5);
    expect(voiceRangeGain(30, 30)).toBe(0);
    expect(voiceRangeGain(100, 30)).toBe(0);
  });
});

describe("clampVoiceRange", () => {
  it("uses the default for missing or bad values and keeps ranges sensible", () => {
    expect(clampVoiceRange(undefined)).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange("far")).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange(-3)).toBe(DEFAULT_VOICE_RANGE);
    expect(clampVoiceRange(1)).toBe(VOICE_FADE + 1);
    expect(clampVoiceRange(50)).toBe(50);
    expect(clampVoiceRange(1e9)).toBe(10000);
  });
});
