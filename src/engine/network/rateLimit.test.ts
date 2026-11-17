import { describe, expect, it } from "vitest";

import { allowMessage, createMessageLimiter, shouldWarn } from "./rateLimit";

describe("script message rate limits", () => {
  it("allows a burst, then refills at the rate", () => {
    const limiter = createMessageLimiter(10, 1e6, 0); // 10/s, burst 20
    let sent = 0;
    for (let i = 0; i < 50; i++) if (allowMessage(limiter, 10, 0)) sent++;
    expect(sent).toBe(20);
    expect(allowMessage(limiter, 10, 50)).toBe(false); // 0.5 tokens after 50 ms
    expect(allowMessage(limiter, 10, 100)).toBe(true); // 1 token after 100 ms
  });

  it("limits bytes, and a refused message costs nothing", () => {
    const limiter = createMessageLimiter(1000, 100, 0); // 100 B/s, burst 200 B
    expect(allowMessage(limiter, 150, 0)).toBe(true);
    expect(allowMessage(limiter, 150, 0)).toBe(false);
    expect(allowMessage(limiter, 50, 0)).toBe(true);
    expect(limiter.messages.tokens).toBe(2000 - 2);
  });

  it("warns at most once per interval", () => {
    const limiter = createMessageLimiter(1, 1, 0);
    expect(shouldWarn(limiter, 0)).toBe(true);
    expect(shouldWarn(limiter, 1000)).toBe(false);
    expect(shouldWarn(limiter, 6000)).toBe(true);
  });
});
