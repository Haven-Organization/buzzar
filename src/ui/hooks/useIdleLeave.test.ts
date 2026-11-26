import { describe, expect, it } from "vitest";

import { DEFAULT_IDLE_LEAVE_MINUTES, parseIdleLeaveMinutes } from "./useIdleLeave";

describe("leaving worlds when away", () => {
  it("defaults to 15 minutes, allows Never (0), and ignores other values", () => {
    expect(parseIdleLeaveMinutes(undefined)).toBe(DEFAULT_IDLE_LEAVE_MINUTES);
    expect(parseIdleLeaveMinutes(0)).toBe(0);
    expect(parseIdleLeaveMinutes(60)).toBe(60);
    expect(parseIdleLeaveMinutes(7)).toBe(DEFAULT_IDLE_LEAVE_MINUTES);
    expect(parseIdleLeaveMinutes("never")).toBe(DEFAULT_IDLE_LEAVE_MINUTES);
  });
});
