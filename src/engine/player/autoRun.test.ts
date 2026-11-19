import { describe, expect, it } from "vitest";

import { isRunHeld } from "./autoRun.common";

describe("Auto Run", () => {
  it("runs with Shift normally", () => {
    expect(isRunHeld(false, false, true, false)).toBe(false);
    expect(isRunHeld(false, true, true, false)).toBe(true);
  });
  it("runs while moving with the keys when on, and Shift walks", () => {
    expect(isRunHeld(true, false, true, false)).toBe(true);
    expect(isRunHeld(true, true, true, false)).toBe(false);
  });
  it("leaves controllers to their own sprint button", () => {
    expect(isRunHeld(true, false, false, false)).toBe(false);
    expect(isRunHeld(true, false, false, true)).toBe(true);
  });
});
