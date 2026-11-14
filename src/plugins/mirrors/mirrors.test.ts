import { describe, expect, test } from "vitest";

import { MirrorState } from "../../engine/resource/schema";
import { clampMirrorState, nextMirrorState, parseMirrorState } from "./mirrors.game";

describe("mirror state", () => {
  test("cycles Off → High → Low → Off", () => {
    expect(nextMirrorState(MirrorState.Off)).toBe(MirrorState.High);
    expect(nextMirrorState(MirrorState.High)).toBe(MirrorState.Low);
    expect(nextMirrorState(MirrorState.Low)).toBe(MirrorState.Off);
  });

  test("respects a client quality cap", () => {
    expect(nextMirrorState(MirrorState.Off, MirrorState.Low)).toBe(MirrorState.Low);
    expect(nextMirrorState(MirrorState.Low, MirrorState.Low)).toBe(MirrorState.Off);
    expect(nextMirrorState(MirrorState.Off, MirrorState.Off)).toBe(MirrorState.Off);
    // A state above the cap (e.g. cap lowered while on) moves to the start of the capped cycle.
    expect(nextMirrorState(MirrorState.High, MirrorState.Low)).toBe(MirrorState.Off);
  });

  test("clamps to the cap", () => {
    expect(clampMirrorState(MirrorState.High, MirrorState.Low)).toBe(MirrorState.Low);
    expect(clampMirrorState(MirrorState.Low, MirrorState.High)).toBe(MirrorState.Low);
    expect(clampMirrorState(MirrorState.High, MirrorState.Off)).toBe(MirrorState.Off);
  });

  test("parses glTF defaultState strings", () => {
    expect(parseMirrorState("high", MirrorState.Off)).toBe(MirrorState.High);
    expect(parseMirrorState("LOW", MirrorState.Off)).toBe(MirrorState.Low);
    expect(parseMirrorState("off", MirrorState.High)).toBe(MirrorState.Off);
    expect(parseMirrorState("bogus", MirrorState.Off)).toBe(MirrorState.Off);
    expect(parseMirrorState(undefined, MirrorState.Low)).toBe(MirrorState.Low);
  });
});
